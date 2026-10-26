/**
 * ============================================================
 *  内核 · 时间服务（唯一来源）
 * ============================================================
 *  ⚠️ 不要直接改 miniprogram/ 或 cloudfunctions/ 里的副本，
 *     它们由 `node scripts/sync-rules.mjs` 从这里生成。
 *
 *  为什么要单独一个时间文件：
 *     打卡要"今天"、学习计划要"本周"、攒钱要"这个月"，
 *     如果每个模块自己算，跨零点、跨月一定各有各的 bug。
 *     时间只允许有一套实现。
 */

// 北京时间相对 UTC 的偏移（云函数环境是 UTC，必须手动转）
var TZ_OFFSET = 8 * 60 * 60 * 1000

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

// 'YYYY-MM'
function monthKey(ms) {
  var p = parts(ms)
  return p.y + '-' + pad2(p.m)
}

function minutesOf(hhmm) {
  var arr = String(hhmm).split(':')
  return Number(arr[0]) * 60 + Number(arr[1])
}

function dayMinutes(ms) {
  var p = parts(ms)
  return p.h * 60 + p.mi
}

// 北京时间某天某时 -> 真实时间戳
function wallToEpoch(y, m, d, h, mi) {
  return Date.UTC(y, m - 1, d, h, mi, 0, 0) - TZ_OFFSET
}

// 日期 key 加减天数
function shiftKey(key, deltaDays) {
  var arr = String(key).split('-')
  var t = Date.UTC(Number(arr[0]), Number(arr[1]) - 1, Number(arr[2])) + deltaDays * 86400000
  var d = new Date(t)
  return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate())
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

// 距离"今天的某个钟点"还有多久（毫秒，已过去则为负）
function msUntilTime(hhmm, ms) {
  var p = parts(ms)
  var t = minutesOf(hhmm)
  return wallToEpoch(p.y, p.m, p.d, Math.floor(t / 60), t % 60) - ms
}

module.exports = {
  TZ_OFFSET: TZ_OFFSET,
  pad2: pad2,
  parts: parts,
  dateKey: dateKey,
  timeKey: timeKey,
  monthKey: monthKey,
  minutesOf: minutesOf,
  dayMinutes: dayMinutes,
  wallToEpoch: wallToEpoch,
  shiftKey: shiftKey,
  humanize: humanize,
  msUntilTime: msUntilTime
}
