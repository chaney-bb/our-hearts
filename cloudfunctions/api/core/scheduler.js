/**
 * 内核 · scheduler 定时任务
 *
 * 云函数没有常驻进程，所以"时间到了要发生的事"（比如漏打卡扣分）
 * 必须靠**定时触发器**来推，或者靠"用户下次打开时补算"。
 *
 * 这里只负责"把所有人叫一遍"，具体扣不扣分由各模块的 settle 决定。
 * 加一个新模块的定时逻辑 = 在模块里实现 actions.settle，这里一行不用改。
 */
const { db, COL } = require('./db.js')
const registry = require('./registry.js')
const context = require('./context.js')

async function runAll(now) {
  const mods = registry.list().filter(function (m) {
    return m.actions && typeof m.actions.settle === 'function'
  })
  if (!mods.length) return { modules: 0, users: 0, results: [] }

  // 找所有"已配对"的关系（两个人的小 app，一次全量扫没问题）
  let couples = []
  try {
    const res = await db.collection(COL.couples).limit(200).get()
    couples = res.data || []
  } catch (e) {
    console.error('[scheduler] 读 couples 失败', e)
    return { modules: mods.length, users: 0, results: [] }
  }

  const active = couples.filter(function (c) {
    const members = c.members || []
    return members.length >= 2 && (!c.status || c.status === 'active')
  })

  const results = []
  let users = 0

  for (const couple of active) {
    for (const openid of couple.members) {
      for (const mod of mods) {
        users++
        try {
          const ctx = await context.create(mod, openid)
          const r = await mod.actions.settle(ctx, {})
          if (r && r.penalized && r.penalized.length) {
            results.push({ openid: openid.slice(-4), module: mod.key, penalized: r.penalized })
          }
        } catch (err) {
          // 门禁（没登记/没配对）之类的，跳过就行
          console.error('[scheduler] settle 跳过', mod.key, String((err && err.message) || err))
        }
      }
    }
  }

  return { modules: mods.length, users: users, results: results, at: now || Date.now() }
}

module.exports = { runAll: runAll }
