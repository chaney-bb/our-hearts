/**
 * 把 shared/ 里的"共享源码"同步成各处可运行的文件
 *
 * 用法：node scripts/sync-rules.mjs（或者双击项目根目录的「同步规则.bat」）
 *
 * 为什么需要同步：
 *   小程序的代码包只能包含 miniprogram/ 目录，云函数部署时只会打包它自己的目录，
 *   两边都引用不到仓库根目录的 shared/。所以 shared/ 是唯一真相，其余都是生成物。
 *
 * 改规则只改 shared/checkin-rules.js，改时间工具只改 shared/clock.js。
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// 每个目标 = 源文件 + 输出位置 + （可选）clock 的相对路径
const TARGETS = [
  {
    from: 'shared/clock.js',
    to: 'miniprogram/utils/clock.js'
  },
  {
    from: 'shared/checkin-rules.js',
    to: 'miniprogram/utils/rules.js',
    clock: './clock.js'
  },
  {
    from: 'shared/clock.js',
    to: 'cloudfunctions/api/core/clock.js'
  },
  {
    from: 'shared/checkin-rules.js',
    to: 'cloudfunctions/api/modules/checkin/rules.js',
    clock: '../../core/clock.js'
  }
]

function banner(fromPath) {
  return `/* ============================================================
 * 【自动生成，请勿手改】
 * 源文件：${fromPath}
 * 同步命令：node scripts/sync-rules.mjs
 * ============================================================ */

`
}

let count = 0

for (const t of TARGETS) {
  let code = await readFile(path.join(root, t.from), 'utf8')

  if (t.clock) {
    if (code.indexOf('@@CLOCK@@') < 0) {
      throw new Error(t.from + ' 里没有找到 @@CLOCK@@ 占位符，无法生成 clock 引用')
    }
    code = code.replace("'@@CLOCK@@'", JSON.stringify(t.clock))
  }

  const out = path.join(root, t.to)
  await mkdir(path.dirname(out), { recursive: true })
  await writeFile(out, banner(t.from) + code, 'utf8')

  console.log('  ✅ ' + t.from + '  ->  ' + t.to)
  count++
}

console.log('\n同步完成，共 ' + count + ' 个文件。')
console.log('⚠️  如果改的是规则：还要在开发者工具里右键 cloudfunctions/api → 上传并部署')
