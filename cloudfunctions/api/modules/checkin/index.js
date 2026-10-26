/**
 * 打卡模块（checkin）：早睡 / 早起
 *
 * 模块契约样板：key / name / emoji / collections / defaults / actions / on
 * 模块只通过 ctx 用内核，不 require 任何别的模块。
 *
 * ⚠️ 两个"日期"概念：
 *   真实时间 ctx.now —— 判断"现在能不能打卡、能拿几分"（窗口 + 档位）
 *   打卡日 dayKey    —— 记录归属（中午 12 点前算前一天，因为那是同一晚）
 *
 * ⚠️ 规则全部来自 ctx.config（默认值 + 用户覆盖），不写死任何数值。
 */
const clock = require('../../core/clock.js')
const rules = require('./rules.js')
const store = require('./store.js')
const hearts = require('../../core/hearts.js')
const respond = require('../../core/respond.js')

const LOOKBACK_DAYS = 60

/* ------------------------------ 内部工具 ------------------------------ */

function cfgOf(ctx) {
  return ctx.config || rules.DEFAULTS
}

function dayKeyOf(ctx) {
  return rules.sleepDayKey(ctx.now, cfgOf(ctx))
}

async function todayRecords(ctx) {
  return store.getRecords(ctx, dayKeyOf(ctx))
}

async function fullDayKeys(ctx) {
  return store.getFullDayKeys(ctx, dayKeyOf(ctx), LOOKBACK_DAYS)
}

async function recentDays(ctx) {
  const dayKey = dayKeyOf(ctx)
  const keys = await fullDayKeys(ctx)
  const recent = []
  for (let i = 6; i >= 0; i--) {
    const k = clock.shiftKey(dayKey, -i)
    recent.push({ date: k, fullDay: keys.indexOf(k) >= 0 })
  }
  return { fullDayKeys: keys, recent: recent }
}

/* ------------------------------ 四个动作 ------------------------------ */

/**
 * 给外壳（首页宫格）用：几个数字 + 一句摘要
 */
async function summary(ctx) {
  const cfg = cfgOf(ctx)
  const records = await todayRecords(ctx)
  const keys = await fullDayKeys(ctx)
  const done = (records.sleep ? 1 : 0) + (records.wake ? 1 : 0)
  const streak = rules.calcStreak(keys, dayKeyOf(ctx))

  return {
    todayDone: done,
    todayTotal: rules.TYPES.length,
    streak: streak,
    sub: '今日 ' + done + '/' + rules.TYPES.length + ' · 连续 ' + streak + ' 天'
  }
}

/**
 * 模块自己的页面用
 * 注意：爱心余额不属于打卡模块，由 session.get 提供（账本是内核的）
 */
async function detail(ctx) {
  const cfg = cfgOf(ctx)
  const records = await todayRecords(ctx)
  const r = await recentDays(ctx)
  const dayKey = dayKeyOf(ctx)
  const days = await store.getMonth(ctx, dayKey.slice(0, 7))
  const fullCount = rules.countFullDays(days)

  return {
    streak: rules.calcStreak(r.fullDayKeys, dayKey),
    today: {
      date: dayKey,
      records: records,
      fullDay: !!(records.sleep && records.wake)
    },
    recent: r.recent,
    month: {
      month: dayKey.slice(0, 7),
      fullCount: fullCount,
      requiredDays: cfg.monthly.requiredDays,
      reached: rules.monthlyReached(fullCount, cfg)
    },
    // 服务端下发的完整规则，前端照着渲染（前端不再持有规则）
    config: cfg
  }
}

/**
 * 写操作：打卡
 */
