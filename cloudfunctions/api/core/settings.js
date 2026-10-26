/**
 * 内核 · 规则配置合并
 *
 * 结构：模块声明的 defaults（代码里的兜底） + core_settings 里用户的覆盖
 *      = 合并后的 config（唯一生效版本）
 *
 * P1a 阶段：表还没建，读不到就返回默认值，所以行为完全不变。
 * P3 阶段：设置页写入 core_settings，服务端把合并结果随响应下发，前端照着渲染。
 */
const { db, COL } = require('./db.js')

/** 只接受默认值里出现过的键；数组整体替换（比如 tiers 换一整套） */
function deepMerge(base, patch) {
  if (Array.isArray(patch)) return patch.slice()
  if (!base || typeof base !== 'object') return patch
  if (!patch || typeof patch !== 'object') return base

  const out = Array.isArray(base) ? base.slice() : Object.assign({}, base)

  Object.keys(patch).forEach((k) => {
    if (!(k in base)) return
    const bv = base[k]
    const pv = patch[k]
    if (bv && typeof bv === 'object' && !Array.isArray(bv) && pv && typeof pv === 'object') {
      out[k] = deepMerge(bv, pv)
    } else {
      out[k] = pv
    }
  })

  return out
}

async function load(coupleId, mod) {
  const defaults = mod.defaults || {}
  if (!coupleId || !mod.key) return defaults

  try {
    const res = await db.collection(COL.settings).where({ coupleId: coupleId, module: mod.key }).limit(1).get()
    if (!res.data.length) return defaults
    return deepMerge(defaults, res.data[0].patch || {})
  } catch (e) {
    // 集合还没建 / 权限不足：用默认值，不影响功能
    return defaults
  }
}

/**
 * 保存某个模块的完整规则快照（只在"对方同意修改规则"时被调用）
 *
 * 存的是**完整快照**而不是差异，好处是"同意后规则长什么样"完全可预期，
 * 也不会因为我以后改默认值而悄悄影响你们已配置的东西。
 * history 保留最近 20 次，给"结算按当日生效版本"留口子。
 */
async function save(coupleId, moduleKey, patch) {
  const now = Date.now()
  let docId = coupleId + ':' + moduleKey

  let prev = null
  try {
    // 先按 (coupleId, module) 找已有文档：兼容历史上用自动 _id 建的记录
    const res = await db
      .collection(COL.settings)
      .where({ coupleId: coupleId, module: moduleKey })
      .limit(1)
      .get()
    if (res.data.length) {
      prev = res.data[0]
      docId = prev._id
    }
  } catch (e) {
    prev = null
  }

  if (!prev) {
    try {
      const res = await db.collection(COL.settings).doc(docId).get()
      prev = res && res.data ? res.data : null
    } catch (e) {
      prev = null
    }
  }

  const history = ((prev && prev.history) || []).concat([{ at: now, patch: patch }]).slice(-20)
  const data = {
    coupleId: coupleId,
    module: moduleKey,
    patch: patch,
    history: history,
    updatedAt: now
  }

  try {
    await db.collection(COL.settings).doc(docId).set({ data: data })
  } catch (e) {
    console.error('[settings] 保存失败', e)
    throw e
  }

  return data
}

/** 某个时间点生效的规则（取 history 里 <= ts 的最新一版） */
async function configAt(coupleId, mod, ts) {
  const defaults = mod.defaults || {}
  if (!coupleId || !mod.key) return defaults

  try {
    const res = await db.collection(COL.settings).where({ coupleId: coupleId, module: mod.key }).limit(1).get()
    if (!res.data.length) return defaults

    const doc = res.data[0]
    const hist = doc.history || []
    let pick = null
    hist.forEach((h) => {
      if (h.at <= ts) pick = h
    })
    if (!pick) return deepMerge(defaults, doc.patch || {})
    return deepMerge(defaults, pick.patch || {})
  } catch (e) {
    return defaults
  }
}

module.exports = { load: load, save: save, configAt: configAt, deepMerge: deepMerge }
