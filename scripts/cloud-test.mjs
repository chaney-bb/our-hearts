/**
 * 云函数集成测试：用假数据库把 cloudfunctions/api 完整跑一遍
 *
 * 用法：node scripts/cloud-test.mjs
 *
 * 覆盖：登记 / 校验 / 配对门禁 / 配对 / 分档奖励 / 0 分档 / 个人钱包独立 /
 *       月度全勤 / 连续天数按关系 / 解绑清零 / 打卡日跨零点 / 容错 / 兜底错误
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
const D = 'openid_D'
const E = 'openid_E'

const PROFILE = { realName: '张三', phone: '13800138000', birthday: '1995-01-01', gender: 'male', bio: '你好' }

async function asUser(openid) {
  fake.state.setOpenid(openid)
}
async function register(openid, userId, extra) {
  await asUser(openid)
  return call('session.register', { data: Object.assign({ userId: userId }, PROFILE, extra || {}) })
}
async function walletOf(openid) {
  await asUser(openid)
  const s = await call('session.get')
  return s.wallet.balance
}
function coupleIdOf(openid) {
  const p = fake.state.all('profiles').find((x) => x.openid === openid)
  return p ? p.coupleId : ''
}
async function seedFullDay(coupleId, openid, date) {
  for (const type of ['sleep', 'wake']) {
    await fake.db.collection('checkins').add({
      data: { openid, coupleId, date, type, at: bj(2026, 9, 1, 22, 0), hearts: 1, source: 'normal' }
    })
  }
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
r = await register(A, '阿明')
ok('正常登记成功', r.ok === true, r)
const inviteA = r.inviteCode

r = await register(B, '阿明')
ok('重名被拒', r.ok === false && r.code === 'USER_ID_TAKEN', r)

console.log('\n[3] 未配对：模块门禁')
await asUser(A)
d = await call('checkin.detail')
ok('未配对被拦', d.ok === false && d.code === 'NOT_PAIRED', d)

console.log('\n[4] 配对')
r = await register(B, '小红')
const inviteB = r.inviteCode
r = await call('session.bind', { inviteCode: inviteA })
ok('B 配对成功', r.ok === true && r.bound === true, r)
r = await register(C, '小刚')
r = await call('session.bind', { inviteCode: inviteA })
ok('用过的邀请码不能再配对', r.ok === false, r)

console.log('\n[5] 分档奖励')
await asUser(A)
setNow(bj(2026, 10, 26, 21, 35))
d = await call('checkin.act', { type: 'sleep' })
ok('21:35 早睡 → +2', d.ok === true && d.reward.delta === 2, d.reward)
ok('打卡记录里存了档位分值', fake.state.all('checkins').find((x) => x.openid === A && x.type === 'sleep').hearts === 2)

await asUser(B)
setNow(bj(2026, 10, 26, 22, 20))
d = await call('checkin.act', { type: 'sleep' })
ok('22:20 早睡 → +1', d.ok === true && d.reward.delta === 1, d.reward)

ok('A 余额 2（互不影响）', (await walletOf(A)) === 2)
ok('B 余额 1', (await walletOf(B)) === 1)

console.log('\n[6] 0 分档：打了但不给爱心')
await asUser(A)
setNow(bj(2026, 10, 27, 23, 20))
d = await call('checkin.act', { type: 'sleep' })
ok('23:20 打卡 → 0 爱心', d.ok === true && d.reward.delta === 0, d.reward)
ok('0 分档不加分，但 10-26 早起漏打被扣 1 → 2-1=1', (await walletOf(A)) === 1, await walletOf(A))
ok('记录里写着 0 分', fake.state.all('checkins').find((x) => x.openid === A && x.date === '2026-10-27').hearts === 0)
ok(
  '漏打扣了流水（reason 里带"漏打"）',
  fake.state.all('heart_logs').some((l) => String(l.reason).indexOf('漏打') >= 0)
)

console.log('\n[7] 记录页')
d = await call('checkin.history', { month: '2026-10' })
ok('记录页返回 ok', d.ok === true, d)
ok('10-26 和 10-27 都有记录', !!d.days['2026-10-26'] && !!d.days['2026-10-27'], Object.keys(d.days || {}))
ok('本月全勤 0 天（只有早睡）', d.stats.fullCount === 0, d.stats)
ok('门槛 22 天带回来了', d.stats.requiredDays === 22, d.stats)

console.log('\n[8] 连续天数按"这段关系"算')
const cidAB = coupleIdOf(A)
await seedFullDay(cidAB, A, '2026-10-24')
await seedFullDay(cidAB, A, '2026-10-25')
await asUser(A)
setNow(bj(2026, 10, 26, 23, 30))
d = await call('checkin.detail')
ok('两天全勤 → 连续 2 天', d.streak === 2, d.streak)

console.log('\n[9] 月度全勤：打满 22 天 → +10（只发一次）')
for (let i = 1; i <= 21; i++) {
  await seedFullDay(cidAB, A, '2026-09-' + String(i).padStart(2, '0'))
}
await asUser(A)
setNow(bj(2026, 9, 30, 21, 35))
d = await call('checkin.act', { type: 'sleep' })
ok('第 22 天的早睡只给档位 +2（这一晚还没打完）', d.reward.delta === 2, d.reward)

setNow(bj(2026, 10, 1, 6, 30))
d = await call('checkin.act', { type: 'wake' })
ok('这一晚打满 → 早起 +1 和全勤 +10 = 11', d.reward.delta === 11, d.reward)
ok(
  '奖励说明里有"月度全勤"',
  (d.reward.reasons || []).some((x) => x.indexOf('月度全勤') === 0),
  d.reward.reasons
)
ok(
  '月度全勤流水只写了一条（幂等）',
  fake.state.all('heart_logs').filter((l) => String(l.reason).indexOf('月度全勤') === 0).length === 1
)

d = await call('checkin.history', { month: '2026-09' })
ok('9 月全勤 22 天', d.stats.fullCount === 22, d.stats)
ok('达标标记为 true', d.stats.reached === true, d.stats)

console.log('\n[10] 解绑：二次确认 + 清零 + 封存')
const beforeUnbind = await walletOf(A)
ok('解绑前 A 有余额', beforeUnbind > 0, beforeUnbind)

await asUser(A)
r = await call('session.unbind', {})
ok('不给确认时拒绝解绑', r.ok === false && r.code === 'NO_CONFIRM', r)

r = await call('session.unbind', { confirm: true })
ok('确认后解绑成功', r.ok === true, r)
ok('解绑后回到未配对', r.needPair === true && r.bound === false, r)
ok('A 余额清零', r.wallet.balance === 0, r.wallet)

const old = fake.state.all('couples').find((c) => c._id === cidAB)
ok('旧关系被标记 dissolved', old && old.status === 'dissolved', old && old.status)
ok(
  '流水里留下"解除绑定清零"',
  !!fake.state.all('heart_logs').find((l) => l.reason === '解除绑定清零' && l.openid === A)
)

d = await call('checkin.detail')
ok('解绑后不能再用模块', d.ok === false && d.code === 'NOT_PAIRED', d)

console.log('\n[11] 重新配对：从零开始，不继承上一个人的数据')
r = await call('session.get')
const inviteA2 = r.inviteCode
ok('拿到新的邀请码', inviteA2 && inviteA2 !== inviteA, { old: inviteA, now: inviteA2 })

await register(C, '小刚')
r = await call('session.bind', { inviteCode: inviteA2 })
ok('A 和 C 重新配对成功', r.ok === true && r.bound === true, r)

await asUser(A)
setNow(bj(2026, 10, 28, 21, 40))
d = await call('checkin.detail')
ok('连续天数从 0 开始（旧记录不算）', d.streak === 0, d.streak)
ok('旧记录还在库里（封存，不删）', fake.state.all('checkins').filter((x) => x.coupleId === cidAB).length >= 4)
ok('10 月又是 0 天全勤', d.month.fullCount === 0, d.month)

console.log('\n[12] 幂等与对账')
const heartsCore = require('../cloudfunctions/api/core/hearts.js')
const cidNow = coupleIdOf(A)
const n1 = await heartsCore.apply(
  { openid: A, coupleId: cidNow },
  [{ delta: 1, reason: '幂等测试', idemKey: 'test-idem-1' }],
  { now: Date.now(), dateKey: '2026-10-30' }
)
const n2 = await heartsCore.apply(
  { openid: A, coupleId: cidNow },
  [{ delta: 1, reason: '幂等测试', idemKey: 'test-idem-1' }],
  { now: Date.now(), dateKey: '2026-10-30' }
)
ok('同一个 idemKey 只发一次', n1 === 1 && n2 === 0, { n1: n1, n2: n2 })

await asUser(A)
s = await call('session.verify')
ok('A 对账通过', s.ok === true && s.ledger === s.wallet, s)

console.log('\n[13] 打卡日：跨零点算同一晚')
await register(D, '阿呆')
let rd = await call('session.get')
await register(E, '阿瓜')
r = await call('session.bind', { inviteCode: rd.inviteCode })
ok('D 和 E 配对成功', r.ok === true, r)

await asUser(D)
setNow(bj(2026, 10, 30, 22, 30))
d = await call('checkin.act', { type: 'sleep' })
ok('10-30 22:30 早睡归属 10-30', d.ok === true && d.detail.today.date === '2026-10-30', d.detail && d.detail.today)

setNow(bj(2026, 10, 31, 6, 40))
d = await call('checkin.act', { type: 'wake' })
ok('10-31 06:40 的早起也归属 10-30', d.ok === true && d.detail.today.date === '2026-10-30', d.detail && d.detail.today)
ok('这一晚全勤成立', d.detail.today.fullDay === true)
ok('连续天数 1', d.detail.streak === 1, d.detail.streak)

setNow(bj(2026, 11, 1, 6, 0))
d = await call('checkin.act', { type: 'wake' })
ok('11-01 06:00 的早起归属 10-31', d.ok === true && d.detail.today.date === '2026-10-31', d.detail && d.detail.today)

d = await call('checkin.history', { month: '2026-10' })
ok('10 月日历里有 10-31', !!(d.days['2026-10-31'] && d.days['2026-10-31'].wake), d.days['2026-10-31'])
d = await call('checkin.history', { month: '2026-11' })
ok('11 月日历里没有它', !d.days['2026-10-31'], Object.keys(d.days || {}))

console.log('\n[13b] 自定义规则：往 core_settings 写一条，立即生效')
const cidDE = coupleIdOf(D)
await fake.db.collection('core_settings').add({
  data: {
    coupleId: cidDE,
    module: 'checkin',
    patch: { sleep: { tiers: [{ from: '21:30', to: '24:00', hearts: 9 }] } }
  }
})

await asUser(D)
d = await call('checkin.detail')
ok(
  '自定义档位被合并进 config',
  d.config.sleep.tiers.length === 1 && d.config.sleep.tiers[0].hearts === 9,
  d.config.sleep.tiers
)
ok('没覆盖的字段沿用默认值', d.config.wake.tiers[0].hearts === 1, d.config.wake.tiers)

setNow(bj(2026, 11, 1, 22, 0))
d = await call('checkin.act', { type: 'sleep' })
ok('按自定义规则发分（+9 而不是 +2）', d.ok === true && d.reward.delta === 9, d.reward)

d = await call('checkin.history', { month: '2026-11' })
ok('记录页也用新规则', d.ok === true)

console.log('\n[14] 缺卡扣分：惰性结算 + 幂等')
await asUser(D)
const balD1 = await walletOf(D)

const denied = await call('settle.run', {})
ok('非定时器调用结算被拒', denied.ok === false && denied.code === 'FORBIDDEN', denied)

d = await call('settle.run', { force: true })
ok('强制结算能跑通', d.ok === true, d)

const balD2 = await walletOf(D)
ok('重复结算不会重复扣分', balD1 === balD2, { before: balD1, after: balD2 })

const timerCall = await api.main({ action: 'settle.run', Type: 'Timer' })
ok('模拟定时触发器也能跑', timerCall.ok === true, timerCall)

console.log('\n[15] 缺卡申诉：工单 → 对方同意 → 退回爱心')
// 申诉要赶在截止时间前：10-31 早睡的截止是 11-01 12:00
setNow(bj(2026, 11, 1, 8, 0))
await asUser(D)
const balBeforeAppeal = await walletOf(D)

let ap = await call('checkin.appeal', { dayKey: '2026-11-01', type: 'sleep', reason: '还没到截止' })
ok('窗口还没关时不能申诉', ap.ok === false && ap.code === 'NOT_CLOSED', ap)

ap = await call('checkin.appeal', { dayKey: '2026-10-31', type: 'sleep', reason: '那天加班到两点' })
ok('申诉工单创建成功', ap.ok === true && !!ap.ticketId, ap)

ap = await call('checkin.appeal', { dayKey: '2026-10-31', type: 'sleep', reason: '再提一次' })
ok('同一件事不能重复提交', ap.ok === false && ap.code === 'TICKET_EXISTS', ap)

let list = await call('approvals.list')
ok('发起方能看到自己发起的工单', list.mine.length >= 1, list.mine.length)

await asUser(E)
list = await call('approvals.list')
ok('对方能看到"待我处理"', list.toMe.length >= 1, list.toMe.length)

const appealTk = list.toMe.find((t) => t.type === 'late_night')
ok('工单类型是晚睡说明', !!appealTk, list.toMe.map((t) => t.type))

let dec = null
if (appealTk) {
  dec = await call('approvals.decide', { id: appealTk.id, approve: true })
  ok('同意成功', dec.ok === true && dec.ticket.status === 'approved', dec)

  dec = await call('approvals.decide', { id: appealTk.id, approve: true })
  ok('同一张工单不能重复处理', dec.ok === false && dec.code === 'ALREADY_DECIDED', dec)

  await asUser(D)
  ok(
    '申诉通过后爱心退回 1',
    (await walletOf(D)) === balBeforeAppeal + 1,
    { before: balBeforeAppeal, after: await walletOf(D) }
  )
}

await asUser(E)
dec = await call('approvals.decide', { id: 'not-exist-id', approve: true })
ok('不存在的工单被拒', dec.ok === false && dec.code === 'NOT_FOUND', dec)

console.log('\n[16] 改规则：申请 → 校验 → 对方同意 → 生效')
await asUser(D)
const newCfg = JSON.parse(JSON.stringify(rules.DEFAULTS))
newCfg.sleep.tiers = [{ from: '21:30', to: '24:00', hearts: 4 }]

let pr = await call('checkin.proposeConfig', { config: newCfg })
ok('规则修改申请创建成功', pr.ok === true && !!pr.ticketId, pr)
ok('摘要里写了改了什么', typeof pr.summary === 'string' && pr.summary.length > 0, pr.summary)

const badCfg = JSON.parse(JSON.stringify(rules.DEFAULTS))
badCfg.sleep.tiers = [{ from: '21:30', to: '23:00', hearts: 99 }]
pr = await call('checkin.proposeConfig', { config: badCfg })
ok('非法规则被校验拦住（档位没覆盖到窗口结束）', pr.ok === false && pr.code === 'INVALID', pr)

const badCut = JSON.parse(JSON.stringify(rules.DEFAULTS))
badCut.cutoverHour = 22
pr = await call('checkin.proposeConfig', { config: badCut })
ok('cutoverHour 落在打卡时段里被拦住', pr.ok === false && pr.code === 'INVALID', pr.message)

await asUser(E)
list = await call('approvals.list')
const ruleTk = list.toMe.find((t) => t.type === 'rules_change')
ok('对方看到改规则工单', !!ruleTk, list.toMe.map((t) => t.type))

dec = await call('approvals.decide', { id: ruleTk.id, approve: true })
ok('同意改规则', dec.ok === true, dec)

await asUser(D)
d = await call('checkin.detail')
ok('新规则生效（早睡档位 +4）', d.config.sleep.tiers[0].hearts === 4, d.config.sleep.tiers)

console.log('\n[17] 容错与兜底')
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
