/**
 * 本地预览模式（没配云开发时走这里）
 *
 * 作用：还没注册小程序、没开通云开发时，就能把界面点起来。
 * 数据存在 wx.storage，只在这台手机上，**不联网、不和对象同步**。
 *
 * 它模拟的是云函数的返回格式，所以接口名和云端一致：
 *   session.get / session.register / session.updateProfile / session.bind / session.unbind
 *   checkin.summary / checkin.detail / checkin.act / checkin.history
 *
 * 为了让你在本地也能点完整流程，这里默认"已经登记 + 已经配对"，
 * 对象是一个假的「亲爱的」。解绑后可以用任意 6 位邀请码再假装配对。
 */
var rules = require('../utils/rules.js')

var STORAGE_KEY = 'our-hearts-mock-v3'

function now() {
  return Date.now()
}

function seed() {
  return {
    profile: {
      userId: '小可爱',
      realName: '',
      phone: '',
      birthday: '',
      gender: '',
      bio: '',
      avatarEmoji: '🐰'
    },
    partner: { userId: '亲爱的', avatarEmoji: '🐻' },
    couple: { inviteCode: 'LOVE88', createdAt: now(), status: 'active', pairedAt: now() },
    wallet: { mine: 0, partner: 86 },
    checkins: {},
    logs: []
  }
}

function load() {
  var s = null
  try {
    s = wx.getStorageSync(STORAGE_KEY)
  } catch (e) {}
  if (!s || typeof s !== 'object' || !s.couple || !s.wallet) {
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

function publicProfile(p) {
  if (!p) return null
  return {
    userId: p.userId || '',
    displayName: p.userId || '未命名',
    realName: p.realName || '',
    phone: p.phone || '',
    birthday: p.birthday || '',
    gender: p.gender || '',
    bio: p.bio || '',
    avatarEmoji: p.avatarEmoji || '🙂'
  }
}

/* ------------------------------ 会话 ------------------------------ */

function sessionGet(s) {
  var bound = !!s.partner && s.couple.status === 'active'
  return ok({
    needRegister: false,
    needPair: !bound,
    bound: bound,
    coupleStatus: s.couple.status,
    me: publicProfile(s.profile),
    partner: bound ? publicProfile(s.partner) : null,
    inviteCode: s.couple.inviteCode,
    daysTogether: Math.floor((now() - (s.couple.pairedAt || s.couple.createdAt)) / 86400000) + 1,
    wallet: { balance: s.wallet.mine },
    partnerWallet: { balance: bound ? s.wallet.partner : 0 }
  })
}

function sessionRegister(s, data) {
  var d = data || {}
  var keys = ['userId', 'realName', 'phone', 'birthday', 'gender', 'bio', 'avatarEmoji']
  keys.forEach(function (k) {
    if (d[k] !== undefined) s.profile[k] = d[k]
  })
  save(s)
  return sessionGet(s)
}

function sessionBind(s, inviteCode) {
  if (!inviteCode || String(inviteCode).length !== 6) return biz('NOT_FOUND', '邀请码是 6 位哦')
  if (s.partner && s.couple.status === 'active') return biz('FULL', '已经配对过了')
  s.partner = { userId: '亲爱的', avatarEmoji: '🐻' }
  s.couple.status = 'active'
  s.couple.pairedAt = now()
  save(s)
  return sessionGet(s)
}

function sessionUnbind(s, confirm) {
  if (confirm !== true) return biz('NO_CONFIRM', '解绑需要二次确认')
  if (!s.partner) return biz('NOT_PAIRED', '当前没有可以解绑的关系')

  s.wallet.mine = 0
  s.partner = null
  s.couple.status = 'pending'
  s.couple.inviteCode = 'LOVE' + String(Math.floor(Math.random() * 90) + 10)
  s.couple.pairedAt = null
  save(s)
  return sessionGet(s)
}

/* ------------------------------ 打卡 ------------------------------ */

function checkinDetail(s) {
  var ms = now()
  var todayKey = rules.sleepDayKey(ms)
  var records = s.checkins[todayKey] || {}
  var fullDayKeys = fullDayKeysOf(s)
  var recent = []

  for (var i = 6; i >= 0; i--) {
    var k = rules.shiftKey(todayKey, -i)
    var r = s.checkins[k] || {}
    recent.push({ date: k, fullDay: !!(r.sleep && r.wake) })
  }

  return ok({
    streak: rules.calcStreak(fullDayKeys, todayKey),
    today: { date: todayKey, records: records, fullDay: !!(records.sleep && records.wake) },
    recent: recent,
    rules: { windows: rules.RULES.windows, hearts: rules.RULES.hearts }
  })
}

function checkinAct(s, type) {
  if (!s.partner) return biz('NOT_PAIRED', '先和 TA 配对才能打卡')

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

  var todayKey = rules.sleepDayKey(ms)
  if (!s.checkins[todayKey]) s.checkins[todayKey] = {}
  if (s.checkins[todayKey][type]) return biz('DUP', '今天已经打过卡啦')

  s.checkins[todayKey][type] = { at: ms }

  var records = s.checkins[todayKey]
  var isFullDay = !!(records.sleep && records.wake)
  var streakAfter = rules.calcStreak(fullDayKeysOf(s), todayKey)

  var awards = rules.checkinAwards({
    type: type,
    isFullDay: isFullDay,
    partnerDone: false, // 本地模式没有真的对象，同步奖不生效
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
  s.wallet.mine += total
  save(s)

  var d = checkinDetail(s)
  return ok({ reward: { delta: total, reasons: reasons }, detail: { streak: d.streak, today: d.today, recent: d.recent, rules: d.rules } })
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
  month = month || rules.sleepDayKey(now()).slice(0, 7)
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

  var logs = s.logs
    .filter(function (l) {
      return String(l.date).indexOf(month) === 0
    })
    .slice(0, 30)

  return ok({
    month: month,
    days: days,
    stats: { fullCount: fullKeys.length, bestStreak: bestStreakOf(fullKeys) },
    logs: logs,
    warn: '',
    hearts: s.wallet.mine
  })
}

function checkinSummary(s) {
  var ms = now()
  var todayKey = rules.sleepDayKey(ms)
  var records = s.checkins[todayKey] || {}
  return ok({
    todayDone: (records.sleep ? 1 : 0) + (records.wake ? 1 : 0),
    todayTotal: rules.RULES.types.length,
    streak: rules.calcStreak(fullDayKeysOf(s), todayKey)
  })
}

/* ------------------------------ 入口 ------------------------------ */

function call(action, data) {
  var s = load()
  data = data || {}

  switch (action) {
    case 'session.get':
      return Promise.resolve(sessionGet(s))

    case 'session.register':
      return Promise.resolve(sessionRegister(s, data.data || data))

    case 'session.updateProfile':
      return Promise.resolve(sessionRegister(s, data.data || data))

    case 'session.bind':
      return Promise.resolve(sessionBind(s, data.inviteCode))

    case 'session.unbind':
      return Promise.resolve(sessionUnbind(s, data.confirm))

    case 'session.verify':
      return Promise.resolve(ok({ wallet: s.wallet.mine, ledger: s.wallet.mine, ok: true }))

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
