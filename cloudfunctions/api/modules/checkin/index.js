/**
 * 打卡模块（checkin）：早睡 / 早起
 *
 * 这是"模块契约"的样板，以后每个功能照这个写：
 *   key / name / emoji / collections / defaults / actions / on
 *
 * 模块只通过 ctx 用内核，不 require 任何别的模块。
 * 业务逻辑（时间窗口、奖励计算）沿用原来的实现，一行没改，
 * 只是从云函数入口搬到了这里。
 */
const clock = require('../../core/clock.js')
const rules = require('./rules.js')
const store = require('./store.js')
const hearts = require('../../core/hearts.js')
const respond = require('../../core/respond.js')

const LOOKBACK_DAYS = 60

/* ------------------------------ 内部工具 ------------------------------ */

async function todayRecords(ctx) {
  return store.getRecords(ctx, ctx.dateKey)
}

async function recentDays(ctx) {
  const fullDayKeys = await store.getFullDayKeys(ctx, ctx.dateKey, LOOKBACK_DAYS)
  const recent = []
  for (let i = 6; i >= 0; i--) {
    const k = clock.shiftKey(ctx.dateKey, -i)
    recent.push({ date: k, fullDay: fullDayKeys.indexOf(k) >= 0 })
  }
  return { fullDayKeys: fullDayKeys, recent: recent }
}

/* ------------------------------ 三个动作 ------------------------------ */

/**
 * 给外壳（首页宫格 / 总览）用：只返回几个数字，不返回整页数据
 */
async function summary(ctx) {
  const records = await todayRecords(ctx)
  const fullDayKeys = await store.getFullDayKeys(ctx, ctx.dateKey, LOOKBACK_DAYS)

  return {
    todayDone: (records.sleep ? 1 : 0) + (records.wake ? 1 : 0),
    todayTotal: rules.RULES.types.length,
    streak: rules.calcStreak(fullDayKeys, ctx.dateKey),
    hearts: await ctx.balance()
  }
}

/**
 * 模块自己的页面用：返回这一页要的全部数据
 */
async function detail(ctx) {
  const records = await todayRecords(ctx)
  const r = await recentDays(ctx)

  return {
    hearts: await ctx.balance(),
    streak: rules.calcStreak(r.fullDayKeys, ctx.dateKey),
    today: {
      date: ctx.dateKey,
      records: records,
      fullDay: !!(records.sleep && records.wake)
    },
    recent: r.recent,
    // 把云端正在用的规则带回去，客户端一比对就知道要不要重新部署
    rules: { windows: rules.RULES.windows, hearts: rules.RULES.hearts }
  }
}

/**
 * 写操作：打卡
 */
async function act(ctx, payload) {
  const type = payload.type
  const w = rules.RULES.windows[type]
  if (!w) return respond.biz('BAD_TYPE', '没有这个打卡项')

  // 关键：用 ctx.now（服务器时间），不用客户端时间
  const state = rules.windowState(type, ctx.now)
  if (state === 'upcoming') {
    return respond.biz(
      'NOT_YET',
      w.label + '打卡 ' + w.start + ' 才开始（云端现在 ' + clock.timeKey(ctx.now) + '）'
    )
  }
  if (state === 'expired') {
    return respond.biz(
      'CLOSED',
      '今天已经过了' + w.label + '打卡时间（窗口 ' + w.start + '–' + w.end + '）'
    )
  }

  if (await store.countType(ctx, ctx.openid, ctx.dateKey, type)) {
    return respond.biz('DUP', '今天已经打过卡啦')
  }

  await store.add(ctx, ctx.dateKey, type)

  const records = await todayRecords(ctx)
  const isFullDay = !!(records.sleep && records.wake)

  // 对方今天完成同一项了吗（同步奖）
  let partnerDone = false
  if (ctx.partner) {
    partnerDone = (await store.countType(ctx, ctx.partner.openid, ctx.dateKey, type)) > 0
  }

  const fullDayKeys = await store.getFullDayKeys(ctx, ctx.dateKey, LOOKBACK_DAYS)
  const streakAfter = rules.calcStreak(fullDayKeys, ctx.dateKey)

  const awards = rules.checkinAwards({
    type: type,
    isFullDay: isFullDay,
    partnerDone: partnerDone,
    streakAfter: streakAfter
  })

  let total = 0
  const reasons = []
  for (const a of awards) {
    total += a.delta
    reasons.push(a.reason + ' +' + a.delta)
    await ctx.award(a.delta, a.reason)
  }

  return {
    reward: { delta: total, reasons: reasons },
    detail: await detail(ctx)
  }
}

/**
 * 记录页：日历 + 统计 + 爱心明细
 */
async function history(ctx, payload) {
  const month = payload.month || clock.monthKey(ctx.now)
  const days = await store.getMonth(ctx, month)

  const fullKeys = Object.keys(days).filter(function (k) {
    return days[k].sleep && days[k].wake
  })

  const ledger = await hearts.history(ctx.openid, { start: month + '-01', end: month + '-31' })

  return {
    month: month,
    days: days,
    stats: { fullCount: fullKeys.length, bestStreak: bestStreakOf(fullKeys) },
    logs: ledger.logs,
    warn: ledger.warn,
    hearts: await ctx.balance()
  }
}

function bestStreakOf(keys) {
  const sorted = keys.slice().sort()
  let best = 0
  let run = 0
  let prev = ''
  for (const k of sorted) {
    if (prev && clock.shiftKey(prev, 1) === k) run++
    else run = 1
    if (run > best) best = run
    prev = k
  }
  return best
}

module.exports = {
  key: 'checkin',
  name: '早睡早起',
  emoji: '🌙',
  version: 1,

  // 本模块独占的集合（内核会拦住越权访问）
  collections: ['checkins'],

  // 规则默认值（P3 之后用户可以在设置页覆盖）
  defaults: {
    windows: rules.RULES.windows,
    hearts: rules.RULES.hearts
  },

  actions: {
    summary: summary,
    detail: detail,
    act: act,
    history: history
  },

  // 可选：订阅别的事件（现在没有，P5 再看）
  on: {}
}
