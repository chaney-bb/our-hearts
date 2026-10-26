/**
 * 内核 · approvals 工单（审批）
 *
 * 打卡申诉、改打卡规则、以后的消费申请，都是"一方发起、另一方审批"。
 * 这不是某个模块的私事，所以放在内核 —— 但内核只管**状态机**：
 *   - 谁能审批（toOpenid）
 *   - 状态怎么流转（pending → approved / rejected / expired）
 *   - 同一业务不能被重复申请
 * "同意之后业务上做什么"由模块自己实现（modules/<key>.onDecision）。
 *
 * 这样打卡模块不需要知道"消费申请"的存在，也不会出现两套审批逻辑。
 */
const { db, COL } = require('./db.js')
const { bizError } = require('./errors.js')

const STATUS = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  EXPIRED: 'expired'
}

/**
 * 发起工单
 * opts: { module, type, coupleId, fromOpenid, toOpenid, refId, title, summary, payload }
 */
async function create(opts) {
  const o = opts || {}
  if (!o.module || !o.type) throw bizError('BAD_TICKET', '工单缺少 module / type')
  if (!o.coupleId || !o.fromOpenid || !o.toOpenid) throw bizError('BAD_TICKET', '工单缺少双方信息')

  // 同一业务同时只能有一个待处理工单（防止连点提交一串）
  const dup = await db
    .collection(COL.approvals)
    .where({
      module: o.module,
      type: o.type,
      refId: o.refId || '',
      fromOpenid: o.fromOpenid,
      status: STATUS.PENDING
    })
    .count()

  if (dup.total > 0) {
    throw bizError('TICKET_EXISTS', '这件事已经提交过申请了，等对方处理就行')
  }

  const now = Date.now()
  const doc = {
    module: o.module,
    type: o.type,
    coupleId: o.coupleId,
    fromOpenid: o.fromOpenid,
    toOpenid: o.toOpenid,
    refId: o.refId || '',
    title: o.title || '',
    summary: o.summary || '',
    payload: o.payload || {},
    status: STATUS.PENDING,
    createdAt: now,
    decidedAt: 0,
    decideOpenid: ''
  }

  const res = await db.collection(COL.approvals).add({ data: doc })
  doc._id = res._id
  return doc
}

/** 我的工单列表：待我处理的 + 我发起的 */
async function list(openid, coupleId) {
  const toMe = await db
    .collection(COL.approvals)
    .where({ coupleId: coupleId, toOpenid: openid, status: STATUS.PENDING })
    .limit(50)
    .get()

  const mine = await db
    .collection(COL.approvals)
    .where({ coupleId: coupleId, fromOpenid: openid })
    .limit(50)
    .get()

  const pick = (d) => ({
    id: d._id,
    module: d.module,
    type: d.type,
    title: d.title,
    summary: d.summary,
    status: d.status,
    refId: d.refId,
    createdAt: d.createdAt,
    decidedAt: d.decidedAt,
    payload: d.payload || {}
  })

  const sortDesc = (a, b) => (b.createdAt || 0) - (a.createdAt || 0)

  return {
    toMe: toMe.data.map(pick).sort(sortDesc),
    mine: mine.data.map(pick).sort(sortDesc)
  }
}

/**
 * 处理工单
 * 返回 { ticket, applied }  —— applied 是模块回调的返回值
 */
async function decide(openid, coupleId, ticketId, approve, registry) {
  if (!ticketId) throw bizError('BAD_TICKET', '缺少工单 id')

  let doc = null
  try {
    const res = await db.collection(COL.approvals).doc(ticketId).get()
    doc = res.data
  } catch (e) {
    throw bizError('NOT_FOUND', '这张工单不存在')
  }
  if (!doc) throw bizError('NOT_FOUND', '这张工单不存在')
  if (doc.coupleId !== coupleId) throw bizError('FORBIDDEN', '这不是你们的工单')
  if (doc.toOpenid !== openid) throw bizError('FORBIDDEN', '这张工单不归你处理')
  if (doc.status !== STATUS.PENDING) throw bizError('ALREADY_DECIDED', '这张工单已经处理过了')

  const now = Date.now()
  const status = approve ? STATUS.APPROVED : STATUS.REJECTED

  await db.collection(COL.approvals).doc(ticketId).update({
    data: { status: status, decidedAt: now, decideOpenid: openid }
  })

  const ticket = Object.assign({}, doc, {
    _id: ticketId,
    status: status,
    decidedAt: now,
    decideOpenid: openid
  })

  // 交给模块去"承担后果"
  let applied = null
  const mod = registry.get(doc.module)
  if (mod && mod.onDecision && typeof mod.onDecision[doc.type] === 'function') {
    try {
      applied = await mod.onDecision[doc.type](
        { coupleId: coupleId, openid: openid, now: now },
        ticket,
        { approve: approve }
      )
    } catch (err) {
      console.error('[approvals] 模块回调失败', doc.module, doc.type, err)
      // 状态已经改了，但业务没生效 —— 记下来，别静默
      applied = { error: String((err && err.message) || err) }
    }
  }

  return { ticket: ticket, applied: applied }
}

module.exports = {
  STATUS: STATUS,
  create: create,
  list: list,
  decide: decide
}
