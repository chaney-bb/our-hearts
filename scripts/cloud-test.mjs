/**
 * 云函数集成测试：用假数据库把 cloudfunctions/api/index.js 完整跑一遍
 *
 * 用法：node scripts/cloud-test.mjs
 *
 * 它验证的是"云端真实逻辑"，包括：
 *   首次打开自动建档 / 打卡 / 重复拦截 / 时间窗口 / 邀请码配对 / 同步奖 / 记录页
 * 而且不需要连真云开发、不需要部署，改完云函数先在这里跑一遍。
 */
import Module from 'node:module'
import { createRequire } from 'node:module'
import { createFakeCloud } from './fake-cloud.mjs'

const require = createRequire(import.meta.url)
const fake = createFakeCloud()

// 把 require('wx-server-sdk') 换成假货
const originalLoad = Module._load
Module._load = function (request, parent, isMain) {
  if (request === 'wx-server-sdk') return fake.sdk
  return originalLoad.call(this, request, parent, isMain)
}

const api = require('../cloudfunctions/api/index.js')
const rules = require('../cloudfunctions/api/rules.js')

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

const A = 'openid_A'
const B = 'openid_B'

// 用一个一定在窗口内的时间（不管是默认规则还是你改过的规则）
function atDay(y, m, d, minutes) {
  return bj(y, m, d, Math.floor(minutes / 60), minutes % 60)
}

const sleepW = rules.RULES.windows.sleep
const wakeW = rules.RULES.windows.wake
const sleepMid = Math.floor((rules.minutesOf(sleepW.start) + rules.minutesOf(sleepW.end)) / 2)
const wakeMid = Math.floor((rules.minutesOf(wakeW.start) + rules.minutesOf(wakeW.end)) / 2)

const sleepAt = atDay(2026, 10, 26, sleepMid)
const sleepAt27 = atDay(2026, 10, 27, sleepMid)
const wakeAt = atDay(2026, 10, 27, wakeMid)

// 造一个"一定在窗口外"的时间，用来验证云端会拦住
const outsideMin = (() => {
  const s = rules.minutesOf(sleepW.start)
  const e = rules.minutesOf(sleepW.end)
  if (s >= 60) return s - 60
  if (e <= 1380) return e + 60
  return null
})()
const outsideAt = outsideMin === null ? null : atDay(2026, 10, 29, outsideMin)

console.log('\n[1] 第一次打开：自动建档 + 生成邀请码')
fake.state.setOpenid(A)
setNow(bj(2026, 10, 26, 12, 0))
let res = await api.main({ action: 'home' })
ok('返回 ok', res.ok === true, res)
ok('自动建了 1 条 profile', fake.state.all('profiles').length === 1)
ok('自动建了 1 条 couple', fake.state.all('couples').length === 1)
ok('邀请码 6 位', typeof res.inviteCode === 'string' && res.inviteCode.length === 6, res.inviteCode)
ok('还没配对', res.bound === false)
ok('爱心从 0 开始', res.hearts === 0)
ok('首页带回了云端的规则', !!(res.rules && res.rules.windows && res.rules.hearts), res.rules)
const inviteCode = res.inviteCode

console.log('\n[2] 打卡')
setNow(sleepAt)
res = await api.main({ action: 'checkin', type: 'sleep' })
ok('早睡打卡成功', res.ok === true && res.reward && res.reward.delta >= 1, res)
ok('爱心增加了', res.home.hearts >= 1, res.home.hearts)
ok('记录里多了一条 checkin', fake.state.all('checkins').length === 1)
ok('爱心流水也写了', fake.state.all('heart_logs').length >= 1)

res = await api.main({ action: 'checkin', type: 'sleep' })
ok('重复打卡被拦截', res.ok === false && res.code === 'DUP', res)

if (outsideAt) {
  setNow(outsideAt)
  res = await api.main({ action: 'checkin', type: 'sleep' })
  ok(
    '窗口外的打卡被拦（时间判定在云端）',
    res.ok === false && (res.code === 'NOT_YET' || res.code === 'CLOSED'),
    res
  )
  ok('拦截时会说清窗口和云端当前时间', typeof res.message === 'string' && /\d{1,2}:\d{2}/.test(res.message), res.message)
}

