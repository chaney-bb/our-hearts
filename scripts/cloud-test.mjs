/**
 * 云函数集成测试：用假数据库把 cloudfunctions/api 完整跑一遍
 *
 * 用法：node scripts/cloud-test.mjs
 *
 * 覆盖：登记 / 校验 / 配对门禁 / 配对 / 同步奖 / 个人钱包独立 /
 *       连续天数按关系 / 解绑清零 / 对账 / 缺集合容错 / 兜底错误
 * 不需要连真云开发、不需要部署。
 */
import Module from 'node:module'
import { createRequire } from 'node:module'
import { createFakeCloud } from './fake-cloud.mjs'

const require = createRequire(import.meta.url)
const fake = createFakeCloud()

const originalLoad = Module._load
Module._load = function (request, parent, isMain) {
  if (request === 'wx-server-sdk') return fake.sdk
  return originalLoad.call(this, request, parent, isMain)
}

const api = require('../cloudfunctions/api/index.js')
const rules = require('../cloudfunctions/api/modules/checkin/rules.js')

let failed = 0
function ok(name, cond, extra) {
  if (cond) {
    console.log('  ✅ ' + name)
  } else {
    failed++
    console.log('  ❌ ' + name + (extra !== undefined ? '  ->  ' + JSON.stringify(extra) : ''))
  }
}

function bj(y, m, d, h, mi) {
  return Date.UTC(y, m - 1, d, h, mi, 0, 0) - 8 * 3600 * 1000
}
function setNow(ts) {
  Date.now = () => ts
}
function atDay(y, m, d, minutes) {
  return bj(y, m, d, Math.floor(minutes / 60), minutes % 60)
}
function call(action, payload) {
  return api.main({ action: action, payload: payload || {} })
}

const realError = console.error
function silence() {
  console.error = function () {}
}
function unsilence() {
  console.error = realError
}

const A = 'openid_A'
const B = 'openid_B'
const C = 'openid_C'

const PROFILE = {
  realName: '张三',
  phone: '13800138000',
  birthday: '1995-01-01',
  gender: 'male',
  bio: '你好'
}

async function asUser(openid) {
  fake.state.setOpenid(openid)
}
async function register(openid, userId, extra) {
  await asUser(openid)
  return call('session.register', { data: Object.assign({ userId: userId }, PROFILE, extra || {}) })
}
function coupleIdOf(openid) {
  const p = fake.state.all('profiles').find((x) => x.openid === openid)
  return p ? p.coupleId : ''
}

console.log('\n[1] 新用户：还没登记，不能玩任何模块')
await asUser(A)
setNow(bj(2026, 10, 26, 12, 0))

let s = await call('session.get')
ok('session.get 返回 ok', s.ok === true, s)
ok('提示要登记', s.needRegister === true)
ok('还没配对', s.needPair === true)
ok('新钱包余额 0', s.wallet.balance === 0, s.wallet)

let d = await call('checkin.detail')
ok('没登记时模块被拦', d.ok === false && d.code === 'NEED_REGISTER', d)

console.log('\n[2] 登记校验')
let r = await register(A, 'a', {})
ok('用户ID太短被拒', r.ok === false && r.code === 'BAD_USER_ID', r)

r = await register(A, '阿明', { phone: '123' })
ok('手机号格式错被拒', r.ok === false && r.code === 'BAD_PHONE', r)

r = await register(A, '阿明', { gender: 'x' })
ok('性别非法被拒', r.ok === false && r.code === 'BAD_GENDER', r)

r = await register(A, '阿明', { birthday: '1995/01/01' })
ok('生日格式错被拒', r.ok === false && r.code === 'BAD_BIRTHDAY', r)

r = await register(A, '阿明')
ok('正常登记成功', r.ok === true, r)
ok('登记完 needRegister 变 false', r.needRegister === false)
ok('档案里带上登记信息', r.me.userId === '阿明' && r.me.realName === '张三', r.me)
const inviteA = r.inviteCode

r = await register(B, '阿明')
ok('重名被拒', r.ok === false && r.code === 'USER_ID_TAKEN', r)

console.log('\n[3] 未配对：模块门禁')
await asUser(A)
d = await call('checkin.detail')
ok('未配对被拦', d.ok === false && d.code === 'NOT_PAIRED', d)

console.log('\n[4] 配对')
r = await register(B, '小红')
ok('B 登记成功', r.ok === true, r)
const inviteB = r.inviteCode

r = await call('session.bind', { inviteCode: 'ZZZZZZ' })
ok('错邀请码被拒', r.ok === false && r.code === 'NOT_FOUND', r)

r = await call('session.bind', { inviteCode: inviteA })
ok('B 配对成功', r.ok === true && r.bound === true, r)
ok('B 看到对方档案', r.partner && r.partner.userId === '阿明', r.partner)

r = await register(C, '小刚')
r = await call('session.bind', { inviteCode: inviteA })
ok('用过的邀请码不能再配对', r.ok === false, r)