async function act(ctx, payload) {
  const cfg = cfgOf(ctx)
  const type = payload.type
  const meta = rules.LABELS[type]
  if (!meta) return respond.biz('BAD_TYPE', '没有这个打卡项')

  // 窗口和档位都按"真实时间"算
  const state = rules.windowState(type, ctx.now, cfg)
  const t = cfg[type]
  if (state === 'upcoming') {
    return respond.biz(
      'NOT_YET',
      meta.label + '打卡 ' + t.window.start + ' 开放（云端现在 ' + clock.timeKey(ctx.now) + '）'
    )
  }
  if (state === 'expired') {
    return respond.biz(
      'CLOSED',
      '这一晚的' + meta.label + '打卡已经结束（窗口 ' + t.window.start + '–' + t.window.end + '）'
    )
  }

  const dayKey = dayKeyOf(ctx)

  if (await store.countType(ctx, ctx.openid, dayKey, type)) {
    return respond.biz('DUP', '这一晚已经打过' + meta.label + '卡啦')
  }

  // 档位奖励：按打卡那一刻的时间算
  const heartsAt = rules.heartsAt(type, ctx.now, cfg)
  const base = typeof heartsAt === 'number' ? heartsAt : 0

  await store.add(ctx, dayKey, type, base)

  const records = await todayRecords(ctx)
  const reasons = []
  let total = 0

  if (base > 0) {
    await ctx.award(base, meta.label + '打卡', { refId: dayKey })
    total += base
    reasons.push(meta.label + '打卡 +' + base)
  } else {
    reasons.push(meta.label + '打卡（这一档没有爱心）')
  }

  // 同步奖（默认关闭；想开就把 config.syncBonus 设成 1）
  if (cfg.syncBonus > 0 && ctx.partner) {
    const partnerDone = (await store.countType(ctx, ctx.partner.openid, dayKey, type)) > 0
    if (partnerDone) {
      await ctx.award(cfg.syncBonus, '同步' + meta.label, { refId: dayKey })
      total += cfg.syncBonus
      reasons.push('同步' + meta.label + ' +' + cfg.syncBonus)
    }
  }

  // 月度全勤：这一晚凑齐全勤后，看本月是否达标（幂等，同一个月只发一次）
  if (records.sleep && records.wake) {
    const days = await store.getMonth(ctx, dayKey.slice(0, 7))
    const fullCount = rules.countFullDays(days)
    if (rules.monthlyReached(fullCount, cfg)) {
      const month = dayKey.slice(0, 7)
      const got = await ctx.award(cfg.monthly.bonus, '月度全勤 ' + month, {
        idemKey: 'monthly:' + month
      })
      if (got) {
        total += got
        reasons.push('月度全勤（' + fullCount + ' 天） +' + got)
      }
    }
  }

  const keys = await fullDayKeys(ctx)

  return {
    reward: { delta: total, reasons: reasons },
    detail: await detail(ctx),
    streak: rules.calcStreak(keys, dayKey)
  }
}

/**
 * 记录页：日历 + 统计 + 爱心明细
 * 月份也按打卡日归属：11-01 早上 6 点的早起会出现在 10 月
 */
async function history(ctx, payload) {
  const cfg = cfgOf(ctx)
  const month = payload.month || dayKeyOf(ctx).slice(0, 7)
  const days = await store.getMonth(ctx, month)

  const fullKeys = Object.keys(days).filter(function (k) {
    return days[k].sleep && days[k].wake
  })

  const ledger = await hearts.history(ctx.openid, { start: month + '-01', end: month + '-31' })

  return {
    month: month,
    days: days,
    stats: {
      fullCount: fullKeys.length,
      bestStreak: rules.bestStreak(fullKeys),
      requiredDays: cfg.monthly.requiredDays,
      reached: rules.monthlyReached(fullKeys.length, cfg),
      bonus: cfg.monthly.bonus
    },
    logs: ledger.logs,
    warn: ledger.warn,
    hearts: await ctx.balance()
  }
}

module.exports = {
  key: 'checkin',
  name: '早睡早起',
  emoji: '🌙',
  version: 2,

  collections: ['checkins'],

  // 规则默认值（用户覆盖存 core_settings，合并后就是 ctx.config）
  defaults: rules.DEFAULTS,

  actions: {
    summary: summary,
    detail: detail,
    act: act,
    history: history
  },

  on: {}
}
