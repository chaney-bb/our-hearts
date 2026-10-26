/**
 * 内核 · 模块注册表（服务端）
 *
 * 加一个新功能 = 写一个 modules/<key>/index.js + 在这里加一行。
 * 注意：这里只登记"已实现"的模块；占坑的模块见 modules/README.md
 */
const checkin = require('../modules/checkin/index.js')

const MODULES = [checkin]

const BY_KEY = {}
MODULES.forEach(function (m) {
  if (!m || !m.key) throw new Error('模块缺少 key')
  if (BY_KEY[m.key]) throw new Error('模块 key 重复：' + m.key)
  BY_KEY[m.key] = m
})

function get(key) {
  return BY_KEY[key] || null
}

function list() {
  return MODULES.slice()
}

module.exports = { get: get, list: list }