console.log('\n[5] 个人钱包独立')
await asUser(A)
setNow(bj(2026, 10, 26, 22, 0))
d = await call('checkin.act', { type: 'sleep' })
ok('A 打卡成功', d.ok === true, d)

s = await call('session.get')
ok('A 余额 +1', s.wallet.balance === 1, s.wallet)
ok('B 余额还是 0（互不影响）', s.partnerWallet.balance === 0, s.partnerWallet)

const walletA = fake.state.all('core_wallets').find((w) => w.openid === A)
ok('A 的钱包文档存在且余额 1', walletA && walletA.balance === 1, walletA)

console.log('\n[6] 同步奖 + 对方余额可见')
await asUser(B)
setNow(bj(2026, 10, 26, 22, 5))
d = await call('checkin.act', { type: 'sleep' })
const reasons = (d.reward && d.reward.reasons) || []
ok('B 拿到同步奖', reasons.some((x) => x.indexOf('同步') === 0), reasons)

s = await call('session.get')
ok('B 余额 = 1 + 1 = 2', s.wallet.balance === 2, s.wallet)
ok('B 能看到 A 的余额', s.partnerWallet.balance === 1, s.partnerWallet)

console.log('\n[7] 记录页')
d = await call('checkin.history', { month: '2026-10' })
ok('记录页返回 ok', d.ok === true, d)
ok('日历里有 10-26', !!d.days['2026-10-26'], Object.keys(d.days || {}))
ok('爱心明细有内容', d.logs.length > 0)
ok('没有 warn', d.warn === '', d.warn)

console.log('\n[8] 连续天数按"这段关系"算')
const cidAB = coupleIdOf(A)
for (const day of ['2026-10-24', '2026-10-25']) {
  for (const type of ['sleep', 'wake']) {
    await fake.db.collection('checkins').add({
      data: { openid: A, coupleId: cidAB, date: day, type, at: bj(2026, 10, 26, 1, 0), source: 'normal' }
    })
  }
}
await asUser(A)
d = await call('checkin.detail')
ok('两天全勤 → 连续 2 天', d.streak === 2, d.streak)

console.log('\n[9] 解绑：二次确认 + 清零 + 封存')
r = await call('session.unbind', {})
ok('不给确认时拒绝解绑', r.ok === false && r.code === 'NO_CONFIRM', r)

r = await call('session.unbind', { confirm: true })
ok('确认后解绑成功', r.ok === true, r)
ok('解绑后回到未配对', r.needPair === true && r.bound === false, r)
ok('A 余额清零', r.wallet.balance === 0, r.wallet)

const old = fake.state.all('couples').find((c) => c._id === cidAB)
ok('旧关系被标记 dissolved', old && old.status === 'dissolved', old && old.status)

const zeroLog = fake.state.all('heart_logs').find((l) => l.reason === '解除绑定清零' && l.openid === A)
ok('流水里留下"解除绑定清零"', !!zeroLog, zeroLog)

d = await call('checkin.detail')
ok('解绑后不能再用模块', d.ok === false && d.code === 'NOT_PAIRED', d)

console.log('\n[10] 重新配对后从零开始（不继承上一个人的数据）')
r = await call('session.get')
const inviteA2 = r.inviteCode
ok('解绑后拿到新的邀请码', inviteA2 && inviteA2 !== inviteA, { old: inviteA, now: inviteA2 })

await asUser(C)
await register(C, '小刚')
r = await call('session.bind', { inviteCode: inviteA2 })
ok('A 和 C 重新配对成功', r.ok === true && r.bound === true, r)

await asUser(A)
setNow(bj(2026, 10, 27, 22, 10))
d = await call('checkin.detail')
ok('连续天数从 0 开始（旧记录不算）', d.streak === 0, d.streak)
ok('旧记录还在库里（封存，不删）', fake.state.all('checkins').filter((x) => x.coupleId === cidAB).length >= 4)

console.log('\n[11] 对账：余额 = 流水之和')
s = await call('session.verify')
ok('A 对账通过', s.ok === true && s.ledger === s.wallet, s)

console.log('\n[12] 容错与兜底')
fake.state.drop('heart_logs')
silence()
d = await call('checkin.history', { month: '2026-10' })
unsilence()
ok('缺 heart_logs 不整页挂掉', d.ok === true, d)
ok('降级成空明细 + 提示', Array.isArray(d.logs) && d.warn.indexOf('heart_logs') >= 0, d.warn)

fake.state.drop('checkins')
silence()
d = await call('checkin.detail')
unsilence()
ok('兜底错误带真实原因', d.ok === false && typeof d.detail === 'string' && d.message.indexOf('checkin.detail') >= 0, d)

const legacy = await call('home')
ok('旧接口给出友好提示', legacy.ok === false && legacy.code === 'CLIENT_OUTDATED', legacy)

const noMod = await call('notexist.act')
ok('未知模块被拒', noMod.ok === false && noMod.code === 'NO_MODULE', noMod)

console.log('')
if (failed) {
  console.log('❌ 有 ' + failed + ' 个断言失败')
  process.exit(1)
}
console.log('🎉 全部通过')
