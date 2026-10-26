/**
 * 打卡模块（checkin）：早睡 / 早起
 *
 * 模块契约：key / name / emoji / collections / defaults / actions / on / onDecision
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
const settings = require('../../core/settings.js')
const approvals = require('../../core/approvals.js')
const respond = require('../../core/respond.js')

const LOOKBACK_DAYS = 60
const SETTLE_DAYS = 3 // 惰性结算只看最近 3 个打卡日

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

/** 最近 N 个打卡日（含当前这个） */
function recentDayKeys(dayKey, n) {
  const out = []
  for (let i = 0; i < n; i++) out.push(clock.shiftKey(dayKey, -i))
  return out
}

/**
 * 惰性结算：把"窗口已经关了但没打卡"的日子扣掉
 *
 * 幂等：每次扣分都带 idemKey = 'miss:<type>:<打卡日>'，
 * 所以定时器跑、用户打开小程序跑、重复跑，都只会扣一次。
 */
async function settle(ctx) {
  const cfg = cfgOf(ctx)
  const today = dayKeyOf(ctx)
  const penalized = []

  // 不结算"配对之前"的日子（刚配对不该被倒扣历史）
  const since = ctx.couple && ctx.couple.pairedAt ? rules.sleepDayKey(ctx.couple.pairedAt, cfg) : ''

  for (const day of recentDayKeys(today, SETTLE_DAYS + 1)) {
    if (since && day < since) continue
    for (const type of rules.TYPES) {
      const t = cfg[type]
      if (!t || !t.missPenalty) continue
      if (!rules.windowClosed(day, type, cfg, ctx.now)) continue // 还没关窗，不算缺卡
      if (await store.countType(ctx, ctx.openid, day, type)) continue // 打了

      const amount = await ctx.penalize(t.missPenalty, rules.LABELS[type].label + '漏打 ' + day, {
        idemKey: 'miss:' + type + ':' + day,
        refId: day
      })
      if (amount) {
        penalized.push({ day: day, type: type, amount: amount })
      }
    }
  }

  return { penalized: penalized }
}

/** 还没打、但已经关窗的日子（给页面显示"可以申诉"的卡片） */
async function missedList(ctx) {
  const cfg = cfgOf(ctx)
  const today = dayKeyOf(ctx)
  const out = []
  // 和 settle 用同一个门槛：配对之前的日子不算缺卡
  const since = ctx.couple && ctx.couple.pairedAt ? rules.sleepDayKey(ctx.couple.pairedAt, cfg) : ''

  for (const day of recentDayKeys(today, SETTLE_DAYS + 1)) {
    if (since && day < since) continue
    for (const type of rules.TYPES) {
      const t = cfg[type]
      if (!t || !t.missPenalty) continue
      if (!rules.windowClosed(day, type, cfg, ctx.now)) continue
      if (await store.countType(ctx, ctx.openid, day, type)) continue

      out.push({
        dayKey: day,
        type: type,
        label: rules.LABELS[type].label,
        emoji: rules.LABELS[type].emoji,
        penalty: t.missPenalty,
        appealable: !!t.allowAppeal && ctx.now <= rules.appealDeadlineMs(day, type, cfg)
      })
    }
  }

  return out
}

/* ------------------------------ 动作 ------------------------------ */

/**
 * 给外壳（首页宫格）用：几个数字 + 一句摘要
 */
