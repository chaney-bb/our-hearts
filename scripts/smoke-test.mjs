/**
 * 冒烟测试：验证打卡规则引擎 + 本地模式完整流程
 *
 * 用法：node scripts/smoke-test.mjs（或双击「同步规则.bat」）
 *
 * 1~3 段测"引擎"本身（用真实默认规则，不受你配置影响）
 * 4 段测本地模式跑一遍完整流程
 * 5 段反过来检查你当前的真实配置有没有写错
 */
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

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

function bj(y, m, d, h, mi) {
  return Date.UTC(y, m - 1, d, h, mi, 0, 0) - 8 * 3600 * 1000
}
function setNow(ts) {
  Date.now = function () {
    return ts
  }
}

const C = rules.normalizeConfig({})
const at = (h, mi) => bj(2026, 10, 26, h, mi)

console.log('\n[1] 早睡窗口与档位（21:30–24:00，2 / 1 / 0）')
ok('21:29 还没开放', rules.windowState('sleep', at(21, 29), C) === 'upcoming')
ok('21:30 开放，+2', rules.heartsAt('sleep', at(21, 30), C) === 2)
ok('22:14 仍是 +2', rules.heartsAt('sleep', at(22, 14), C) === 2)
ok('22:15 变成 +1（左闭右开）', rules.heartsAt('sleep', at(22, 15), C) === 1)
ok('23:14 还是 +1', rules.heartsAt('sleep', at(23, 14), C) === 1)
ok('23:15 变成 0', rules.heartsAt('sleep', at(23, 15), C) === 0)
ok('23:59 仍然可以打卡', rules.windowState('sleep', at(23, 59), C) === 'open')
ok('00:00 已经算新的一天（未开放）', rules.windowState('sleep', bj(2026, 10, 27, 0, 0), C) === 'upcoming')

console.log('\n[2] 早起窗口与档位（06:00–12:00，1 / 0）')
ok('05:59 还没开放', rules.windowState('wake', at(5, 59), C) === 'upcoming')
ok('06:00 开放，+1', rules.heartsAt('wake', at(6, 0), C) === 1)
ok('08:59 还是 +1', rules.heartsAt('wake', at(8, 59), C) === 1)
ok('09:00 变成 0', rules.heartsAt('wake', at(9, 0), C) === 0)
ok('11:59 仍然可以打卡', rules.windowState('wake', at(11, 59), C) === 'open')
ok('12:00 关闭', rules.windowState('wake', at(12, 0), C) === 'expired')

console.log('\n[3] 打卡日（中午 12 点前的打卡算前一天）')
ok('22:30 算当天', rules.sleepDayKey(bj(2026, 10, 26, 22, 30), C) === '2026-10-26')
ok('次日 06:40 算前一天', rules.sleepDayKey(bj(2026, 10, 27, 6, 40), C) === '2026-10-26')
ok('11:59 还算前一天', rules.sleepDayKey(bj(2026, 10, 27, 11, 59), C) === '2026-10-26')
ok('12:00 起算当天', rules.sleepDayKey(bj(2026, 10, 27, 12, 0), C) === '2026-10-27')
ok('跨月：11-01 06:00 算 10-31', rules.sleepDayKey(bj(2026, 11, 1, 6, 0), C) === '2026-10-31')

console.log('\n[4] 统计与配置合并')
ok(
  '全勤天数只数"两项都有"的日子',
  rules.countFullDays({
    '2026-10-01': { sleep: true, wake: true },
    '2026-10-02': { sleep: true, wake: false },
    '2026-10-03': { sleep: true, wake: true }
  }) === 2
)
ok('22 天达标', rules.monthlyReached(22, C) === true)
ok('21 天不达标', rules.monthlyReached(21, C) === false)
ok(
  '可配置：把门槛改成 20 天',
  rules.monthlyReached(20, rules.normalizeConfig({ monthly: { requiredDays: 20 } })) === true
)
ok(
  '可配置：改档位奖励',
  rules.heartsAt('sleep', at(22, 0), rules.normalizeConfig({ sleep: { tiers: [{ from: '21:30', to: '24:00', hearts: 5 }] } })) === 5
)
ok('未知配置项会被忽略', rules.normalizeConfig({ 乱写: 1 }).乱写 === undefined)
ok('数组是整体替换，不逐项合并', rules.normalizeConfig({ sleep: { tiers: [{ from: '21:30', to: '24:00', hearts: 3 }] } }).sleep.tiers.length === 1)

