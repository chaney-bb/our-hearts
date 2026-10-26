/**
 * 内核 · 模块上下文 ctx
 *
 * 模块能看到的整个世界就是这个对象。故意不给的：
 *   - 别的模块的引用
 *   - 原始 db 句柄（只能访问自己声明的集合）
 *   - cloud 对象
 * 不给，就写不出耦合代码。
 *
 * 组装时有两道门禁（P1b）：
 *   1. 没登记（userId 为空）  -> NEED_REGISTER
 *   2. 没配对（关系不是 active）-> NOT_PAIRED（模块可 requiresPair:false 关掉）
 */
const clock = require('./clock.js')
const identity = require('./identity.js')
const hearts = require('./hearts.js')
const settings = require('./settings.js')
const { db } = require('./db.js')
const { bizError } = require('./errors.js')

/** 把 db 收窄成"只能碰自己声明的集合" */
function scopedDb(mod) {
  const allowed = mod.collections || []
  return {
    collection(name) {
      if (allowed.indexOf(name) < 0) {
        throw new Error('模块 ' + mod.key + ' 无权访问集合 ' + name + '（请在模块的 collections 里声明）')
      }
      return db.collection(name)
    }
  }
}

async function create(mod, openid) {
  const now = Date.now()
  const profile = await identity.getProfile(openid)

  // 门禁 1：没登记不能玩
  if (!profile.userId) {
    throw bizError('NEED_REGISTER', '先把登记信息填完')
  }

  const couple = await identity.getCouple(profile.coupleId)
  const paired = identity.isPaired(couple)

  // 门禁 2：没配对不能用任何模块
  if (!paired && mod.requiresPair !== false) {
    throw bizError('NOT_PAIRED', '先和 TA 配对才能用这个功能')
  }

  const partnerProfile = paired ? await identity.getPartner(openid, couple) : null
  const config = await settings.load(profile.coupleId, mod)

  const ctx = {
    // 我是谁
    openid: openid,
    me: Object.assign({ openid: openid }, identity.publicProfile(profile)),

    // 和谁一对
    coupleId: profile.coupleId,
    couple: couple,
    coupleStatus: identity.statusOf(couple),
    partner: partnerProfile ? Object.assign({ openid: partnerProfile.openid }, identity.publicProfile(partnerProfile)) : null,
    isPaired: paired,

    // 现在是什么时候（服务器时间，不可伪造）
    now: now,
    dateKey: clock.dateKey(now),

    // 这个模块的规则（默认值 + 用户覆盖）
    config: config,

    // 只能碰自己声明的集合
    db: scopedDb(mod),

    // 唯一的爱心入口（只能加/减自己的）
    // opts: { refId, idemKey }  —— idemKey 用来防重复发放
    award: async function (n, reason, opts) {
      var o = opts || {}
      return hearts.apply(
        ctx,
        [{ delta: n, reason: reason, refId: o.refId || '', idemKey: o.idemKey || '' }],
        { now: ctx.now, dateKey: ctx.dateKey, module: mod.key }
      )
    },

    /** 扣自己的爱心（扣到 0 封顶）；实际扣了多少返回多少 */
    penalize: async function (n, reason, opts) {
      var o = opts || {}
      var balance = await hearts.balanceOf(ctx.openid, ctx.coupleId)
      var amount = Math.min(Math.max(0, n), Math.max(0, balance))
      if (amount <= 0) return 0
      return hearts.apply(
        ctx,
        [{ delta: -amount, reason: reason, refId: o.refId || '', idemKey: o.idemKey || '' }],
        { now: ctx.now, dateKey: ctx.dateKey, module: mod.key }
      )
    },

    balance: function () {
      return hearts.balanceOf(ctx.openid, ctx.coupleId)
    },

    // 模块之间的联动（P5 才实现，现在发出去没人听，安全空转）
    emit: function (name, payload) {
      void name
      void payload
    }
  }

  return ctx
}

module.exports = { create: create }
