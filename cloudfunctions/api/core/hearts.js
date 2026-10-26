/**
 * 内核 · ledger 爱心账本（唯一能加减爱心的地方）
 *
 * ⚠️ 当前仍是「情侣共享的一个池子」（存放于 couples.hearts），
 *    这是为了把架构搭起来时**行为完全不变**。
 *    P1b 会改成「个人钱包」（core_wallets，一人一本账），
 *    到那时只有这个文件的内部实现要改，所有模块的调用方式不变。
 *
 * 模块永远不直接写余额，只能通过 ctx.award() / ctx.balance() 说话。
 */
const { db, _, COL } = require('./db.js')

/**
 * 记一笔账
 * entries: [{ delta, reason, refId? }]
 * 返回：本次总变动
 */
async function apply(ctx, entries, extra) {
  const items = entries || []
  if (!items.length) return 0

  const now = (extra && extra.now) || Date.now()
  const dateKey = (extra && extra.dateKey) || ''
  let total = 0

  for (const e of items) {
    total += e.delta
    await db.collection(COL.hearts).add({
      data: {
        openid: ctx.openid,
        coupleId: ctx.coupleId,
        date: dateKey,
        at: now,
        delta: e.delta,
        reason: e.reason,
        module: (extra && extra.module) || '',
        refId: e.refId || ''
      }
    })
  }

  if (ctx.coupleId && total !== 0) {
    await db.collection(COL.couples).doc(ctx.coupleId).update({
      data: { hearts: _.inc(total) }
    })
  }

  return total
}

/** 当前余额（P1a 是共享池；P1b 会变成"我自己的余额"） */
async function balance(ctx) {
  try {
    const res = await db.collection(COL.couples).doc(ctx.coupleId).get()
    return (res.data && res.data.hearts) || 0
  } catch (e) {
    return 0
  }
}

/**
 * 爱心明细（给记录页用）
 * 容错：heart_logs 集合不存在时返回空数组 + 一句人话提示，不让整页挂掉
 */
async function history(openid, range) {
  const start = (range && range.start) || ''
  const end = (range && range.end) || ''

  try {
    const res = await db
      .collection(COL.hearts)
      .where({ openid: openid, date: _.gte(start).and(_.lte(end)) })
      .limit(200)
      .get()

    const logs = res.data
      .sort((a, b) => (b.at || 0) - (a.at || 0))
      .slice(0, 50)
      .map((l) => ({ date: l.date, at: l.at, delta: l.delta, reason: l.reason }))

    return { logs, warn: '' }
  } catch (err) {
    const msg = String((err && (err.errMsg || err.message)) || err)
    console.error('[ledger] 读 heart_logs 失败:', msg)

    if (/collection not exist|not exist|COLLECTION_NOT_EXIST|-502005/i.test(msg)) {
      return {
        logs: [],
        warn:
          '数据库里还没有 heart_logs 集合，所以爱心明细读不出来。去「云开发 → 数据库」建一个，权限选「所有用户不可读写」，然后重新部署云函数'
      }
    }
    return { logs: [], warn: '爱心明细读取失败（其他数据是好的）：' + msg }
  }
}

module.exports = { apply: apply, balance: balance, history: history }
