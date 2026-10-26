/**
 * 内核 · ledger 爱心账本（个人钱包版，P1b）
 *
 * 一人一本账：openid 只属于自己的钱包，别人只能看不能动。
 * 唯一能加减爱心的地方，模块永远不直接写余额。
 *
 * 三条不变式（测试盯住）：
 *   1. wallet.balance === sum(heart_logs.delta where openid)
 *   2. balance >= 0
 *   3. 同一个 idemKey 只有一笔流水
 *
 * 关于"清零"：解绑时不直接把 balance 改成 0，而是写一条反向流水
 *   （delta = -balance, reason = '解除绑定清零'）。
 *   这样"余额 = 流水之和"永远成立，历史也查得到。
 */
const { db, _, COL } = require('./db.js')
const clock = require('./clock.js')
const { bizError } = require('./errors.js')

/* ------------------------------ 钱包读写 ------------------------------ */

async function readWallet(openid) {
  try {
    const res = await db.collection(COL.wallets).doc(openid).get()
    if (res && res.data) return res.data
  } catch (e) {
    // 不存在（或集合还没建）
  }
  return null
}

async function sumLogs(openid) {
  try {
    const res = await db.collection(COL.hearts).where({ openid: openid }).limit(1000).get()
    return res.data.reduce(function (s, l) {
      return s + (l.delta || 0)
    }, 0)
  } catch (e) {
    return 0
  }
}

/**
 * 拿钱包；没有就按流水重算建一个（惰性迁移）
 *
 * 这就是"无损迁移"的实现：不用跑脚本、不用平分，
 * 因为每一笔流水本来就记了 openid，重算即等于实际所得。
 */
async function ensureWallet(openid, coupleId) {
  const exist = await readWallet(openid)
  if (exist) return exist

  const balance = await sumLogs(openid)
  const wallet = {
    openid: openid,
    coupleId: coupleId || '',
    balance: balance,
    updatedAt: Date.now()
  }

  try {
    await db.collection(COL.wallets).doc(openid).set({ data: wallet })
  } catch (e) {
    console.error('[ledger] 建钱包失败', openid, e)
  }
  return wallet
}

async function balanceOf(openid, coupleId) {
  const w = await ensureWallet(openid, coupleId)
  return (w && w.balance) || 0
}

/* ------------------------------ 记账 ------------------------------ */

/**
 * 记一笔账
 * ctx: { openid, coupleId }
 * entries: [{ delta, reason, refId?, idemKey? }]
 * 返回：本次实际变动（重复的 idemKey 会被跳过，可能是 0）
 */
async function apply(ctx, entries, extra) {
  const items = entries || []
  if (!items.length) return 0

  const now = (extra && extra.now) || Date.now()
  const dateKey = (extra && extra.dateKey) || clock.dateKey(now)
  const module = (extra && extra.module) || ''

  const wallet = await ensureWallet(ctx.openid, ctx.coupleId)
  let total = 0

  for (const e of items) {
    if (e.idemKey) {
      const dup = await db
        .collection(COL.hearts)
        .where({ openid: ctx.openid, idemKey: e.idemKey })
        .count()
      if (dup.total > 0) continue
    }

    total += e.delta
    await db.collection(COL.hearts).add({
      data: {
        openid: ctx.openid,
        coupleId: ctx.coupleId,
        date: dateKey,
        at: now,
        delta: e.delta,
        reason: e.reason,
        module: module,
        refId: e.refId || '',
        idemKey: e.idemKey || ''
      }
    })
  }

  if (!total) return 0

  const after = (wallet.balance || 0) + total
  if (after < 0) throw bizError('INSUFFICIENT', '爱心不够啦')

  try {
    await db.collection(COL.wallets).doc(ctx.openid).update({
      data: { balance: _.inc(total), updatedAt: now }
    })
  } catch (e) {
    console.error('[ledger] 钱包写入失败', e)
    throw bizError(
      'LEDGER_BROKEN',
      '爱心账本写入失败：确认云开发里已经建好 core_wallets 集合（权限选「所有用户不可读写」）'
    )
  }

  return total
}

/**
 * 把自己的余额清零（解绑时用）
 * 用反向流水，不直接改 0 —— 保证"余额 = 流水之和"不破裂
 */
async function clearToZero(openid, coupleId, now, dateKey) {
  const balance = await balanceOf(openid, coupleId)
  if (!balance) return 0

  return apply(
    { openid: openid, coupleId: coupleId },
    [
      {
        delta: -balance,
        reason: '解除绑定清零',
        idemKey: 'unbind:' + coupleId + ':' + openid
      }
    ],
    { now: now, dateKey: dateKey, module: 'core' }
  )
}

/** 对账：钱包余额 vs 流水之和 */
async function verify(openid, coupleId) {
  const wallet = await ensureWallet(openid, coupleId)
  const sum = await sumLogs(openid)
  return { openid: openid, wallet: (wallet && wallet.balance) || 0, ledger: sum, ok: ((wallet && wallet.balance) || 0) === sum }
}

/* ------------------------------ 明细 ------------------------------ */

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
      .sort(function (a, b) {
        return (b.at || 0) - (a.at || 0)
      })
      .slice(0, 50)
      .map(function (l) {
        return { date: l.date, at: l.at, delta: l.delta, reason: l.reason }
      })

    return { logs: logs, warn: '' }
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

module.exports = {
  ensureWallet: ensureWallet,
  balanceOf: balanceOf,
  apply: apply,
  clearToZero: clearToZero,
  verify: verify,
  history: history
}
