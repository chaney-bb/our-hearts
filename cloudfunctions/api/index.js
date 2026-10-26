/**
 * 云函数入口：只有路由，没有任何业务
 *
 * 接口命名：<模块key>.<动作>   例如 checkin.act、checkin.detail
 * 系统动作：session.get、session.bind（由内核直接提供，不经过模块）
 *
 * 部署方法：微信开发者工具里右键 cloudfunctions/api → 上传并部署（云端安装依赖）
 */
const { cloud } = require('./core/db.js')
const registry = require('./core/registry.js')
const context = require('./core/context.js')
const identity = require('./core/identity.js')
const respond = require('./core/respond.js')

// 旧版客户端用的接口名（重构前是 home / checkin / history / joinCouple）
const LEGACY = { home: 1, checkin: 1, history: 1, joinCouple: 1 }

exports.main = async (event) => {
  const action = String((event && event.action) || '')
  const payload = (event && event.payload) || {}

  let openid = ''
  try {
    openid = cloud.getWXContext().OPENID
  } catch (e) {}

  if (!openid) return respond.fail('NO_OPENID', '拿不到用户身份，请从微信里打开')

  if (LEGACY[action]) {
    return respond.fail(
      'CLIENT_OUTDATED',
      '小程序界面还是旧版本，在开发者工具里点一下「编译」刷新即可'
    )
  }

  try {
    // ---------- 系统动作（内核直接提供）----------
    if (action === 'session.get') {
      return respond.ok(await identity.session(openid))
    }

    if (action === 'session.bind') {
      const code = String(payload.inviteCode || '').trim().toUpperCase()
      const r = await identity.joinCouple(openid, code)
      if (!r.ok) return respond.fail(r.code, r.message)
      return respond.ok(await identity.session(openid))
    }

    // ---------- 模块动作：checkin.act ----------
    const seg = action.split('.')
    if (seg.length !== 2 || !seg[0] || !seg[1]) {
      return respond.fail('BAD_ACTION', '接口名不对：' + action)
    }

    const mod = registry.get(seg[0])
    if (!mod) return respond.fail('NO_MODULE', '没有这个功能：' + seg[0])

    const fn = mod.actions[seg[1]]
    if (!fn) return respond.fail('NO_ACTION', mod.key + ' 没有这个动作：' + seg[1])

    const ctx = await context.create(mod, openid)
    const result = await fn(ctx, payload)

    // 模块可以返回 respond.biz(...) 表示"业务上的失败"（比如还没到打卡时间）
    if (result && result.ok === false) {
      return respond.fail(result.code, result.message)
    }

    return respond.ok(result)
  } catch (err) {
    console.error('[api 出错]', action, err)
    const detail = String((err && (err.errMsg || err.message)) || err)
    return respond.fail('ERROR', '云函数执行出错（' + action + '）', detail)
  }
}
