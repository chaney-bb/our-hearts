/* ============================================================
 * 【自动生成，请勿手改】
 * 源文件：shared/checkin-rules.js
 * 同步命令：node scripts/sync-rules.mjs
 * ============================================================ */

/**
 * ============================================================
 *  模块 · 打卡（checkin）的规则与纯逻辑（唯一来源）
 * ============================================================
 *  ⚠️ 不要直接改 miniprogram/ 或 cloudfunctions/ 里的副本，
 *     它们由 `node scripts/sync-rules.mjs` 从这里生成：
 *       → miniprogram/utils/rules.js          （只用于显示：倒计时、按钮状态）
 *       → cloudfunctions/api/modules/checkin/rules.js（用于真正判定）
 *
 *  为什么判定必须在云函数里：手机时间可以手动改，服务器时间不行。
 *
 *  规则数值（几点算早睡、一次加几分）将来会挪到"设置页可配"，
 *  这里的 RULES 只作为兜底默认值。
 */

var clock = require("./clock.js")

var RULES = {
  // 打卡时间窗口（北京时间，24 小时制，start 必须小于 end）
  windows: {
    sleep: { start: '5:00', end: '23:59', label: '早睡', emoji: '🌙', tip: '放下手机，早点睡' },
    wake: { start: '05:30', end: '08:00', label: '早起', emoji: '☀️', tip: '新的一天开始啦' }
  },

  // 爱心数值
  hearts: {
    sleep: 1, // 早睡打卡
    wake: 1, // 早起打卡
    fullDay: 1, // 当天两项都完成（全勤奖）
    sync: 1, // 两人同一天完成同一项（同步奖）
    streak7: 10, // 连续 7 天全勤
    streak30: 50, // 连续 30 天全勤
    makeupCost: 10 // 补签卡价格（商城模块才用到）
  },

  // 顺序就是页面上的顺序
  types: ['sleep', 'wake']
}

/* ---------------------------------- 窗口状态 ---------------------------------- */

/**
 * 返回 'upcoming' | 'open' | 'expired'
 * upcoming = 还没开始；open = 可以打卡；expired = 已经过了
 */
function windowState(type, ms) {
  var w = RULES.windows[type]
  if (!w) return 'expired'
  var cur = clock.dayMinutes(ms)
  if (cur < clock.minutesOf(w.start)) return 'upcoming'
  if (cur > clock.minutesOf(w.end)) return 'expired'
  return 'open'
}

// 距离窗口关闭还有多久（毫秒，可能为负）
function msUntilWindowEnd(type, ms) {
  var w = RULES.windows[type]
  return clock.msUntilTime(w.end, ms)
}

// 距离窗口开放还有多久（毫秒）
function msUntilWindowStart(type, ms) {
  var w = RULES.windows[type]
  return clock.msUntilTime(w.start, ms)
}

/* ---------------------------------- 页面展示 ---------------------------------- */

/**
 * 描述一个打卡项（给页面用）
 * records: { sleep: { at: 时间戳 }, wake: {...} } 或 {}
 */
function describeItem(type, records, now) {
  var w = RULES.windows[type]
  var rec = records ? records[type] : null
  var state = rec ? 'done' : windowState(type, now)
  var hint = ''

  if (rec) {
    hint = clock.timeKey(rec.at) + ' 已完成'
  } else if (state === 'open') {
    hint = '还剩 ' + clock.humanize(msUntilWindowEnd(type, now))
  } else if (state === 'upcoming') {
    hint = w.start + ' 开始，还有 ' + clock.humanize(msUntilWindowStart(type, now))
  } else {
    hint = '今天错过了，明天再来'
  }

  return {
    key: type,
    label: w.label,
    emoji: w.emoji,
    tip: w.tip,
    window: w.start + ' – ' + w.end,
    state: state,
    done: !!rec,
    atText: rec ? clock.timeKey(rec.at) : '',
    hint: hint,
    canCheck: !rec && state === 'open'
  }
}

// 今日整体状态
function describeToday(records, now) {
  var items = RULES.types.map(function (t) {
    return describeItem(t, records, now)
  })
  return {
    date: clock.dateKey(now),
    items: items,
    fullDay: !!(records && records.sleep && records.wake)
  }
}

/* ---------------------------------- 奖励计算 ---------------------------------- */

/**
 * 一次打卡应该奖励什么，返回 [{ delta, reason }]
 * ctx: { type, isFullDay, partnerDone, streakAfter }
 */
function checkinAwards(ctx) {
  var h = RULES.hearts
  var out = []

  out.push({
    delta: h[ctx.type] || 1,
    reason: ctx.type === 'sleep' ? '早睡打卡' : '早起打卡'
  })

  if (ctx.isFullDay) out.push({ delta: h.fullDay, reason: '今日全勤' })
  if (ctx.partnerDone) out.push({ delta: h.sync, reason: '同步打卡' })

  if (ctx.streakAfter === 7) out.push({ delta: h.streak7, reason: '连续 7 天全勤' })
  if (ctx.streakAfter === 30) out.push({ delta: h.streak30, reason: '连续 30 天全勤' })

  return out
}

/**
 * 连续全勤天数
 * fullDayKeys: ['2026-10-24', '2026-10-25', ...] 只放"两项都完成"的日期
 * 规则：今天全勤就从今天往回数；今天还没全勤就从昨天往回数（不打断连续）
 */
function calcStreak(fullDayKeys, todayKeyValue) {
  var set = {}
  for (var i = 0; i < fullDayKeys.length; i++) set[fullDayKeys[i]] = true

  var cursor = set[todayKeyValue] ? todayKeyValue : clock.shiftKey(todayKeyValue, -1)
  var n = 0
  while (set[cursor]) {
    n++
    cursor = clock.shiftKey(cursor, -1)
  }
  return n
}

// 把时间工具一起导出，页面里只需要 require 这一个文件
module.exports = Object.assign({}, clock, {
  RULES: RULES,
  windowState: windowState,
  msUntilWindowEnd: msUntilWindowEnd,
  msUntilWindowStart: msUntilWindowStart,
  describeItem: describeItem,
  describeToday: describeToday,
  checkinAwards: checkinAwards,
  calcStreak: calcStreak
})
