/**
 * 本地预览模式（没配云开发时走这里）
 *
 * 作用：让你在还没注册小程序、没开通云开发的时候，就能把界面点起来。
 * 数据存在 wx.storage，只在你这一台手机上，**不联网、不会和对象同步**。
 *
 * 真要用的时候把 utils/config.js 里的 envId 填上，就会自动切换到云开发。
 */
var rules = require('./rules.js')

var STORAGE_KEY = 'our-hearts-mock-v1'

function now() {
  return Date.now()
}

function seed() {
  return {
    profile: { nickname: '小可爱', avatarEmoji: '🐰' },
    partner: null,
    couple: { inviteCode: 'LOVE88', hearts: 0, createdAt: now() },
    checkins: {},
    logs: []
  }
}

function load() {
  var s = null
  try {
    s = wx.getStorageSync(STORAGE_KEY)
  } catch (e) {}
  if (!s || typeof s !== 'object' || !s.couple) {
    s = seed()
    save(s)
  }
  return s
}

function save(s) {
  try {
    wx.setStorageSync(STORAGE_KEY, s)
  } catch (e) {
    console.error('[本地存储失败]', e)
  }
}

function fullDayKeysOf(s) {
  var keys = []
  for (var k in s.checkins) {
    var r = s.checkins[k]
    if (r && r.sleep && r.wake) keys.push(k)
  }
  return keys
}

function buildHome(s) {
  var ms = now()
  var todayKey = rules.dateKey(ms)
  var records = s.checkins[todayKey] || {}
  var fullDayKeys = fullDayKeysOf(s)
  var recent = []
  for (var i = 6; i >= 0; i--) {
    var k = rules.shiftKey(todayKey, -i)
    var r = s.checkins[k] || {}
    recent.push({ date: k, fullDay: !!(r.sleep && r.wake) })
  }

  return {
    ok: true,
    mode: 'mock',
    serverNow: ms,
    me: {
      nickname: s.profile.nickname,
      avatarEmoji: s.profile.avatarEmoji
    },
    partner: s.partner,
    bound: !!s.partner,
    inviteCode: s.couple.inviteCode,
    daysTogether: Math.floor((ms - s.couple.createdAt) / 86400000) + 1,
    hearts: s.couple.hearts,
    streak: rules.calcStreak(fullDayKeys, todayKey),
    today: {
      date: todayKey,
      records: records,
      fullDay: !!(records.sleep && records.wake)
    },
    recent: recent,
    mockHint: '本地预览模式：数据只存在这台手机上'
  }
}

function doCheckin(s, type) {
  var ms = now()
  var w = rules.RULES.windows[type]
  if (!w) return { ok: false, code: 'BAD_TYPE', message: '没有这个打卡项' }

  var state = rules.windowState(type, ms)
  if (state === 'upcoming') {
    return { ok: false, code: 'NOT_YET', message: w.start + ' 才开始打卡哦' }
  }
  if (state === 'expired') {
    return { ok: false, code: 'CLOSED', message: '今天已经过了打卡时间' }
  }

  var todayKey = rules.dateKey(ms)
  if (!s.checkins[todayKey]) s.checkins[todayKey] = {}
  if (s.checkins[todayKey][type]) {
    return { ok: false, code: 'DUP', message: '今天已经打过卡啦' }
  }

  s.checkins[todayKey][type] = { at: ms }

  var records = s.checkins[todayKey]
  var isFullDay = !!(records.sleep && records.wake)
  var fullDayKeys = fullDayKeysOf(s)
  var streakAfter = rules.calcStreak(fullDayKeys, todayKey)

  var awards = rules.checkinAwards({
    type: type,
    isFullDay: isFullDay,
    partnerDone: false, // 本地模式没有对象，同步奖不生效
    streakAfter: streakAfter
  })

  var total = 0
  var reasons = []
  for (var i = 0; i < awards.length; i++) {
    total += awards[i].delta
    reasons.push(awards[i].reason + ' +' + awards[i].delta)
    s.logs.unshift({
      at: ms,
      date: todayKey,
      delta: awards[i].delta,
      reason: awards[i].reason
    })
  }
  s.logs = s.logs.slice(0, 100)
  s.couple.hearts += total
  save(s)

  return {
    ok: true,
    home: buildHome(s),
    reward: { delta: total, reasons: reasons }
  }
}

function buildHistory(s, month) {
  var keys = Object.keys(s.checkins)
  var days = {}
  var fullCount = 0
  var fullDayKeys = []

  for (var i = 0; i < keys.length; i++) {
    var k = keys[i]
    if (month && k.indexOf(month) !== 0) continue
    var r = s.checkins[k] || {}
    days[k] = { sleep: !!r.sleep, wake: !!r.wake }
    if (r.sleep && r.wake) {
      fullCount++
      fullDayKeys.push(k)
    }
  }

  var todayKey = rules.dateKey(now())
  var logs = s.logs
    .filter(function (l) {
      return !month || String(l.date).indexOf(month) === 0
    })
    .slice(0, 30)

  return {
    ok: true,
    mode: 'mock',
    month: month,
    days: days,
    stats: {
      fullCount: fullCount,
      bestStreak: bestStreakOf(fullDayKeys, todayKey)
    },
    logs: logs,
    hearts: s.couple.hearts
  }
}

function bestStreakOf(fullDayKeys, todayKey) {
  var sorted = fullDayKeys.slice().sort()
  var best = 0
  var run = 0
  var prev = ''
  for (var i = 0; i < sorted.length; i++) {
    var k = sorted[i]
    if (prev && rules.shiftKey(prev, 1) === k) run++
    else run = 1
    if (run > best) best = run
    prev = k
  }
  // 只为了算历史最长连续，"今天"参数暂时没用上，保留是为了和云端签名一致
  void todayKey
  return best
}

function call(action, data) {
  var s = load()

  switch (action) {
    case 'home':
      return Promise.resolve(buildHome(s))

    case 'checkin':
      return Promise.resolve(doCheckin(s, data.type))

    case 'history':
      return Promise.resolve(buildHistory(s, data.month || rules.monthKey(now())))

    case 'joinCouple':
      return Promise.resolve({
        ok: false,
        code: 'MOCK',
        message: '本地预览模式不能真的配对，先把云开发配上再用～'
      })

    case 'devReset':
      save(seed())
      return Promise.resolve({ ok: true, message: '本地数据已清空' })

    default:
      return Promise.resolve({ ok: false, code: 'UNKNOWN', message: '未知操作：' + action })
  }
}

module.exports = {
  call: call,
  // 方便在调试时手动改数据
  _load: load,
  _save: save
}
