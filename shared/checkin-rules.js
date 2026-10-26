/**
 * ============================================================
 *  模块 · 打卡（checkin）的规则与纯逻辑（唯一来源）
 * ============================================================
 *  ⚠️ 不要直接改 miniprogram/ 或 cloudfunctions/ 里的副本，
 *     它们由 `node scripts/sync-rules.mjs` 从这里生成。
 *
 *  这个文件是"参数化的规则引擎"：
 *     DEFAULTS  = 出厂默认值（也是允许配置的白名单）
 *     normalizeConfig(patch) = 默认值 + 用户覆盖 → 唯一生效版本
 *     所有判定函数都接受 cfg 参数，客户端用服务端下发的 cfg 渲染，
 *     所以前后端永远不会因为"规则不一致"而打架。
 *
 *  时间一律是"北京时间"，日期一律是"打卡日"（中午 12 点前算前一天）。
 */

var clock = require('@@CLOCK@@')

/* ---------------------------------- 展示文案 ---------------------------------- */

var LABELS = {
  sleep: { label: '早睡', emoji: '🌙' },
  wake: { label: '早起', emoji: '☀️' }
}

var TYPE_ORDER = ['sleep', 'wake']

/* ---------------------------------- 默认规则 ---------------------------------- */

var DEFAULTS = {
  // 打卡日从几点切分（12 点前的打卡算前一天，因为"昨晚睡 + 今早起"是同一晚）
  cutoverHour: 12,

  sleep: {
    window: { start: '21:30', end: '24:00' }, // end 是闭区间外，24:00 表示到当天结束
    tiers: [
      { from: '21:30', to: '22:15', hearts: 2 },
      { from: '22:15', to: '23:15', hearts: 1 },
      { from: '23:15', to: '24:00', hearts: 0 }
    ],
    missPenalty: 1,
    allowAppeal: true,
    appealDeadline: '12:00'
  },

  wake: {
    window: { start: '06:00', end: '12:00' },
    tiers: [
      { from: '06:00', to: '09:00', hearts: 1 },
      { from: '09:00', to: '12:00', hearts: 0 }
    ],
    missPenalty: 1,
    allowAppeal: true,
    appealDeadline: '24:00'
  },

  // 月度全勤：一个月里"两项都打卡"的天数 ≥ requiredDays → 奖励 bonus
  monthly: { requiredDays: 22, bonus: 10, scope: 'perUser' },

  // 两人同一晚完成同一项，额外给多少（0 = 关闭）
  syncBonus: 0
}

/* ---------------------------------- 配置合并 ---------------------------------- */

function clone(obj) {
  return JSON.parse(JSON.stringify(obj))
}

/**
 * 深合并：只接受 base 里出现过的键（防止写进垃圾字段）
 * 数组整体替换（比如 tiers 换一整套，不做逐项合并）
 */
function merge(base, patch) {
  if (Array.isArray(patch)) return clone(patch)
  if (patch === undefined || patch === null) return base
  if (typeof patch !== 'object') return patch
  if (!base || typeof base !== 'object' || Array.isArray(base)) return base

  var out = Object.assign({}, base)

  Object.keys(patch).forEach(function (k) {
    if (!Object.prototype.hasOwnProperty.call(base, k)) return // 未知键忽略
    out[k] = merge(base[k], patch[k])
  })

  return out
}

/** 默认值 + 用户覆盖 = 唯一生效版本 */
function normalizeConfig(patch) {
  return merge(clone(DEFAULTS), patch || {})
}

/* ---------------------------------- 打卡日 ---------------------------------- */

/**
 * 把真实时间换算成"打卡日"（YYYY-MM-DD）
 *
 *   cutoverHour = 12 时：
 *     10-26 22:30 早睡  -> 打卡日 10-26
 *     10-27 06:40 早起  -> 打卡日 10-26   ← 同一晚
 *     11-01 06:00 早起  -> 打卡日 10-31   ← 算进 10 月
 */
function sleepDayKey(ms, cfg) {
  var c = cfg || DEFAULTS
  var p = clock.parts(ms)
  var key = clock.dateKey(ms)
  var cut = c.cutoverHour
  if (typeof cut === 'number' && p.h < cut) return clock.shiftKey(key, -1)
  return key
}

/* ---------------------------------- 窗口与档位 ---------------------------------- */

function typeConfig(type, cfg) {
  return (cfg || DEFAULTS)[type]
}

/** 'upcoming' | 'open' | 'expired'（窗口是 [start, end)） */
function windowState(type, ms, cfg) {
  var t = typeConfig(type, cfg)
  if (!t || !t.window) return 'expired'
  var cur = clock.dayMinutes(ms)
  if (cur < clock.minutesOf(t.window.start)) return 'upcoming'
  if (cur >= clock.minutesOf(t.window.end)) return 'expired'
  return 'open'
}

