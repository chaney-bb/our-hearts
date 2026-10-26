/**
 * 内核 · session 会话（我是谁 / 和谁一对 / 双方余额）与关系生命周期
 *
 * 为什么单独一个文件：
 *   它是 identity + ledger 的组合视图，属于"内核给前端的门面"，
 *   把它塞进 identity 会让 identity 依赖账本。
 */
const { db, COL } = require('./db.js')
const identity = require('./identity.js')
const hearts = require('./hearts.js')
const clock = require('./clock.js')
const { bizError } = require('./errors.js')

/** 给客户端的完整会话 */
async function get(openid) {
  const profile = await identity.getProfile(openid)
  const couple = await identity.getCouple(profile.coupleId)
  const paired = identity.isPaired(couple)
  const partnerProfile = paired ? await identity.getPartner(openid, couple) : null

  const mine = await hearts.balanceOf(openid, profile.coupleId)
  const partners = partnerProfile ? await hearts.balanceOf(partnerProfile.openid, profile.coupleId) : 0

  const now = Date.now()
  const since = couple ? couple.pairedAt || couple.createdAt : now

  return {
    needRegister: !profile.userId,
    needPair: !paired,
    bound: paired,
    coupleStatus: identity.statusOf(couple),
    me: identity.publicProfile(profile),
    partner: paired ? identity.publicProfile(partnerProfile) : null,
    inviteCode: couple ? couple.inviteCode : '',
    daysTogether: Math.floor((now - since) / 86400000) + 1,
    wallet: { balance: mine },
    partnerWallet: { balance: partners }
  }
}

/**
 * 解绑：封存旧关系 + 双方清零 + 各自拿到新的 pending 关系
 *
 * confirm 必须是 true（前端要弹两次确认），防止误触。
 */
async function unbind(openid, confirm) {
  if (confirm !== true) throw bizError('NO_CONFIRM', '解绑需要二次确认')

  const profile = await identity.getProfile(openid)
  const couple = await identity.getCouple(profile.coupleId)
  if (!identity.isPaired(couple)) throw bizError('NOT_PAIRED', '当前没有可以解绑的关系')

  const now = Date.now()
  const dateKey = clock.dateKey(now)
  const members = (couple.members || []).slice()

  // 1. 双方清零（写反向流水，账仍然平）
  for (const m of members) {
    await hearts.clearToZero(m, couple._id, now, dateKey)
  }

  // 2. 封存这段关系：数据留在旧 coupleId 下，永不删除
  await db.collection(COL.couples).doc(couple._id).update({
    data: { status: 'dissolved', dissolvedAt: now }
  })

  // 3. 两个人各自拿到一条新的 pending 关系（重新开始）
  for (const m of members) {
    const p = await identity.getProfileByOpenid(m)
    if (!p) continue
    const nc = await identity.createPendingCouple(m)
    await db.collection(COL.profiles).doc(p._id).update({
      data: { coupleId: nc._id, updatedAt: now }
    })
  }

  return { ok: true }
}

module.exports = { get: get, unbind: unbind }
