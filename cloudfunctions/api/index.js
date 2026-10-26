/**
 * 云函数入口：只有路由，没有任何业务
 *
 * 接口命名：<模块key>.<动作>   例如 checkin.act、checkin.detail
 * 系统动作：session.*（由内核直接提供，不经过模块）
 *
 * 部署方法：微信开发者工具里右键 cloudfunctions/api → 上传并部署（云端安装依赖）
 */
const { cloud } = require('./core/db.js')
const registry = require('./core/registry.js')
const context = require('./core/context.js')
const identity = require('./core/identity.js')
const session = require('./core/session.js')
const hearts = require('./core/hearts.js')
const approvals = require('./core/approvals.js')
const scheduler = require('./core/scheduler.js')
const respond = require('./core/respond.js')
const { bizError } = require('./core/errors.js')

// 旧版客户端用的接口名（重构前是 home / checkin / history / joinCouple）
const LEGACY = { home: 1, checkin: 1, history: 1, joinCouple: 1 }

/* ------------------------------ 系统动作 ------------------------------ */

async function runSystem(action, payload, openid) {
  if (action === 'session.get') return session.get(openid)

  if (action === 'session.register') {
    await identity.register(openid, payload.data || payload)
    return session.get(openid)
  }

  if (action === 'session.updateProfile') {
    await identity.updateProfile(openid, payload.data || payload)
    return session.get(openid)
  }

  if (action === 'session.bind') {
    const code = String(payload.inviteCode || '').trim().toUpperCase()
    await identity.joinCouple(openid, code)
    return session.get(openid)
  }

  if (action === 'session.unbind') {
    await session.unbind(openid, payload.confirm === true)
    return session.get(openid)
  }

  // 自检：钱包余额 vs 流水之和（只查自己，随手可点）
  if (action === 'session.verify') {
    const profile = await identity.getProfile(openid)
    return hearts.verify(openid, profile.coupleId)
  }

  // ---------- 工单（审批） ----------
  if (action === 'approvals.list') {
    const profile = await identity.getProfile(openid)
    const empty = { toMe: [], mine: [] }
    if (!profile.coupleId) return empty
    return approvals.list(openid, profile.coupleId)
  }

  if (action === 'approvals.decide') {
    const profile = await identity.getProfile(openid)
    if (!profile.coupleId) throw bizError('NOT_PAIRED', '先和 TA 配对')
    const r = await approvals.decide(
      openid,
      profile.coupleId,
      payload.id,
      payload.approve === true,
      registry
    )
    return {
      ticket: r.ticket,
      applied: r.applied,
      list: await approvals.list(openid, profile.coupleId)
    }
  }

  return null
}

const SYSTEM = {
  'session.get': 1,
  'session.register': 1,
  'session.updateProfile': 1,
  'session.bind': 1,
  'session.unbind': 1,
  'session.verify': 1,
  'approvals.list': 1,
  'approvals.decide': 1
}

/* ------------------------------ 入口 ------------------------------ */

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
    // ---------- 定时结算（只有定时触发器 / 测试可以触发）----------
    if (action === 'settle.run') {
      const isTimer =
        (event && (event.Type === 'Timer' || event.type === 'timer')) || payload.force === true
      if (!isTimer) return respond.fail('FORBIDDEN', '结算只能由定时触发器调用')
      return respond.ok(await scheduler.runAll(Date.now()))
    }

    // ---------- 系统动作 ----------
    if (SYSTEM[action]) {
      const data = await runSystem(action, payload, openid)
      return respond.ok(data)
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
    // 内核用 bizError 表达业务失败（没登记 / 没配对 / 爱心不够…）
    if (err && err.biz) {
      return respond.fail(err.code, err.message)
    }

    console.error('[api 出错]', action, err)
    const detail = String((err && (err.errMsg || err.message)) || err)
    return respond.fail('ERROR', '云函数执行出错（' + action + '）', detail)
  }
}
