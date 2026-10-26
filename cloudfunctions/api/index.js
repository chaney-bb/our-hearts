/**
 * 云函数：api
 * 小程序端所有数据操作都走这里，一个函数用 action 分发。
 *
 * 为什么打卡判定必须放在云函数里？
 *   因为客户端的时间可以被用户手动改（把手机时间调成 22:00 就能刷爱心），
 *   只有云函数的时间是"服务器时间"，改不了。
 *
 * 部署方法：微信开发者工具里右键 cloudfunctions/api -> 上传并部署（云端安装依赖）
 */
const cloud = require('wx-server-sdk')
const rules = require('./rules.js')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

const COL = {
  profiles: 'profiles',
  couples: 'couples',
  checkins: 'checkins',
  logs: 'heart_logs'
}

// 算连续天数时往回查多少天（够用且不会太慢）
const LOOKBACK_DAYS = 60

/* ------------------------------ 基础工具 ------------------------------ */

function randomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let s = ''
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)]
  return s
}

async function uniqueInviteCode() {
  for (let i = 0; i < 8; i++) {
    const code = randomCode()
    const res = await db.collection(COL.couples).where({ inviteCode: code }).count()
    if (res.total === 0) return code
  }
  return randomCode()
}

function bestStreakOf(keys) {
  const sorted = keys.slice().sort()
  let best = 0
  let run = 0
  let prev = ''
  for (const k of sorted) {
    if (prev && rules.shiftKey(prev, 1) === k) run++
    else run = 1
    if (run > best) best = run
    prev = k
  }
  return best
}

/* ------------------------------ 数据读写 ------------------------------ */

async function getProfile(openid) {
  const res = await db.collection(COL.profiles).where({ openid }).limit(1).get()
  if (res.data.length) return res.data[0]

  const now = Date.now()
  const inviteCode = await uniqueInviteCode()

  // 第一次打开：先给自己建一条"只有我"的情侣关系，顺手生成邀请码
  const coupleRes = await db.collection(COL.couples).add({
    data: { inviteCode, members: [openid], hearts: 0, createdAt: now }
  })

  const profile = {
    openid,
    nickname: '小可爱',
    avatarEmoji: '🐰',
    coupleId: coupleRes._id,
    createdAt: now
  }
  const added = await db.collection(COL.profiles).add({ data: profile })
  profile._id = added._id
  return profile
}

async function getCouple(coupleId) {
  if (!coupleId) return null
  try {
    const res = await db.collection(COL.couples).doc(coupleId).get()
    return res.data
  } catch (e) {
    return null
  }
}

async function getRecords(openid, dateKey) {
  const res = await db.collection(COL.checkins).where({ openid, date: dateKey }).get()
  const records = {}
  res.data.forEach(function (d) {
    records[d.type] = { at: d.at }
  })
  return records
}

async function getFullDayKeys(openid, todayKey) {
  const start = rules.shiftKey(todayKey, -(LOOKBACK_DAYS - 1))
  const res = await db
    .collection(COL.checkins)
    .where({ openid, date: _.gte(start).and(_.lte(todayKey)) })
    .limit(500)
    .get()

  const map = {}
  res.data.forEach(function (d) {
    if (!map[d.date]) map[d.date] = {}
    map[d.date][d.type] = true
  })

  return Object.keys(map).filter(function (k) {
    return map[k].sleep && map[k].wake
  })
}

/* ------------------------------ 业务动作 ------------------------------ */

