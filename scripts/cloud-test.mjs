/**
 * 云函数集成测试：用假数据库把 cloudfunctions/api 完整跑一遍
 *
 * 用法：node scripts/cloud-test.mjs
 *
 * 验证的是"云端真实逻辑"，包括：
 *   首次打开自动建档 / 邀请码 / 打卡 / 重复拦截 / 时间窗口 /
 *   配对 / 同步奖 / 记录页 / 缺集合容错 / 兜底错误带原因
 * 不需要连真云开发、不需要部署。
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

// 调云端接口（模拟小程序：action + payload）
function call(action, payload) {
  return api.main({ action: action, payload: payload || {} })
}

// 下面两段是故意制造失败的测试，云函数会往 stderr 打堆栈，别吓人
const realError = console.error
function silence() {
  console.error = function () {}
}
function unsilence() {
  console.error = realError
}

const A = 'openid_A'
const B = 'openid_B'

const sleepW = rules.RULES.windows.sleep
const wakeW = rules.RULES.windows.wake
const sleepMid = Math.floor((rules.minutesOf(sleepW.start) + rules.minutesOf(sleepW.end)) / 2)
const wakeMid = Math.floor((rules.minutesOf(wakeW.start) + rules.minutesOf(wakeW.end)) / 2)

const sleepAt = atDay(2026, 10, 26, sleepMid)
const sleepAt27 = atDay(2026, 10, 27, sleepMid)
const wakeAt = atDay(2026, 10, 27, wakeMid)

const outsideMin = (() => {
  const s = rules.minutesOf(sleepW.start)
  const e = rules.minutesOf(sleepW.end)
  if (s >= 60) return s - 60
  if (e <= 1380) return e + 60
  return null
})()
const outsideAt = outsideMin === null ? null : atDay(2026, 10, 29, outsideMin)

console.log('\n[1] 第一次打开：内核建档 + 打卡模块出数')
fake.state.setOpenid(A)
setNow(bj(2026, 10, 26, 12, 0))

let s = await call('session.get')
ok('session.get 返回 ok', s.ok === true, s)
ok('自动建了 1 条 profile', fake.state.all('profiles').length === 1)
ok('自动建了 1 条 couple', fake.state.all('couples').length === 1)
ok('邀请码 6 位', typeof s.inviteCode === 'string' && s.inviteCode.length === 6, s.inviteCode)
ok('还没配对', s.bound === false)
const inviteCode = s.inviteCode

let d = await call('checkin.detail')
ok('checkin.detail 返回 ok', d.ok === true, d)
ok('爱心从 0 开始', d.hearts === 0, d.hearts)
ok('今天还没打卡', d.today.fullDay === false)
ok('带回了云端规则', !!(d.rules && d.rules.windows), d.rules)

let sum = await call('checkin.summary')
ok('checkin.summary 只返回数字', sum.ok === true && sum.todayDone === 0 && sum.todayTotal === 2, sum)

console.log('\n[2] 打卡')
setNow(sleepAt)
d = await call('checkin.act', { type: 'sleep' })
ok('早睡打卡成功', d.ok === true && d.reward && d.reward.delta >= 1, d)
ok('爱心增加了', d.detail.hearts >= 1, d.detail.hearts)
ok('记录里多了一条 checkin', fake.state.all('checkins').length === 1)
ok('爱心流水也写了', fake.state.all('heart_logs').length >= 1)

d = await call('checkin.act', { type: 'sleep' })
ok('重复打卡被拦截', d.ok === false && d.code === 'DUP', d)

if (outsideAt) {
  setNow(outsideAt)
  d = await call('checkin.act', { type: 'sleep' })
  ok(
    '窗口外的打卡被拦（时间判定在云端）',
    d.ok === false && (d.code === 'NOT_YET' || d.code === 'CLOSED'),
    d
  )
  ok('拦截时说清了窗口和云端当前时间', typeof d.message === 'string' && /\d{1,2}:\d{2}/.test(d.message), d.message)
}

console.log('\n[3] 邀请码配对')
fake.state.setOpenid(B)
setNow(bj(2026, 10, 26, 12, 10))
s = await call('session.get')
ok('B 也有了自己的邀请码', s.ok === true && s.bound === false)

s = await call('session.bind', { inviteCode: 'XXXXXX' })
ok('错邀请码被拒绝', s.ok === false && s.code === 'NOT_FOUND', s)

s = await call('session.bind', { inviteCode: inviteCode })
ok('正确邀请码配对成功', s.ok === true && s.bound === true, s)
s = await call('session.bind', { inviteCode: inviteCode })
ok('满员后再加被拒', s.ok === false, s)

fake.state.setOpenid(A)
s = await call('session.get')
ok('A 那边也看到对象了', s.ok === true && s.bound === true && s.partner, s.partner)

d = await call('checkin.detail')
const coupleDoc = fake.state.all('couples').find((c) => c.members.length === 2)
ok('爱心余额和账本对得上', d.hearts === coupleDoc.hearts, { detail: d.hearts, couple: coupleDoc.hearts })

console.log('\n[4] 同步奖（两个人都完成同一项）')
fake.state.setOpenid(B)
setNow(sleepAt + 60 * 1000)
d = await call('checkin.act', { type: 'sleep' })
const reasons = (d.reward && d.reward.reasons) || []
ok('B 打卡时拿到同步奖', reasons.some((r) => r.indexOf('同步') === 0), reasons)

console.log('\n[5] 记录页')
setNow(wakeAt)
fake.state.setOpenid(A)
d = await call('checkin.act', { type: 'wake' })
ok('早起打卡成功', d.ok === true, d)

setNow(sleepAt27)
d = await call('checkin.act', { type: 'sleep' })
ok('第二天早睡打卡成功', d.ok === true, d)

let h = await call('checkin.history', { month: '2026-10' })
ok('记录页返回 ok', h.ok === true, h)
ok('日历里有 10-26 和 10-27', !!h.days['2026-10-26'] && !!h.days['2026-10-27'], Object.keys(h.days || {}))
ok('全勤统计出来了', h.stats.fullCount >= 1, h.stats)
ok('爱心明细按时间倒序', h.logs.length > 0 && h.logs[0].at >= h.logs[h.logs.length - 1].at)
ok('没有 warn', h.warn === '', h.warn)

console.log('\n[6] 容错：heart_logs 集合不存在')
fake.state.drop('heart_logs')
silence()
h = await call('checkin.history', { month: '2026-10' })
unsilence()
ok('记录页没有整个挂掉', h.ok === true, h)
ok('日历数据照常返回', !!h.days['2026-10-26'])
ok('爱心明细降级成空数组', Array.isArray(h.logs) && h.logs.length === 0, h.logs)
ok('给出人话提示', typeof h.warn === 'string' && h.warn.indexOf('heart_logs') >= 0, h.warn)

console.log('\n[7] 兜底错误会把真实原因带出来')
fake.state.drop('checkins')
fake.state.setOpenid(A)
silence()
d = await call('checkin.detail')
unsilence()
ok('出错时返回 ok:false', d.ok === false, d)
ok('message 点明了是哪个接口', typeof d.message === 'string' && d.message.indexOf('checkin.detail') >= 0, d.message)
ok('detail 里有原始错误', typeof d.detail === 'string' && d.detail.length > 0, d.detail)

console.log('\n[8] 旧接口名给出明确提示（防止云函数比界面新）')
const legacy = await call('home')
ok('旧接口不会静默失败', legacy.ok === false && legacy.code === 'CLIENT_OUTDATED', legacy)

console.log('\n[9] 未知模块 / 未知动作')
const noMod = await call('notexist.act')
ok('未知模块被拒绝', noMod.ok === false && noMod.code === 'NO_MODULE', noMod)
const noAct = await call('checkin.notexist')
ok('未知动作被拒绝', noAct.ok === false && noAct.code === 'NO_ACTION', noAct)

console.log('')
if (failed) {
  console.log('❌ 有 ' + failed + ' 个断言失败')
  process.exit(1)
}
console.log('🎉 全部通过')