console.log('\n[3] 邀请码配对')
fake.state.setOpenid(B)
setNow(bj(2026, 10, 26, 12, 10))
res = await api.main({ action: 'home' })
ok('B 也有了自己的邀请码', res.ok === true && res.bound === false)

res = await api.main({ action: 'joinCouple', inviteCode: 'XXXXXX' })
ok('错邀请码被拒绝', res.ok === false && res.code === 'NOT_FOUND', res)

res = await api.main({ action: 'joinCouple', inviteCode: inviteCode })
ok('正确邀请码配对成功', res.ok === true && res.home.bound === true, res)
res = await api.main({ action: 'joinCouple', inviteCode: inviteCode })
ok('满员后再加被拒', res.ok === false, res)

fake.state.setOpenid(A)
res = await api.main({ action: 'home' })
ok('A 那边也看到对象了', res.ok === true && res.bound === true && res.partner, res.partner)
ok('两个人共用一个爱心池', res.hearts === fake.state.all('couples').find((c) => c.members.length === 2).hearts)

console.log('\n[4] 同步奖（两个人都完成同一项）')
fake.state.setOpenid(B)
setNow(sleepAt + 60 * 1000)
res = await api.main({ action: 'checkin', type: 'sleep' })
const reasons = (res.reward && res.reward.reasons) || []
ok('B 打卡时拿到同步奖', reasons.some((r) => r.indexOf('同步') === 0), reasons)

console.log('\n[5] 记录页')
setNow(wakeAt)
fake.state.setOpenid(A)
res = await api.main({ action: 'checkin', type: 'wake' })
ok('早起打卡成功', res.ok === true, res)

// 同一天再补一次早睡，凑出一个"全勤日"
setNow(sleepAt27)
res = await api.main({ action: 'checkin', type: 'sleep' })
ok('第二天早睡打卡成功', res.ok === true, res)

res = await api.main({ action: 'history', month: '2026-10' })
ok('记录页返回 ok', res.ok === true, res)
ok('日历里有 10-26 和 10-27', !!res.days['2026-10-26'] && !!res.days['2026-10-27'], Object.keys(res.days || {}))
ok('全勤统计出来了', res.stats.fullCount >= 1, res.stats)
ok('爱心明细按时间倒序', res.logs.length > 0 && res.logs[0].at >= res.logs[res.logs.length - 1].at)
ok('没有 warn', res.warn === '', res.warn)

// 下面两段是故意制造失败的测试，云函数会往 stderr 打堆栈，
// 那不是真错误，但也别吓人 —— 临时把 console.error 静音。
const realError = console.error
function silence() {
  console.error = function () {}
}
function unsilence() {
  console.error = realError
}

console.log('\n[6] 容错：heart_logs 集合不存在（这就是你遇到的那个错）')
fake.state.drop('heart_logs')
silence()
res = await api.main({ action: 'history', month: '2026-10' })
unsilence()
ok('记录页没有整个挂掉', res.ok === true, res)
ok('日历数据照常返回', !!res.days['2026-10-26'])
ok('爱心明细降级成空数组', Array.isArray(res.logs) && res.logs.length === 0, res.logs)
ok('给出人话提示', typeof res.warn === 'string' && res.warn.indexOf('heart_logs') >= 0, res.warn)

console.log('\n[7] 兜底错误会把真实原因带出来')
fake.state.drop('checkins')
setNow(bj(2026, 10, 26, 22, 0))
fake.state.setOpenid(A)
silence()
res = await api.main({ action: 'home' })
unsilence()
ok('出错时不返回"服务打了个盹"', res.ok === false, res)
ok('message 里点明了是哪个 action', typeof res.message === 'string' && res.message.indexOf('home') >= 0, res.message)
ok('detail 里有原始错误', typeof res.detail === 'string' && res.detail.length > 0, res.detail)

console.log('')
if (failed) {
  console.log('❌ 有 ' + failed + ' 个断言失败')
  process.exit(1)
}
console.log('🎉 全部通过')
