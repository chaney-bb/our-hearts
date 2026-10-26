/**
 * 把小程序端的规则文件同步到云函数
 *
 * 用法（在项目根目录执行）：node scripts/sync-rules.mjs
 *
 * 为什么要有这个脚本：
 *   规则必须在小程序端（算倒计时/按钮状态）和云函数端（真正判定）各有一份，
 *   云函数部署时只会打包它自己目录里的文件，引用不到外面的东西。
 *   为了保证两边永远一致，我们只维护 miniprogram/utils/rules.js，其余靠复制。
 */
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = path.join(root, 'miniprogram', 'utils', 'rules.js')
const target = path.join(root, 'cloudfunctions', 'api', 'rules.js')

const banner = `/* ============================================================
 * 【自动生成，请勿手改】
 * 源文件：miniprogram/utils/rules.js
 * 同步命令：node scripts/sync-rules.mjs
 * ============================================================ */

`

const code = await readFile(source, 'utf8')
await writeFile(target, banner + code, 'utf8')

console.log('✅ 规则已同步 -> cloudfunctions/api/rules.js')
