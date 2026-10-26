/**
 * 内核 · 模块上下文 ctx
 *
 * 模块能看到的整个世界就是这个对象。故意不给的：
 *   - 别的模块的引用
 *   - 原始 db 句柄（只能访问自己声明的集合）
 *   - cloud 对象
 * 不给，就写不出耦合代码。
 */
const clock = require('./clock.js')
const identity = require('./identity.js')
const hearts = require('./hearts.js')
const settings = require('./settings.js')
const { db } = require('./db.js')

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
  const couple = await identity.getCouple(profile.coupleId)
  const partner = await identity.getPartner(openid, couple)
  const config = await settings.load(profile.coupleId, mod)

  const ctx = {
    // 我是谁
    openid: openid,
    me: {
      openid: profile.openid,
      nickname: profile.nickname,
      avatarEmoji: profile.avatarEmoji
    },

    // 和谁一对
    coupleId: profile.coupleId,
    couple: couple,
    partner: partner ? { openid: partner.openid, nickname: partner.nickname, avatarEmoji: partner.avatarEmoji } : null,
    isPaired: !!partner,

    // 现在是什么时候（服务器时间，不可伪造）
    now: now,
    dateKey: clock.dateKey(now),

    // 这个模块的规则（默认值 + 用户覆盖）
    config: config,

    // 只能碰自己声明的集合
    db: scopedDb(mod),

    // 唯一的爱心入口
    award: async function (n, reason, refId) {
      return hearts.apply(ctx, [{ delta: n, reason: reason, refId: refId }], {
        now: ctx.now,
        dateKey: ctx.dateKey,
        module: mod.key
      })
    },

    balance: function () {
      return hearts.balance(ctx)
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