async function summary(ctx) {
  await settle(ctx)
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
 * 模块自己的页面用（顺手做一次惰性结算）
 */
async function detail(ctx) {
  await settle(ctx)

  const cfg = cfgOf(ctx)
  const records = await todayRecords(ctx)
  const r = await recentDays(ctx)
  const dayKey = dayKeyOf(ctx)
  const month = dayKey.slice(0, 7)
  const days = await store.getMonth(ctx, month)
  const fullCount = rules.countFullDays(days)
  const cal = await store.getMonthBoth(ctx, month, ctx.partner ? ctx.partner.openid : '')

  return {
    streak: rules.calcStreak(r.fullDayKeys, dayKey),
    today: {
      date: dayKey,
      records: records,
      fullDay: !!(records.sleep && records.wake)
    },
    recent: r.recent,
    month: {
      month: month,
      fullCount: fullCount,
      requiredDays: cfg.monthly.requiredDays,
      reached: rules.monthlyReached(fullCount, cfg)
    },
    calendar: { month: month, days: cal },
    misses: await missedList(ctx),
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

  // 月度全勤（幂等，同一个月只发一次）
  if (records.sleep && records.wake) {
    const days = await store.getMonth(ctx, dayKey.slice(0, 7))
    const fullCount = rules.countFullDays(days)
    if (rules.monthlyReached(fullCount, cfg)) {
      const month = dayKey.slice(0, 7)
      const got = await ctx.award(cfg.monthly.bonus, '月度全勤 ' + month, { idemKey: 'monthly:' + month })
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

/**
 * 缺卡申诉：生成一张"晚睡/晚起说明"工单给对象审批
 */
async function appeal(ctx, payload) {
  const cfg = cfgOf(ctx)
  const type = payload.type
  const dayKey = payload.dayKey
  const reason = String(payload.reason || '').trim()

  if (!rules.LABELS[type]) return respond.biz('BAD_TYPE', '没有这个打卡项')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dayKey || ''))) return respond.biz('BAD_DAY', '日期不对')
  if (!ctx.partner) return respond.biz('NOT_PAIRED', '先和 TA 配对')

  const t = cfg[type]
  if (!t.allowAppeal) return respond.biz('NO_APPEAL', '这个打卡项没开申诉')
  if (!rules.windowClosed(dayKey, type, cfg, ctx.now)) {
    return respond.biz('NOT_CLOSED', '这一晚还没结束，先打卡试试')
  }
  if (await store.countType(ctx, ctx.openid, dayKey, type)) {
    return respond.biz('ALREADY_DONE', '这一天你已经打过卡了')
  }
  if (ctx.now > rules.appealDeadlineMs(dayKey, type, cfg)) {
    return respond.biz('EXPIRED', '申诉时间已经过了')
  }
  if (reason.length < 2) return respond.biz('NEED_REASON', '写一句说明吧，对方才知道发生了什么')

  const meta = rules.LABELS[type]
  const ticket = await approvals.create({
    module: 'checkin',
    type: type === 'sleep' ? 'late_night' : 'late_wake',
    coupleId: ctx.coupleId,
    fromOpenid: ctx.openid,
    toOpenid: ctx.partner.openid,
    refId: dayKey + ':' + type,
    title: (type === 'sleep' ? '晚睡说明' : '晚起说明') + ' · ' + dayKey,
    summary: reason,
    payload: { dayKey: dayKey, type: type, penalty: t.missPenalty, reason: reason }
  })

  return { ticketId: ticket._id, status: ticket.status }
}

/**
 * 发起"修改打卡规则"申请（不会直接生效，要对方同意）
 */
async function proposeConfig(ctx, payload) {
  if (!ctx.partner) return respond.biz('NOT_PAIRED', '先和 TA 配对')

  const cfg = payload.config
  if (!cfg) return respond.biz('EMPTY', '没有收到规则内容')

  const check = rules.validateConfig(cfg)
  if (!check.ok) {
    return respond.biz('INVALID', check.errors[0].message, check.errors)
  }

  const ticket = await approvals.create({
    module: 'checkin',
    type: 'rules_change',
    coupleId: ctx.coupleId,
    fromOpenid: ctx.openid,
    toOpenid: ctx.partner.openid,
    refId: 'rules:' + Date.now(),
    title: '修改打卡规则',
    summary: describeChanges(cfgOf(ctx), cfg),
    payload: { config: cfg }
  })

  return { ticketId: ticket._id, status: ticket.status, summary: ticket.summary }
}

/** 生成一句人话的变更摘要（给审批的人看） */
function describeChanges(oldCfg, newCfg) {
  const parts = []
  const hm = (t) => t.window.start + '–' + t.window.end
  rules.TYPES.forEach(function (type) {
    const meta = rules.LABELS[type]
    if (hm(oldCfg[type]) !== hm(newCfg[type])) {
      parts.push(meta.label + '窗口 ' + hm(newCfg[type]))
    }
    const oldT = (oldCfg[type].tiers || []).map((x) => x.hearts).join('/')
    const newT = (newCfg[type].tiers || []).map((x) => x.hearts).join('/')
    if (oldT !== newT) parts.push(meta.label + '分值 ' + newT)
    if (oldCfg[type].missPenalty !== newCfg[type].missPenalty) {
      parts.push(meta.label + '缺卡扣 ' + newCfg[type].missPenalty)
    }
  })
  if (oldCfg.monthly.requiredDays !== newCfg.monthly.requiredDays) {
    parts.push('全勤门槛 ' + newCfg.monthly.requiredDays + ' 天')
  }
  if (oldCfg.monthly.bonus !== newCfg.monthly.bonus) {
    parts.push('全勤奖 +' + newCfg.monthly.bonus)
  }
  return parts.length ? parts.join('；') : '规则细节有调整'
}

/* ------------------------------ 审批结果回调 ------------------------------ */

/**
 * 对方点了同意/拒绝之后，模块自己承担后果
 * env: { coupleId, openid(处理人), now }
 */
const onDecision = {
  // 申诉通过 → 把扣掉的爱心退回来
  late_night: refundIfApproved,
  late_wake: refundIfApproved,

  // 规则修改通过 → 写入配置（只影响之后的打卡）
  rules_change: async function (env, ticket, decision) {
    if (!decision.approve) return { applied: false }
    const cfg = ticket.payload && ticket.payload.config
    if (!cfg) return { applied: false }
    if (!rules.validateConfig(cfg).ok) return { applied: false, error: '规则不合法，未生效' }
    await settings.save(env.coupleId, 'checkin', cfg)
    return { applied: true, saved: true }
  }
}

async function refundIfApproved(env, ticket, decision) {
  if (!decision.approve) return { applied: false }
  const p = ticket.payload || {}
  const amount = p.penalty || 0
  if (!amount) return { applied: false }

  const got = await hearts.apply(
    { openid: ticket.fromOpenid, coupleId: env.coupleId },
    [
      {
        delta: amount,
        reason: '申诉通过退回（' + p.dayKey + ' ' + (rules.LABELS[p.type] ? rules.LABELS[p.type].label : '') + '）',
        refId: p.dayKey,
        idemKey: 'appeal:' + ticket._id
      }
    ],
    { now: env.now, dateKey: rules.sleepDayKey(env.now, rules.DEFAULTS), module: 'checkin' }
  )

  return { applied: got > 0, refunded: got }
}

module.exports = {
  key: 'checkin',
  name: '早睡早起',
  emoji: '🌙',
  version: 3,

  collections: ['checkins'],

  defaults: rules.DEFAULTS,

  actions: {
    summary: summary,
    detail: detail,
    act: act,
    history: history,
    settle: settle,
    appeal: appeal,
    proposeConfig: proposeConfig
  },

  on: {},
  onDecision: onDecision
}