async function buildHome(openid) {
  const profile = await getProfile(openid)
  const couple = await getCouple(profile.coupleId)
  const now = Date.now()
  const todayKey = rules.dateKey(now)

  const records = await getRecords(openid, todayKey)
  const fullDayKeys = await getFullDayKeys(openid, todayKey)

  const members = (couple && couple.members) || []
  const partnerOpenid = members.filter(function (m) {
    return m !== openid
  })[0]

  let partner = null
  if (partnerOpenid) {
    const pr = await db.collection(COL.profiles).where({ openid: partnerOpenid }).limit(1).get()
    if (pr.data.length) {
      partner = {
        nickname: pr.data[0].nickname,
        avatarEmoji: pr.data[0].avatarEmoji
      }
    }
  }

  const recent = []
  for (let i = 6; i >= 0; i--) {
    const k = rules.shiftKey(todayKey, -i)
    recent.push({ date: k, fullDay: fullDayKeys.indexOf(k) >= 0 })
  }

  return {
    ok: true,
    mode: 'cloud',
    serverNow: now,
    me: { nickname: profile.nickname, avatarEmoji: profile.avatarEmoji },
    partner: partner,
    bound: !!partner,
    inviteCode: couple ? couple.inviteCode : '',
    daysTogether: couple ? Math.floor((now - couple.createdAt) / 86400000) + 1 : 1,
    hearts: couple ? couple.hearts || 0 : 0,
    streak: rules.calcStreak(fullDayKeys, todayKey),
    today: {
      date: todayKey,
      records: records,
      fullDay: !!(records.sleep && records.wake)
    },
    recent: recent,
    // 把云端正在用的规则带回去，客户端一比对就知道云函数有没有重新部署
    rules: { windows: rules.RULES.windows, hearts: rules.RULES.hearts }
  }
}

async function doCheckin(openid, type) {
  const w = rules.RULES.windows[type]
  if (!w) return { ok: false, code: 'BAD_TYPE', message: '没有这个打卡项' }

  const profile = await getProfile(openid)
  const couple = await getCouple(profile.coupleId)
  const now = Date.now()

  // 关键：用服务器时间判断，不用客户端时间
  const state = rules.windowState(type, now)
  if (state === 'upcoming') {
    return {
      ok: false,
      code: 'NOT_YET',
      message: w.label + '打卡 ' + w.start + ' 才开始（云端现在 ' + rules.timeKey(now) + '）'
    }
  }
  if (state === 'expired') {
    return {
      ok: false,
      code: 'CLOSED',
      message: '今天已经过了' + w.label + '打卡时间（窗口 ' + w.start + '–' + w.end + '）'
    }
  }

  const todayKey = rules.dateKey(now)

  const dup = await db.collection(COL.checkins).where({ openid, date: todayKey, type }).count()
  if (dup.total > 0) {
    return { ok: false, code: 'DUP', message: '今天已经打过卡啦' }
  }

  await db.collection(COL.checkins).add({
    data: {
      openid: openid,
      coupleId: profile.coupleId,
      date: todayKey,
      type: type,
      at: now,
      source: 'normal'
    }
  })

  const records = await getRecords(openid, todayKey)
  const isFullDay = !!(records.sleep && records.wake)

  // 对方今天有没有完成同一项（同步奖）
  let partnerDone = false
  const members = (couple && couple.members) || []
  const partnerOpenid = members.filter(function (m) {
    return m !== openid
  })[0]
  if (partnerOpenid) {
    const pr = await db
      .collection(COL.checkins)
      .where({ openid: partnerOpenid, date: todayKey, type: type })
      .count()
    partnerDone = pr.total > 0
  }

  const fullDayKeys = await getFullDayKeys(openid, todayKey)
  const streakAfter = rules.calcStreak(fullDayKeys, todayKey)

  const awards = rules.checkinAwards({
    type: type,
    isFullDay: isFullDay,
    partnerDone: partnerDone,
    streakAfter: streakAfter
  })

  let total = 0
  for (const a of awards) {
    total += a.delta
    await db.collection(COL.logs).add({
      data: {
        openid: openid,
        coupleId: profile.coupleId,
        date: todayKey,
        at: now,
        delta: a.delta,
        reason: a.reason
      }
    })
  }

  if (couple && total > 0) {
    await db.collection(COL.couples).doc(couple._id).update({
      data: { hearts: _.inc(total) }
    })
  }

  return {
    ok: true,
    home: await buildHome(openid),
    reward: {
      delta: total,
      reasons: awards.map(function (a) {
        return a.reason + ' +' + a.delta
      })
    }
  }
}

