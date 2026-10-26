/**
 * 本地预览模式（没配云开发时走这里）
 *
 * 数据存在 wx.storage，只在这台手机上，**不联网、不和对象同步**。
 * 接口名和云端完全一致；规则同样来自"默认值 + 覆盖"，所以以后设置页在本地也能用。
 */
var rules = require('../utils/rules.js')

var STORAGE_KEY = 'our-hearts-mock-v4'

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
    settings: {}, // 规则覆盖（P4 设置页会写这里）
    monthlyAwarded: {}, // 已经发过全勤奖的月份
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
  if (!s.settings) s.settings = {}
  if (!s.monthlyAwarded) s.monthlyAwarded = {}
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

function cfgOf(s) {
  return rules.normalizeConfig(s.settings)
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

function monthDays(s, month) {
  var days = {}
  for (var k in s.checkins) {
    if (k.indexOf(month) !== 0) continue
    var r = s.checkins[k] || {}
    days[k] = { sleep: !!r.sleep, wake: !!r.wake }
  }
  return days
}

function checkinDetail(s) {
  var cfg = cfgOf(s)
  var ms = now()
  var dayKey = rules.sleepDayKey(ms, cfg)
  var records = s.checkins[dayKey] || {}
  var recent = []

  for (var i = 6; i >= 0; i--) {
    var k = rules.shiftKey(dayKey, -i)
    var r = s.checkins[k] || {}
    recent.push({ date: k, fullDay: !!(r.sleep && r.wake) })
  }

  var month = dayKey.slice(0, 7)
  var fullCount = rules.countFullDays(monthDays(s, month))

  return ok({
    streak: rules.calcStreak(fullDayKeysOf(s), dayKey),
    today: { date: dayKey, records: records, fullDay: !!(records.sleep && records.wake) },
    recent: recent,
    month: {
      month: month,
      fullCount: fullCount,
      requiredDays: cfg.monthly.requiredDays,
      reached: rules.monthlyReached(fullCount, cfg)
    },
    config: cfg
  })
}

function checkinAct(s, type) {
  if (!s.partner) return biz('NOT_PAIRED', '先和 TA 配对才能打卡')

  var cfg = cfgOf(s)
  var meta = rules.LABELS[type]
  if (!meta) return biz('BAD_TYPE', '没有这个打卡项')

  var ms = now()
  var t = cfg[type]
  var state = rules.windowState(type, ms, cfg)

  if (state === 'upcoming') {
    return biz('NOT_YET', meta.label + '打卡 ' + t.window.start + ' 开放（现在 ' + rules.timeKey(ms) + '）')
  }
  if (state === 'expired') {
    return biz('CLOSED', '这一晚的' + meta.label + '打卡已经结束（窗口 ' + t.window.start + '–' + t.window.end + '）')
  }

  var dayKey = rules.sleepDayKey(ms, cfg)
  if (!s.checkins[dayKey]) s.checkins[dayKey] = {}
  if (s.checkins[dayKey][type]) return biz('DUP', '这一晚已经打过' + meta.label + '卡啦')

  var got = rules.heartsAt(type, ms, cfg)
  var base = typeof got === 'number' ? got : 0
  s.checkins[dayKey][type] = { at: ms, hearts: base }

  var total = 0
  var reasons = []

  if (base > 0) {
    total += base
    reasons.push(meta.label + '打卡 +' + base)
    s.logs.unshift({ at: ms, date: dayKey, delta: base, reason: meta.label + '打卡' })
  } else {
    reasons.push(meta.label + '打卡（这一档没有爱心）')
  }

  // 月度全勤
  var month = dayKey.slice(0, 7)
  var days = monthDays(s, month)
  var fullCount = rules.countFullDays(days)
  if (rules.monthlyReached(fullCount, cfg) && !s.monthlyAwarded[month]) {
    s.monthlyAwarded[month] = true
    total += cfg.monthly.bonus
    reasons.push('月度全勤（' + fullCount + ' 天） +' + cfg.monthly.bonus)
    s.logs.unshift({ at: ms, date: dayKey, delta: cfg.monthly.bonus, reason: '月度全勤 ' + month })
  }

  s.logs = s.logs.slice(0, 100)
  if (total) s.wallet.mine += total
  save(s)

  var d = checkinDetail(s)
  return ok({
    reward: { delta: total, reasons: reasons },
    detail: { streak: d.streak, today: d.today, recent: d.recent, month: d.month, config: d.config },
    streak: d.streak
  })
}

function checkinHistory(s, month) {
  var cfg = cfgOf(s)
  month = month || rules.sleepDayKey(now(), cfg).slice(0, 7)

  var days = monthDays(s, month)
  var fullKeys = Object.keys(days).filter(function (k) {
    return days[k].sleep && days[k].wake
  })

  var logs = s.logs
    .filter(function (l) {
      return String(l.date).indexOf(month) === 0
    })
    .slice(0, 30)

  return ok({
    month: month,
    days: days,
    stats: {
      fullCount: fullKeys.length,
      bestStreak: rules.bestStreak(fullKeys),
      requiredDays: cfg.monthly.requiredDays,
      reached: rules.monthlyReached(fullKeys.length, cfg),
      bonus: cfg.monthly.bonus
    },
    logs: logs,
    warn: '',
    hearts: s.wallet.mine
  })
}

function checkinSummary(s) {
  var cfg = cfgOf(s)
  var dayKey = rules.sleepDayKey(now(), cfg)
  var records = s.checkins[dayKey] || {}
  var done = (records.sleep ? 1 : 0) + (records.wake ? 1 : 0)
  var streak = rules.calcStreak(fullDayKeysOf(s), dayKey)
  return ok({
    todayDone: done,
    todayTotal: rules.TYPES.length,
    streak: streak,
    sub: '今日 ' + done + '/' + rules.TYPES.length + ' · 连续 ' + streak + ' 天'
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
