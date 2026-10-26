/* ============================================================
 * 【自动生成，请勿手改】
 * 源文件：miniprogram/utils/rules.js
 * 同步命令：node scripts/sync-rules.mjs
 * ============================================================ */

/**
 * ============================================================
 *  打卡规则：全局唯一事实来源（改规则只改这个文件）
 * ============================================================
 *  ⚠️ 这个文件有两份：小程序端和云函数端各一份，
 *     改完这里之后必须运行：  node scripts/sync-rules.mjs
 *     它会把本文件复制到 cloudfunctions/api/rules.js
 *
 *  为什么两边都要一份？
 *     因为客户端算的时间不可信（把手机时间调一下就能骗爱心），
 *     真正的判定必须在云函数里做，所以规则要能被云函数 require 到。
 *     小程序端那一份只用来"显示"（倒计时、按钮状态）。
 */

// 北京时间相对 UTC 的偏移（云函数环境是 UTC，必须手动转）
var TZ_OFFSET = 8 * 60 * 60 * 1000

var RULES = {
  // 打卡时间窗口（北京时间，24 小时制，start 必须小于 end）
  windows: {
    sleep: { start: '5:00', end: '23:59', label: '早睡', emoji: '🌙', tip: '放下手机，早点睡' },
    wake: { start: '05:30', end: '08:00', label: '早起', emoji: '☀️', tip: '新的一天开始啦' }
  },

  // 爱心数值
  hearts: {
    sleep: 1,        // 早睡打卡
    wake: 1,         // 早起打卡
    fullDay: 1,      // 当天两项都完成（全勤奖）
    sync: 1,         // 两人同一天完成同一项（同步奖）
    streak7: 10,     // 连续 7 天全勤
    streak30: 50,    // 连续 30 天全勤
    makeupCost: 10   // 补签卡价格（M3 商城才用到）
  },

  // 顺序就是页面上的顺序
  types: ['sleep', 'wake']
}

/* ---------------------------------- 时间工具 ---------------------------------- */

function pad2(n) {
  return n < 10 ? '0' + n : '' + n
}

// 把时间戳换算成"北京时间的年月日时分"
function parts(ms) {
  var d = new Date(ms + TZ_OFFSET)
  return {
    y: d.getUTCFullYear(),
    m: d.getUTCMonth() + 1,
    d: d.getUTCDate(),
    h: d.getUTCHours(),
    mi: d.getUTCMinutes(),
    dow: d.getUTCDay()
  }
}

// 'YYYY-MM-DD'
function dateKey(ms) {
  var p = parts(ms)
  return p.y + '-' + pad2(p.m) + '-' + pad2(p.d)
}

// 'HH:mm'
function timeKey(ms) {
  var p = parts(ms)
  return pad2(p.h) + ':' + pad2(p.mi)
}

// 'NNNN-MM'（月份 key）
function monthKey(ms) {
  var p = parts(ms)
  return p.y + '-' + pad2(p.m)
}

function minutesOf(hhmm) {
  var arr = String(hhmm).split(':')
  return Number(arr[0]) * 60 + Number(arr[1])
}

// 北京时间某天某时 -> 真实时间戳
function wallToEpoch(y, m, d, h, mi) {
  return Date.UTC(y, m - 1, d, h, mi, 0, 0) - TZ_OFFSET
}

function dayMinutes(ms) {
  var p = parts(ms)
  return p.h * 60 + p.mi
}

// 日期 key 加减天数
function shiftKey(key, deltaDays) {
  var arr = key.split('-')
  var t = Date.UTC(Number(arr[0]), Number(arr[1]) - 1, Number(arr[2])) + deltaDays * 86400000
  var d = new Date(t)
  return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate())
}

/* ---------------------------------- 窗口状态 ---------------------------------- */

/**
 * 返回 'upcoming' | 'open' | 'expired'
 * upcoming = 还没开始；open = 可以打卡；expired = 已经过了
 */
function windowState(type, ms) {
  var w = RULES.windows[type]
  if (!w) return 'expired'
  var cur = dayMinutes(ms)
  if (cur < minutesOf(w.start)) return 'upcoming'
  if (cur > minutesOf(w.end)) return 'expired'
  return 'open'
}

// 距离窗口关闭还有多久（毫秒，可能为负）
function msUntilWindowEnd(type, ms) {
  var w = RULES.windows[type]
  var p = parts(ms)
  return wallToEpoch(p.y, p.m, p.d, Math.floor(minutesOf(w.end) / 60), minutesOf(w.end) % 60) - ms
}

// 距离窗口开放还有多久（毫秒）
function msUntilWindowStart(type, ms) {
  var w = RULES.windows[type]
  var p = parts(ms)
  return wallToEpoch(p.y, p.m, p.d, Math.floor(minutesOf(w.start) / 60), minutesOf(w.start) % 60) - ms
}

// 把毫秒说人话
function humanize(ms) {
  var m = Math.max(0, Math.floor(ms / 60000))
  if (m < 1) return '1 分钟内'
  if (m < 60) return m + ' 分钟'
  var h = Math.floor(m / 60)
  var r = m % 60
  return h + ' 小时' + (r ? ' ' + r + ' 分' : '')
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
    hint = timeKey(rec.at) + ' 已完成'
  } else if (state === 'open') {
    hint = '还剩 ' + humanize(msUntilWindowEnd(type, now))
  } else if (state === 'upcoming') {
    hint = w.start + ' 开始，还有 ' + humanize(msUntilWindowStart(type, now))
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
    atText: rec ? timeKey(rec.at) : '',
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
    date: dateKey(now),
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

  var cursor = set[todayKeyValue] ? todayKeyValue : shiftKey(todayKeyValue, -1)
  var n = 0
  while (set[cursor]) {
    n++
    cursor = shiftKey(cursor, -1)
  }
  return n
}

module.exports = {
  TZ_OFFSET: TZ_OFFSET,
  RULES: RULES,
  pad2: pad2,
  parts: parts,
  dateKey: dateKey,
  timeKey: timeKey,
  monthKey: monthKey,
  shiftKey: shiftKey,
  minutesOf: minutesOf,
  windowState: windowState,
  msUntilWindowEnd: msUntilWindowEnd,
  msUntilWindowStart: msUntilWindowStart,
  humanize: humanize,
  describeItem: describeItem,
  describeToday: describeToday,
  checkinAwards: checkinAwards,
  calcStreak: calcStreak
}
