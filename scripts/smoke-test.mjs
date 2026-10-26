/**
 * 冒烟测试：验证打卡引擎的正确性 + 检查你当前的规则配置
 *
 * 用法：node scripts/smoke-test.mjs（或者双击项目根目录的「同步规则.bat」）
 *
 * 设计要点：
 *   1~4 段用一套【固定的测试规则】跑断言，不受你在 rules.js 里怎么调影响。
 *   否则你改一次窗口，测试就红一次，最后大家都学会无视红字。
 *   第 5 段反过来，专门检查你当前的真实配置有没有写错。
 */
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

// --- 假装自己在微信里（mock.js 会用到 wx.storage） ---
let store = null
globalThis.wx = {
  getStorageSync: function () {
    return store
  },
  setStorageSync: function (k, v) {
    store = v
  }
}

const rules = require('../miniprogram/utils/rules.js')
const mock = require('../miniprogram/core/mock.js')

let failed = 0
function ok(name, condition, extra) {
  if (condition) {
    console.log('  ✅ ' + name)
  } else {
    failed++
    console.log('  ❌ ' + name + (extra !== undefined ? '  ->  ' + JSON.stringify(extra) : ''))
  }
}

// 北京时间 -> 时间戳
function bj(y, m, d, h, mi) {
  return Date.UTC(y, m - 1, d, h, mi, 0, 0) - 8 * 3600 * 1000
}
function setNow(ts) {
  Date.now = function () {
    return ts
  }
}

// ============ 用固定的测试规则，和你的配置解耦 ============
const REAL_RULES = JSON.parse(JSON.stringify(rules.RULES))
const TEST_WINDOWS = {
  sleep: { start: '21:30', end: '23:59', label: '早睡', emoji: '🌙', tip: '' },
  wake: { start: '05:30', end: '08:00', label: '早起', emoji: '☀️', tip: '' }
}

function useWindows(windows) {
  Object.keys(windows).forEach(function (k) {
    rules.RULES.windows[k] = Object.assign({}, windows[k])
  })
}

useWindows(TEST_WINDOWS)

console.log('\n[1] 时间窗口判定（测试规则：早睡 21:30–23:59，早起 05:30–08:00）')
setNow(bj(2026, 10, 26, 21, 0))
ok('21:00 早睡还没开始', rules.windowState('sleep', Date.now()) === 'upcoming', rules.windowState('sleep', Date.now()))
ok('21:00 早起已过', rules.windowState('wake', Date.now()) === 'expired')
setNow(bj(2026, 10, 26, 22, 0))
ok('22:00 早睡可以打卡', rules.windowState('sleep', Date.now()) === 'open')
setNow(bj(2026, 10, 26, 23, 59))
ok('23:59 早睡还可以打卡', rules.windowState('sleep', Date.now()) === 'open')
setNow(bj(2026, 10, 27, 0, 1))
// 注意：00:01 已经算"新的一天"了，早睡窗口是 21:30 才开始，所以是 upcoming 而不是 expired
ok('00:01 属于新的一天，早睡还没开始', rules.windowState('sleep', Date.now()) === 'upcoming')
setNow(bj(2026, 10, 27, 6, 30))
ok('06:30 早起可以打卡', rules.windowState('wake', Date.now()) === 'open')
setNow(bj(2026, 10, 27, 8, 30))
ok('08:30 早起窗口关闭', rules.windowState('wake', Date.now()) === 'expired')

console.log('\n[2] 连续天数')
ok(
  '今天全勤 -> 从今天往回数',
  rules.calcStreak(['2026-10-24', '2026-10-25', '2026-10-26'], '2026-10-26') === 3
)
ok(
  '今天还没打 -> 从昨天往回数，不打断',
  rules.calcStreak(['2026-10-24', '2026-10-25'], '2026-10-26') === 2
)
ok('断了一天就归零', rules.calcStreak(['2026-10-20'], '2026-10-26') === 0)

console.log('\n[3] 奖励计算')
const awards = rules.checkinAwards({
  type: 'sleep',
  isFullDay: true,
  partnerDone: true,
  streakAfter: 7
})
const total = awards.reduce(function (s, a) {
  return s + a.delta
}, 0)
ok('早睡1 + 全勤1 + 同步1 + 连续7天10 = 13', total === 13, awards)

