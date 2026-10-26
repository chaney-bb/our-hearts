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

module.exports = { load: load, deepMerge: deepMerge }
