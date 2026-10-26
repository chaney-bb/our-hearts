/**
 * 内核 · identity 身份与关系
 *
 * 职责：登记信息、生成邀请码、配对、保证关系唯一。
 * 明确不做：密码登录、好友关系、权限角色。
 *
 * 三条硬约束（只有内核能守）：
 *   1. 一个人同时只属于一对
 *   2. 一对最多两个人
 *   3. 配对后双方 coupleId 必须一致
 */
const { db, COL } = require('./db.js')

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

/**
 * 拿我的登记信息；没有就自动建一条（+ 一条只有我自己的情侣关系）
 * 注意：P1b 会改成"首次进入必须填昵称头像"，那时这里就不再自动建默认昵称了。
 */
async function getProfile(openid) {
  const res = await db.collection(COL.profiles).where({ openid }).limit(1).get()
  if (res.data.length) return res.data[0]

  const now = Date.now()
  const inviteCode = await uniqueInviteCode()

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

/** 对方是谁（没配对就是 null） */
async function getPartner(openid, couple) {
  const members = (couple && couple.members) || []
  const partnerOpenid = members.filter((m) => m !== openid)[0]
  if (!partnerOpenid) return null

  const pr = await db.collection(COL.profiles).where({ openid: partnerOpenid }).limit(1).get()
  if (!pr.data.length) return null
  return { openid: partnerOpenid, nickname: pr.data[0].nickname, avatarEmoji: pr.data[0].avatarEmoji }
}

/** 用邀请码配对 */
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

  return { ok: true }
}

/**
 * 客户端要的"我是谁"汇总
 * 外壳首页、配对页都只调这一个
 */
async function session(openid) {
  const profile = await getProfile(openid)
  const couple = await getCouple(profile.coupleId)
  const partner = await getPartner(openid, couple)
  const now = Date.now()

  return {
    me: {
      openid: profile.openid,
      nickname: profile.nickname,
      avatarEmoji: profile.avatarEmoji
    },
    partner: partner
      ? { nickname: partner.nickname, avatarEmoji: partner.avatarEmoji }
      : null,
    bound: !!partner,
    inviteCode: couple ? couple.inviteCode : '',
    daysTogether: couple ? Math.floor((now - couple.createdAt) / 86400000) + 1 : 1
  }
}

module.exports = {
  getProfile: getProfile,
  getCouple: getCouple,
  getPartner: getPartner,
  joinCouple: joinCouple,
  session: session
}