console.log('\n[5] 本地模式完整流程')
setNow(bj(2026, 10, 26, 21, 35))
async function wallet() {
  const s = await mock.call('session.get', {})
  return s.wallet.balance
}

const r1 = await mock.call('checkin.act', { type: 'sleep' })
ok('21:35 早睡 +2', r1.ok === true && r1.reward.delta === 2, r1.reward)
ok('爱心变成 2', (await wallet()) === 2)

const r2 = await mock.call('checkin.act', { type: 'sleep' })
ok('同一晚重复打卡被拦住', r2.ok === false && r2.code === 'DUP', r2)

const r3 = await mock.call('checkin.act', { type: 'wake' })
ok('晚上打早起卡被拦住', r3.ok === false && r3.code === 'CLOSED', r3)

setNow(bj(2026, 10, 27, 6, 20))
const r4 = await mock.call('checkin.act', { type: 'wake' })
ok('次日 06:20 早起 +1', r4.ok === true && r4.reward.delta === 1, r4.reward)
ok('打卡日归到 10-26', r4.detail.today.date === '2026-10-26', r4.detail.today.date)
ok('这一晚全勤成立', r4.detail.today.fullDay === true)
ok('爱心变成 3', (await wallet()) === 3)

setNow(bj(2026, 10, 27, 23, 20))
const r5 = await mock.call('checkin.act', { type: 'sleep' })
ok('23:20 打卡在 0 分档 → 不加爱心', r5.ok === true && r5.reward.delta === 0, r5.reward)
ok('爱心还是 3', (await wallet()) === 3)

const home = await mock.call('checkin.detail', {})
ok('连续天数 = 1', home.streak === 1, home.streak)
ok('今晚还没全勤（只打了早睡）', home.today.fullDay === false)
ok('本月全勤进度 1/22', home.month.fullCount === 1 && home.month.requiredDays === 22, home.month)

const history = await mock.call('checkin.history', { month: '2026-10' })
ok('10-26 全勤、10-27 只有早睡', !!history.days['2026-10-26'] && !!history.days['2026-10-27'])
ok('本月全勤 1 天', history.stats.fullCount === 1, history.stats)
ok('只有两次奖励（0 分档不产流水）', history.logs.length === 2, history.logs.length)

console.log('\n[6] 检查你当前的规则（miniprogram/utils/rules.js）')

function toMinutes(hhmm) {
  const parts = String(hhmm).split(':')
  return Number(parts[0]) * 60 + Number(parts[1])
}

rules.TYPES.forEach(function (type) {
  const t = C[type]
  const meta = rules.LABELS[type]
  const valid = /^\d{1,2}:\d{2}$/.test(t.window.start) && /^\d{1,2}:\d{2}$/.test(t.window.end)
  ok(meta.label + ' 时间格式 HH:mm', valid, t.window)
  if (!valid) return

  ok(meta.label + ' 开始早于结束', toMinutes(t.window.start) < toMinutes(t.window.end), t.window)

  const tiers = t.tiers || []
  ok(meta.label + ' 至少有一个档位', tiers.length > 0, tiers.length)
  ok(meta.label + ' 档位首尾对齐窗口', tiers.length > 0 && tiers[0].from === t.window.start && tiers[tiers.length - 1].to === t.window.end, {
    first: tiers[0] && tiers[0].from,
    last: tiers[tiers.length - 1] && tiers[tiers.length - 1].to
  })
  ok(meta.label + ' 档位时间递增', tiers.every((x, i) => i === 0 || toMinutes(x.from) === toMinutes(tiers[i - 1].to)), tiers)
})

ok('月度门槛在 1~31 之间', C.monthly.requiredDays >= 1 && C.monthly.requiredDays <= 31, C.monthly)

console.log('')
console.log('  当前生效的规则（写完代码自动生效，云端需要重新部署）：')
rules.TYPES.forEach(function (type) {
  const t = C[type]
  const meta = rules.LABELS[type]
  console.log('    ' + meta.emoji + ' ' + meta.label + '  ' + t.window.start + ' – ' + t.window.end + '   缺卡 -' + t.missPenalty)
  t.tiers.forEach(function (x) {
    console.log('        ' + x.from + ' – ' + x.to + '  →  +' + x.hearts)
  })
})
console.log(
  '    月度全勤：' + C.monthly.requiredDays + ' 天 → +' + C.monthly.bonus + '（' + C.monthly.scope + '）'
)

console.log('')
if (failed) {
  console.log('❌ 有 ' + failed + ' 个断言失败，看上面标 ❌ 的行')
  process.exit(1)
}
console.log('🎉 全部通过')