console.log('\n[4] 本地模式完整流程')

setNow(bj(2026, 10, 26, 22, 5))
const r1 = await mock.call('checkin.act', { type: 'sleep' })
ok('22:05 早睡打卡成功', r1.ok === true && r1.reward.delta === 1, r1)
ok('爱心变成 1', r1.detail.hearts === 1, r1.detail.hearts)

const r2 = await mock.call('checkin.act', { type: 'sleep' })
ok('重复打卡被拦住', r2.ok === false && r2.code === 'DUP', r2)

const r3 = await mock.call('checkin.act', { type: 'wake' })
ok('22:05 打早起卡被拦住', r3.ok === false && r3.code === 'CLOSED', r3)

setNow(bj(2026, 10, 27, 6, 20))
const r4 = await mock.call('checkin.act', { type: 'wake' })
ok('第二天 06:20 早起成功 +1', r4.ok === true && r4.reward.delta === 1, r4)
ok('爱心变成 2', r4.detail.hearts === 2, r4.detail.hearts)

setNow(bj(2026, 10, 27, 22, 30))
const r5 = await mock.call('checkin.act', { type: 'sleep' })
ok('当晚 22:30 早睡 + 全勤奖 = 2', r5.ok === true && r5.reward.delta === 2, r5.reward)

const home = await mock.call('checkin.detail', {})
ok('首页连续天数 = 1', home.streak === 1, home.streak)
ok('今天两项都完成', home.today.fullDay === true)

const history = await mock.call('checkin.history', { month: '2026-10' })
ok('10 月记录里有 10-26 和 10-27', !!history.days['2026-10-26'] && !!history.days['2026-10-27'])
ok('10 月全勤 1 天', history.stats.fullCount === 1, history.stats)
ok('明细有 4 条奖励', history.logs.length === 4, history.logs.length)

// ============ 恢复你的真实配置，开始检查它 ============
useWindows(REAL_RULES.windows)
setNow(Date.now())

console.log('\n[5] 检查你当前的规则（miniprogram/utils/rules.js）')

function toMinutes(hhmm) {
  const parts = String(hhmm).split(':')
  return Number(parts[0]) * 60 + Number(parts[1])
}

rules.RULES.types.forEach(function (type) {
  const w = rules.RULES.windows[type]
  if (!w) {
    ok(type + ' 窗口存在', false)
    return
  }
  const valid = /^\d{1,2}:\d{2}$/.test(w.start) && /^\d{1,2}:\d{2}$/.test(w.end)
  ok(w.label + ' 时间格式是 HH:mm（例如 21:30）', valid, w)
  if (!valid) return

  const s = toMinutes(w.start)
  const e = toMinutes(w.end)
  ok(w.label + ' 开始时间早于结束时间（' + w.start + ' -> ' + w.end + '）', s < e, w)
  ok(w.label + ' 窗口不是空的（至少 10 分钟）', e - s >= 10, e - s)
})

const nowState = function (type) {
  return rules.windowState(type, Date.now())
}
console.log('')
console.log('  当前生效的窗口（写完代码自动生效，云端需要重新部署）：')
rules.RULES.types.forEach(function (type) {
  const w = rules.RULES.windows[type]
  const state = nowState(type)
  const stateText =
    state === 'open' ? '现在可以打卡' : state === 'upcoming' ? '还没开始' : '今天已过'
  console.log(
    '    ' + w.emoji + ' ' + w.label + '  ' + w.start + ' – ' + w.end + '   现在 → ' + stateText
  )
})
console.log('')
console.log('  分值：早睡 +' + rules.RULES.hearts.sleep + '  早起 +' + rules.RULES.hearts.wake +
  '  全勤 +' + rules.RULES.hearts.fullDay + '  同步 +' + rules.RULES.hearts.sync +
  '  连续7天 +' + rules.RULES.hearts.streak7 + '  连续30天 +' + rules.RULES.hearts.streak30)

console.log('')
if (failed) {
  console.log('❌ 有 ' + failed + ' 个断言失败，看上面标 ❌ 的行')
  process.exit(1)
}
console.log('🎉 全部通过')
