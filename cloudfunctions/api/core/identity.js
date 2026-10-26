/**
 * 内核 · identity 身份与关系
 *
 * 职责：登记信息、生成邀请码、配对、解绑、保证关系唯一。
 * 明确不做：密码登录、好友关系、权限角色。
 *
 * 三条硬约束（只有内核能守）：
 *   1. 一个人同时只属于一段关系
 *   2. 一段关系最多两个人
 *   3. 配对后双方 coupleId 必须一致
 *
 * 关系有三种状态：
 *   pending   已登记 / 还没配对
 *   active    已配对，可以使用功能
 *   dissolved 已解绑，数据封存（旧数据永远留在这个 coupleId 下）
 */
const { db, COL } = require('./db.js')
const { bizError } = require('./errors.js')

/* ------------------------------ 校验 ------------------------------ */

const RE_USER_ID = /^[\u4e00-\u9fa5A-Za-z0-9_-]{2,12}$/
const RE_PHONE = /^1\d{10}$/
const RE_DATE = /^\d{4}-\d{2}-\d{2}$/

const GENDERS = ['male', 'female', 'other']
const EDITABLE = ['userId', 'realName', 'phone', 'birthday', 'gender', 'bio', 'avatarEmoji']

function cleanText(v, max) {
  const s = String(v == null ? '' : v).trim()
  if (s.length > max) throw bizError('TOO_LONG', '最多 ' + max + ' 个字')
  return s
}

/** 校验并清洗登记信息；only 里的字段才处理 */
function normalizeProfile(input, only) {
  const src = input || {}
  const out = {}
  const keys = (only || EDITABLE).filter(function (k) {
    return Object.prototype.hasOwnProperty.call(src, k)
  })

  keys.forEach(function (k) {
    const v = src[k]

    if (k === 'userId') {
      const s = cleanText(v, 12)
      if (!RE_USER_ID.test(s)) {
        throw bizError('BAD_USER_ID', '用户 ID 要 2~12 个字，只能是中文/字母/数字/下划线/短横线')
      }
      out.userId = s
    } else if (k === 'realName') {
      const s = cleanText(v, 20)
      if (s.length < 2) throw bizError('BAD_REAL_NAME', '真实姓名至少 2 个字')
      out.realName = s
    } else if (k === 'phone') {
      const s = cleanText(v, 11)
      if (!RE_PHONE.test(s)) throw bizError('BAD_PHONE', '手机号要 11 位，以 1 开头')
      out.phone = s
    } else if (k === 'birthday') {
      const s = cleanText(v, 10)
      if (!RE_DATE.test(s)) throw bizError('BAD_BIRTHDAY', '生日格式要是 YYYY-MM-DD')
      out.birthday = s
    } else if (k === 'gender') {
      const s = String(v || '')
      if (GENDERS.indexOf(s) < 0) throw bizError('BAD_GENDER', '性别只能是 male / female / other')
      out.gender = s
    } else if (k === 'bio') {
      out.bio = cleanText(v, 100)
    } else if (k === 'avatarEmoji') {
      out.avatarEmoji = cleanText(v, 8) || '🙂'
    }
  })

  return out
}

/* ------------------------------ 关系 ------------------------------ */

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

/** 关系状态（老数据没有 status 字段，按成员数推断） */
function statusOf(couple) {
  if (!couple) return 'none'
  if (couple.status) return couple.status
  return (couple.members || []).length >= 2 ? 'active' : 'pending'
}

function isPaired(couple) {
  return statusOf(couple) === 'active' && (couple.members || []).length >= 2
}

/** 新建一段"只有我"的关系 */
async function createPendingCouple(openid) {
  const inviteCode = await uniqueInviteCode()
  const now = Date.now()
  const res = await db.collection(COL.couples).add({
    data: {
      inviteCode: inviteCode,
      members: [openid],
      status: 'pending',
      hearts: 0, // 旧字段，仅迁移期保留，不再写入
      createdAt: now
    }
  })
  return { _id: res._id, inviteCode: inviteCode, members: [openid], status: 'pending', createdAt: now }
}

/**
 * 拿我的档案；没有就建一条"空档案"（只有 openid，还没登记）
 * 「还没登记」由 userId 是否为空来判断
 */
async function getProfile(openid) {
  const res = await db.collection(COL.profiles).where({ openid: openid }).limit(1).get()
  if (res.data.length) return res.data[0]

  const couple = await createPendingCouple(openid)
  const now = Date.now()

  const profile = {
    openid: openid,
    userId: '',
    realName: '',
    phone: '',
    birthday: '',
    gender: '',
    bio: '',
    avatarEmoji: '🐰',
    coupleId: couple._id,
    registeredAt: null,
    createdAt: now,
    updatedAt: now
  }
  const added = await db.collection(COL.profiles).add({ data: profile })
  profile._id = added._id
  return profile
}

async function getProfileByOpenid(openid) {
  const res = await db.collection(COL.profiles).where({ openid: openid }).limit(1).get()
  return res.data.length ? res.data[0] : null
}