async function getHistory(openid, month) {
  const profile = await getProfile(openid)
  const couple = await getCouple(profile.coupleId)
  const start = month + '-01'
  const end = month + '-31'

  const res = await db
    .collection(COL.checkins)
    .where({ openid, date: _.gte(start).and(_.lte(end)) })
    .limit(500)
    .get()

  const days = {}
  res.data.forEach(function (d) {
    if (!days[d.date]) days[d.date] = { sleep: false, wake: false }
    days[d.date][d.type] = true
  })

  const fullKeys = Object.keys(days).filter(function (k) {
    return days[k].sleep && days[k].wake
  })

  // 爱心流水单独查，并且容错：这个集合没建也不该让整个记录页挂掉
  let logs = []
  let warn = ''
  try {
    const logsRes = await db
      .collection(COL.logs)
      .where({ openid: openid, date: _.gte(start).and(_.lte(end)) })
      .limit(200)
      .get()

    // 不用 orderBy：云开发里 where + orderBy 可能要求建索引，直接在代码里排序更省事
    logs = logsRes.data
      .sort(function (a, b) {
        return (b.at || 0) - (a.at || 0)
      })
      .slice(0, 50)
      .map(function (l) {
        return { date: l.date, at: l.at, delta: l.delta, reason: l.reason }
      })
  } catch (err) {
    const msg = String((err && (err.errMsg || err.message)) || err)
    console.error('[history] 读 heart_logs 失败:', msg)
    if (/collection not exist|not exist|COLLECTION_NOT_EXIST|-502005/i.test(msg)) {
      warn = '数据库里还没有 heart_logs 集合，所以爱心明细读不出来。去「云开发 → 数据库」建一个，权限选「所有用户不可读写」，然后重新部署云函数'
    } else {
      warn = '爱心明细读取失败（日历数据是好的）：' + msg
    }
  }

  return {
    ok: true,
    mode: 'cloud',
    month: month,
    days: days,
    stats: { fullCount: fullKeys.length, bestStreak: bestStreakOf(fullKeys) },
    logs: logs,
    warn: warn,
    hearts: couple ? couple.hearts || 0 : 0
  }
}

async function joinCouple(openid, inviteCode) {
  if (!inviteCode) return { ok: false, code: 'EMPTY', message: '请先输入邀请码' }

  const profile = await getProfile(openid)
  const target = await db.collection(COL.couples).where({ inviteCode: inviteCode }).limit(1).get()

  if (!target.data.length) {
    return { ok: false, code: 'NOT_FOUND', message: '邀请码不对哦，检查一下大小写' }
  }

  const tc = target.data[0]

  if (tc._id === profile.coupleId) {
    return { ok: false, code: 'SELF', message: '这是你自己的邀请码呀' }
  }
  if ((tc.members || []).length >= 2) {
    return { ok: false, code: 'FULL', message: '这对已经满员啦' }
  }

  const old = await getCouple(profile.coupleId)

  await db.collection(COL.couples).doc(tc._id).update({
    data: { members: (tc.members || []).concat([openid]) }
  })

  await db.collection(COL.profiles).doc(profile._id).update({
    data: { coupleId: tc._id, avatarEmoji: '🐻' }
  })

  // 自己原来那条空关系删掉，别留垃圾数据
  if (old && old._id !== tc._id && (!old.members || old.members.length <= 1)) {
    const c = await db.collection(COL.checkins).where({ coupleId: old._id }).count()
    if (!c.total) {
      await db.collection(COL.couples).doc(old._id).remove()
    }
  }

  return { ok: true, home: await buildHome(openid) }
}

/* ------------------------------ 入口 ------------------------------ */

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  if (!openid) return { ok: false, code: 'NO_OPENID', message: '拿不到用户身份，请从微信里打开' }

  const action = event.action

  try {
    if (action === 'home') return await buildHome(openid)
    if (action === 'checkin') return await doCheckin(openid, event.type)
    if (action === 'history') return await getHistory(openid, event.month || rules.monthKey(Date.now()))
    if (action === 'joinCouple') {
      return await joinCouple(openid, String(event.inviteCode || '').trim().toUpperCase())
    }
    return { ok: false, code: 'UNKNOWN', message: '未知操作：' + action }
  } catch (err) {
    console.error('[api 出错]', action, err)
    // 千万不要把真实原因藏起来：带上 detail，页面才能显示到底哪一行炸了
    const detail = String((err && (err.errMsg || err.message)) || err)
    return {
      ok: false,
      code: 'ERROR',
      message: '云函数执行出错（' + action + '）',
      detail: detail
    }
  }
}