/** 当前时刻落在哪个奖励档位，返回 { from, to, hearts } 或 null */
function tierAt(type, ms, cfg) {
  var t = typeConfig(type, cfg)
  if (!t || !t.tiers) return null
  var cur = clock.dayMinutes(ms)
  for (var i = 0; i < t.tiers.length; i++) {
    var tier = t.tiers[i]
    if (cur >= clock.minutesOf(tier.from) && cur < clock.minutesOf(tier.to)) {
      return tier
    }
  }
  return null
}

/** 现在打卡能拿几个爱心（不在窗口内返回 null） */
function heartsAt(type, ms, cfg) {
  if (windowState(type, ms, cfg) !== 'open') return null
  var tier = tierAt(type, ms, cfg)
  return tier ? tier.hearts : 0
}

function msUntilWindowEnd(type, ms, cfg) {
  return clock.msUntilTime(typeConfig(type, cfg).window.end, ms)
}

function msUntilWindowStart(type, ms, cfg) {
  return clock.msUntilTime(typeConfig(type, cfg).window.start, ms)
}

/* ---------------------------------- 页面展示 ---------------------------------- */

/**
 * 描述一个打卡项（给页面用）
 * records: { sleep: { at, hearts }, wake: {...} } 或 {}
 */
function describeItem(type, records, now, cfg) {
  var t = typeConfig(type, cfg)
  var meta = LABELS[type]
  var rec = records ? records[type] : null
  var state = rec ? 'done' : windowState(type, now, cfg)
  var hearts = state === 'done' ? null : heartsAt(type, now, cfg)
  var hint = ''

  if (rec) {
    var got = typeof rec.hearts === 'number' ? rec.hearts : null
    hint = clock.timeKey(rec.at) + ' 打卡' + (got === null ? '' : got > 0 ? ' +' + got : '（0 爱心）')
  } else if (state === 'open') {
    hint = hearts > 0 ? '现在打卡 +' + hearts : '现在打卡不加爱心'
  } else if (state === 'upcoming') {
    hint = t.window.start + ' 开放，还有 ' + clock.humanize(msUntilWindowStart(type, now, cfg))
  } else {
    hint = '这一晚错过了'
  }

  return {
    key: type,
    label: meta.label,
    emoji: meta.emoji,
    window: t.window.start + ' – ' + t.window.end,
    state: state,
    done: !!rec,
    atText: rec ? clock.timeKey(rec.at) : '',
    hint: hint,
    hearts: typeof rec !== 'undefined' && rec && typeof rec.hearts === 'number' ? rec.hearts : hearts,
    canCheck: !rec && state === 'open'
  }
}

function describeToday(records, now, cfg) {
  var items = TYPE_ORDER.map(function (type) {
    return describeItem(type, records, now, cfg)
  })
  return {
    date: sleepDayKey(now, cfg),
    items: items,
    fullDay: !!(records && records.sleep && records.wake)
  }
}

/* ---------------------------------- 统计 ---------------------------------- */

/**
 * 连续全勤天数
 * fullDayKeys: ['2026-10-24', ...] 只放"两项都完成"的打卡日
 * 今天全勤就从今天往回数；今天还没全勤就从昨天往回数（不打断连续）
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

/** 一个月的全勤天数：days = { '2026-10-26': { sleep:true, wake:true } } */
function countFullDays(days) {
  var n = 0
  var keys = Object.keys(days || {})
  for (var i = 0; i < keys.length; i++) {
    var d = days[keys[i]]
    if (d && d.sleep && d.wake) n++
  }
  return n
}

/** 月度全勤是否达标 */
function monthlyReached(fullCount, cfg) {
  var m = (cfg || DEFAULTS).monthly
  if (!m || !m.bonus) return false
  return fullCount >= m.requiredDays
}

/** 最长的连续全勤（记录页统计用） */
function bestStreak(keys) {
  var sorted = (keys || []).slice().sort()
  var best = 0
  var run = 0
  var prev = ''
  for (var i = 0; i < sorted.length; i++) {
    var k = sorted[i]
    if (prev && clock.shiftKey(prev, 1) === k) run++
    else run = 1
    if (run > best) best = run
    prev = k
  }
  return best
}

module.exports = Object.assign({}, clock, {
  LABELS: LABELS,
  TYPES: TYPE_ORDER,
  DEFAULTS: DEFAULTS,
  normalizeConfig: normalizeConfig,
  sleepDayKey: sleepDayKey,
  windowState: windowState,
  tierAt: tierAt,
  heartsAt: heartsAt,
  msUntilWindowEnd: msUntilWindowEnd,
  msUntilWindowStart: msUntilWindowStart,
  describeItem: describeItem,
  describeToday: describeToday,
  calcStreak: calcStreak,
  countFullDays: countFullDays,
  monthlyReached: monthlyReached,
  bestStreak: bestStreak
})