async function getCouple(coupleId) {
  if (!coupleId) return null
  try {
    const res = await db.collection(COL.couples).doc(coupleId).get()
    return res.data || null
  } catch (e) {
    return null
  }
}

/** 对方是谁（完整档案；没配对就是 null） */
async function getPartner(openid, couple) {
  if (!couple) return null
  const members = couple.members || []
  if (members.length < 2) return null

  const partnerOpenid = members.filter(function (m) {
    return m !== openid
  })[0]
  if (!partnerOpenid) return null

  return getProfileByOpenid(partnerOpenid)
}

/* ------------------------------ 登记 / 修改 ------------------------------ */

async function assertUserIdFree(userId, selfOpenid) {
  const res = await db.collection(COL.profiles).where({ userId: userId }).limit(1).get()
  if (res.data.length && res.data[0].openid !== selfOpenid) {
    throw bizError('USER_ID_TAKEN', '这个用户ID已经被用了，换一个吧')
  }
}

/** 首次登记：必填 6 项 */
async function register(openid, input) {
  const profile = await getProfile(openid)

  const data = normalizeProfile(input, EDITABLE)
  const required = ['userId', 'realName', 'phone', 'birthday', 'gender']
  required.forEach(function (k) {
    if (!data[k]) throw bizError('MISSING_' + k.toUpperCase(), '还有必填项没填：' + k)
  })

  await assertUserIdFree(data.userId, openid)

  const now = Date.now()
  data.registeredAt = now
  data.updatedAt = now

  await db.collection(COL.profiles).doc(profile._id).update({ data: data })
  return Object.assign({}, profile, data)
}

/** 任何时候都能改资料（userId 改了要重新查重） */
async function updateProfile(openid, input) {
  const profile = await getProfile(openid)
  if (!profile.userId) throw bizError('NOT_REGISTERED', '先把登记信息填完')

  const data = normalizeProfile(input, EDITABLE)
  if (!Object.keys(data).length) throw bizError('EMPTY', '没有要改的内容')

  if (data.userId && data.userId !== profile.userId) {
    await assertUserIdFree(data.userId, openid)
  }

  data.updatedAt = Date.now()
  await db.collection(COL.profiles).doc(profile._id).update({ data: data })
  return Object.assign({}, profile, data)
}

/* ------------------------------ 配对 ------------------------------ */

async function joinCouple(openid, inviteCode) {
  if (!inviteCode) throw bizError('EMPTY', '请先输入邀请码')

  const profile = await getProfile(openid)
  if (!profile.userId) throw bizError('NOT_REGISTERED', '先把登记信息填完，再配对')

  const target = await db.collection(COL.couples).where({ inviteCode: inviteCode }).limit(1).get()
  if (!target.data.length) throw bizError('NOT_FOUND', '邀请码不对哦，检查一下大小写')

  const tc = target.data[0]

  if (tc._id === profile.coupleId) throw bizError('SELF', '这是你自己的邀请码呀')
  if (statusOf(tc) !== 'pending') throw bizError('FULL', '这条邀请码已经用过了')
  if ((tc.members || []).length >= 2) throw bizError('FULL', '这段关系已经满员啦')

  const old = await getCouple(profile.coupleId)

  await db.collection(COL.couples).doc(tc._id).update({
    data: {
      members: (tc.members || []).concat([openid]),
      status: 'active',
      pairedAt: Date.now()
    }
  })

  await db.collection(COL.profiles).doc(profile._id).update({
    data: { coupleId: tc._id, updatedAt: Date.now() }
  })

  // 自己原来那条空关系删掉，别留垃圾数据（只删"从没被用过"的）
  if (old && old._id !== tc._id && statusOf(old) === 'pending' && (old.members || []).length <= 1) {
    try {
      const c = await db.collection(COL.checkins).where({ coupleId: old._id }).count()
      if (!c.total) await db.collection(COL.couples).doc(old._id).remove()
    } catch (e) {
      // 集合不存在之类的，忽略
    }
  }

  return { ok: true }
}

/** 给客户端看的档案（两个人互相可见） */
function publicProfile(p) {
  if (!p) return null
  return {
    userId: p.userId || '',
    displayName: p.userId || p.nickname || '未命名',
    realName: p.realName || '',
    phone: p.phone || '',
    birthday: p.birthday || '',
    gender: p.gender || '',
    bio: p.bio || '',
    avatarEmoji: p.avatarEmoji || '🙂'
  }
}

module.exports = {
  // 校验
  normalizeProfile: normalizeProfile,
  // 关系
  statusOf: statusOf,
  isPaired: isPaired,
  createPendingCouple: createPendingCouple,
  // 档案
  getProfile: getProfile,
  getProfileByOpenid: getProfileByOpenid,
  getCouple: getCouple,
  getPartner: getPartner,
  register: register,
  updateProfile: updateProfile,
  joinCouple: joinCouple,
  publicProfile: publicProfile
}
