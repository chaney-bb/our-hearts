/**
 * 本地预览模式（没配云开发时走这里）
 *
 * 作用：还没注册小程序、没开通云开发时，就能把界面点起来。
 * 数据存在 wx.storage，只在这台手机上，**不联网、不和对象同步**。
 *
 * 它模拟的是云函数的返回格式，所以接口名和云端一致：
 *   session.get / session.bind / checkin.summary / checkin.detail / checkin.act / checkin.history
 * 真要用的时候把 utils/config.js 里的 envId 填上，就自动切到云开发。
 *
 * ⚠️ 爱心目前是"情侣共享一个池子"，和云端 P1a 阶段保持一致；
 *    P1b 改成个人钱包时，两处一起改（这也是为什么只有一处写余额）。
 */
var rules = require('../utils/rules.js')

var STORAGE_KEY = 'our-hearts-mock-v2'

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

function ok(data) {
  return Object.assign({ ok: true, serverNow: now(), mode: 'mock' }, data)
}

function biz(code, message) {
  return { ok: false, code: code, message: message, mode: 'mock' }
}

function fullDayKeysOf(s) {
  var keys = []
  for (var k in s.checkins) {
    var r = s.checkins[k]
    if (r && r.sleep && r.wake) keys.push(k)
  }
  return keys
}

/* ------------------------------ 各接口 ------------------------------ */

function sessionGet(s) {
  return ok({
    me: { nickname: s.profile.nickname, avatarEmoji: s.profile.avatarEmoji },
    partner: s.partner,
    bound: !!s.partner,
    inviteCode: s.couple.inviteCode,
    daysTogether: Math.floor((now() - s.couple.createdAt) / 86400000) + 1
  })
}

function checkinDetail(s) {
  var ms = now()
  var todayKey = rules.dateKey(ms)
  var records = s.checkins[todayKey] || {}
  var fullDayKeys = fullDayKeysOf(s)
  var keys = []
  var recent = []

  for (var i = 6; i >= 0; i--) {
    var k = rules.shiftKey(todayKey, -i)
    var r = s.checkins[k] || {}
    recent.push({ date: k, fullDay: !!(r.sleep && r.wake) })
  }

  return ok({
    hearts: s.couple.hearts,
    streak: rules.calcStreak(fullDayKeys, todayKey),
    today: { date: todayKey, records: records, fullDay: !!(records.sleep && records.wake) },
    recent: recent,
    rules: { windows: rules.RULES.windows, hearts: rules.RULES.hearts }
  })
}

function checkinAct(s, type) {
  var ms = now()
  var w = rules.RULES.windows[type]
  if (!w) return biz('BAD_TYPE', '没有这个打卡项')

  var state = rules.windowState(type, ms)
  if (state === 'upcoming') {
    return biz('NOT_YET', w.label + '打卡 ' + w.start + ' 才开始（现在 ' + rules.timeKey(ms) + '）')
  }
  if (state === 'expired') {
    return biz('CLOSED', '今天已经过了' + w.label + '打卡时间（窗口 ' + w.start + '–' + w.end + '）')
  }

  var todayKey = rules.dateKey(ms)
  if (!s.checkins[todayKey]) s.checkins[todayKey] = {}
  if (s.checkins[todayKey][type]) return biz('DUP', '今天已经打过卡啦')

  s.checkins[todayKey][type] = { at: ms }

  var records = s.checkins[todayKey]
  var isFullDay = !!(records.sleep && records.wake)
  var streakAfter = rules.calcStreak(fullDayKeysOf(s), todayKey)

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
    s.logs.unshift({ at: ms, date: todayKey, delta: awards[i].delta, reason: awards[i].reason })
  }
  s.logs = s.logs.slice(0, 100)
  s.couple.hearts += total
  save(s)

  var d = checkinDetail(s)
  delete d.ok
  delete d.mode
  delete d.serverNow
  return ok({ reward: { delta: total, reasons: reasons }, detail: d })
}

function bestStreakOf(keys) {
  var sorted = keys.slice().sort()
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
  return best
}

function checkinHistory(s, month) {
  month = month || rules.monthKey(now())
  var keys = Object.keys(s.checkins)
  var days = {}
  var fullKeys = []
  var i, k, r

  for (i = 0; i < keys.length; i++) {
    k = keys[i]
    if (k.indexOf(month) !== 0) continue
    r = s.checkins[k] || {}
    days[k] = { sleep: !!r.sleep, wake: !!r.wake }
    if (r.sleep && r.wake) fullKeys.push(k)
  }

  var logs = s.logs.filter(function (l) {
    return String(l.date).indexOf(month) === 0
  }).slice(0, 30)

  return ok({
    month: month,
    days: days,
    stats: { fullCount: fullKeys.length, bestStreak: bestStreakOf(fullKeys) },
    logs: logs,
    warn: '',
    hearts: s.couple.hearts
  })
}

function checkinSummary(s) {
  var ms = now()
  var todayKey = rules.dateKey(ms)
  var records = s.checkins[todayKey] || {}
  return ok({
    todayDone: (records.sleep ? 1 : 0) + (records.wake ? 1 : 0),
    todayTotal: rules.RULES.types.length,
    streak: rules.calcStreak(fullDayKeysOf(s), todayKey),
    hearts: s.couple.hearts
  })
}

/* ------------------------------ 入口 ------------------------------ */

function call(action, data) {
  var s = load()
  data = data || {}

  switch (action) {
    case 'session.get':
      return Promise.resolve(sessionGet(s))

    case 'session.bind':
      return Promise.resolve(
        biz('MOCK', '本地预览模式不能真的配对，先把云开发配上再用～')
      )

    case 'checkin.summary':
      return Promise.resolve(checkinSummary(s))

    case 'checkin.detail':
      return Promise.resolve(checkinDetail(s))

    case 'checkin.act':
      return Promise.resolve(checkinAct(s, data.type))

    case 'checkin.history':
      return Promise.resolve(checkinHistory(s, data.month))

    case 'devReset':
      save(seed())
      return Promise.resolve({ ok: true, message: '本地数据已清空' })

    default:
      return Promise.resolve(biz('UNKNOWN', '未知操作：' + action))
  }
}

module.exports = {
  call: call,
  _load: load,
  _save: save
}
