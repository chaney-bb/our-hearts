/**
 * 生成设计预览（HTML 近似稿）
 *
 * 用法：node design/build-preview.mjs
 * 产物：design/preview.html
 *
 * 说明：这不是小程序运行结果，而是把真实的 WXSS 转成浏览器能看的 CSS
 *      （1rpx = 0.5px @ 375px 宽），配上和 WXML 一样的结构，用来看视觉。
 *      小程序里跑起来的样子和这个 95% 一致。
 */
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFile(path.join(root, p), 'utf8')

// rpx -> px（按 375px 宽的屏幕）
function rpx2px(css) {
  return css.replace(/(-?\d*\.?\d+)rpx/g, (_, n) => Number(n) / 2 + 'px')
}

// 给每个选择器加上作用域前缀，两个页面的样式放一起也不打架
function scope(css, prefix) {
  css = css.replace(/\/\*[\s\S]*?\*\//g, '')

  // 先保住 @keyframes，别被拆分逻辑搞坏
  const keyframes = []
  css = css.replace(/@keyframes[\s\S]*?\{[\s\S]*?\n\}/g, (m) => {
    keyframes.push(m)
    return '@@KF' + (keyframes.length - 1) + '@@'
  })

  let out = ''
  const re = /([^{}]+)\{([^{}]*)\}/g
  let m
  while ((m = re.exec(css))) {
    const sels = m[1].trim()
    const body = m[2]
    if (!sels) continue
    const scoped = sels
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => (s === 'page' ? prefix : prefix + ' ' + s))
      .join(', ')
    out += scoped + '{' + body + '}\n'
  }

  out = out.replace(/@@KF(\d+)@@/g, (_, i) => keyframes[Number(i)])
  return out
}

const base = `
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 44px 40px 40px;
    background: #EDE3DF;
    font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
    display: flex; align-items: stretch; justify-content: center; gap: 48px;
  }
  .frame {
    width: 375px; flex: 0 0 375px;
    border-radius: 28px; overflow: hidden;
    background: #FFF7F3;
    box-shadow: 0 30px 60px rgba(90, 60, 55, 0.18);
    position: relative;
    display: flex; flex-direction: column;
  }
  #p-home .body, #p-hist .body { flex: 1; }
  .frame-label {
    position: absolute; top: -28px; left: 0; right: 0;
    text-align: center; font-size: 12px; color: #A08B87; letter-spacing: 1px;
  }
  .tabbar {
    display: flex; background: #fff; border-top: 1px solid #F6EAE5;
  }
  .tab {
    flex: 1; text-align: center; padding: 10px 0 14px;
    font-size: 11px; color: #B9A5A0;
  }
  .tab.active { color: #FF6B81; font-weight: 600; }
`

const homeMarkup = `
<div class="frame" id="p-home">
  <div class="frame-label">首页 / 打卡</div>

  <div class="hero" style="padding-top:44px">
    <div class="blob blob-a"></div>
    <div class="blob blob-b"></div>
    <div class="hero-top">
      <div class="days-chip">在一起第 57 天</div>
      <div class="avatars">
        <div class="av">🐰</div>
        <div class="av av-2">🐻</div>
      </div>
    </div>
    <div class="hearts-row">
      <span class="heart-ico">❤️</span>
      <span class="heart-num">128</span>
      <span class="heart-unit">爱心</span>
    </div>
    <div class="streak-row">
      <div class="streak-chip">🔥 连续 12 天全勤</div>
      <div class="clock">22:14</div>
    </div>
  </div>

  <div class="body">
    <div class="section-head">
      <span class="section-title">今天的打卡</span>
      <span class="section-sub">2026-10-26</span>
    </div>

    <div class="check-card is-done">
      <div class="emoji-wrap sleep">🌙</div>
      <div class="card-main">
        <div class="card-title">早睡</div>
        <div class="card-meta">21:30 – 23:59</div>
        <div class="card-hint done">22:07 已完成</div>
      </div>
      <div class="btn is-done">已完成</div>
    </div>

    <div class="check-card is-open">
      <div class="emoji-wrap wake">☀️</div>
      <div class="card-main">
        <div class="card-title">早起</div>
        <div class="card-meta">05:30 – 08:00</div>
        <div class="card-hint">05:30 开始，还有 7 小时 16 分</div>
      </div>
      <div class="btn is-disabled">未开放</div>
    </div>

    <div class="card partner-card">
      <div class="partner-av">🐻</div>
      <div class="partner-main">
        <div class="partner-name">亲爱的</div>
        <div class="partner-sub">今天也和你一起坚持 ❤️</div>
      </div>
      <div class="partner-tag">已配对</div>
    </div>

    <div class="card week-card">
      <div class="week-head">
        <span class="week-title">最近 7 天</span>
        <span class="tip">满勤 5 天</span>
      </div>
      <div class="week-dots">
        <div class="week-dot on"><div class="dot-mark">❤️</div><div class="dot-day">10/20</div></div>
        <div class="week-dot on"><div class="dot-mark">❤️</div><div class="dot-day">10/21</div></div>
        <div class="week-dot"><div class="dot-mark">·</div><div class="dot-day">10/22</div></div>
        <div class="week-dot on"><div class="dot-mark">❤️</div><div class="dot-day">10/23</div></div>
        <div class="week-dot on"><div class="dot-mark">❤️</div><div class="dot-day">10/24</div></div>
        <div class="week-dot on"><div class="dot-mark">❤️</div><div class="dot-day">10/25</div></div>
        <div class="week-dot"><div class="dot-mark">·</div><div class="dot-day">10/26</div></div>
      </div>
    </div>

    <div class="card rules-card">
      <div class="rules-title">爱心怎么来</div>
      <div class="rule-line"><span>🌙 早睡打卡</span><span class="plus">+1</span></div>
      <div class="rule-line"><span>☀️ 早起打卡</span><span class="plus">+1</span></div>
      <div class="rule-line"><span>✨ 当天两项都完成</span><span class="plus">+1</span></div>
      <div class="rule-line"><span>💞 两人同一天都完成同一项</span><span class="plus">+1</span></div>
      <div class="rule-line"><span>🔥 连续 7 天 / 30 天全勤</span><span class="plus">+10 / +50</span></div>
      <div class="rule-note">时间窗口：早睡 21:30–23:59，早起 05:30–08:00（按服务器时间判定）</div>
    </div>

    <div class="safe-bottom"></div>
  </div>

  <div class="tabbar"><div class="tab active">打卡</div><div class="tab">记录</div></div>
</div>
`

const cells = (() => {
  // 2026-10-01 是周四，周一为一周第一天 -> 前面空 3 格
  const lead = 3
  const out = []
  for (let i = 0; i < lead; i++) out.push('<div class="cal-cell"></div>')
  for (let d = 1; d <= 31; d++) {
    const full = [1, 2, 3, 5, 6, 7, 8, 9, 10, 12, 13, 14, 15, 16, 17, 19, 20, 21, 23, 24, 25].includes(d)
    const sleep = full || [4, 11, 18].includes(d)
    const wake = full || [4, 11, 18].includes(d)
    const today = d === 26
    out.push(
      '<div class="cal-cell">' +
        '<div class="cell-day ' + (today ? 'is-today' : '') + ' ' + (full ? 'is-full' : '') + '">' + d + '</div>' +
        '<div class="cell-dots">' +
        '<div class="dot sleep ' + (sleep ? 'on' : '') + '"></div>' +
        '<div class="dot wake ' + (wake ? 'on' : '') + '"></div>' +
        '</div></div>'
    )
  }
  while (out.length % 7 !== 0) out.push('<div class="cal-cell"></div>')
  return out.join('')
})()

const historyMarkup = `
<div class="frame" id="p-hist">
  <div class="frame-label">记录</div>

  <div class="topbar" style="padding-top:44px">
    <div class="topbar-title">我们的记录</div>
    <div class="topbar-sub">2026 年 10 月</div>
  </div>

  <div class="body">
    <div class="stat-row">
      <div class="stat-card"><div class="stat-num">21</div><div class="stat-label">本月全勤</div></div>
      <div class="stat-card"><div class="stat-num">12</div><div class="stat-label">最长连续</div></div>
      <div class="stat-card"><div class="stat-num heart">128</div><div class="stat-label">爱心余额</div></div>
    </div>

    <div class="card cal-card">
      <div class="cal-head">
        <div class="cal-nav">‹</div>
        <div class="cal-title">2026 年 10 月</div>
        <div class="cal-nav is-off">›</div>
      </div>
      <div class="cal-week">
        <div class="cal-week-cell">一</div><div class="cal-week-cell">二</div><div class="cal-week-cell">三</div>
        <div class="cal-week-cell">四</div><div class="cal-week-cell">五</div><div class="cal-week-cell">六</div>
        <div class="cal-week-cell">日</div>
      </div>
      <div class="cal-grid">${cells}</div>
      <div class="cal-legend">
        <div class="legend-item"><div class="dot sleep on"></div><span>早睡</span></div>
        <div class="legend-item"><div class="dot wake on"></div><span>早起</span></div>
        <div class="legend-item"><div class="dot is-full-legend"></div><span>全勤</span></div>
      </div>
    </div>

    <div class="section-head">
      <span class="section-title">爱心明细</span>
      <span class="tip">最近的变动</span>
    </div>

    <div class="card log-card">
      <div class="log-line">
        <div class="log-main"><div class="log-reason">早睡打卡</div><div class="log-time">2026-10-26 22:07</div></div>
        <div class="log-delta">+1</div>
      </div>
      <div class="log-line">
        <div class="log-main"><div class="log-reason">今日全勤</div><div class="log-time">2026-10-26 22:07</div></div>
        <div class="log-delta">+1</div>
      </div>
      <div class="log-line">
        <div class="log-main"><div class="log-reason">同步打卡</div><div class="log-time">2026-10-26 22:07</div></div>
        <div class="log-delta">+1</div>
      </div>
      <div class="log-line">
        <div class="log-main"><div class="log-reason">早起打卡</div><div class="log-time">2026-10-26 06:42</div></div>
        <div class="log-delta">+1</div>
      </div>
      <div class="log-line">
        <div class="log-main"><div class="log-reason">连续 7 天全勤</div><div class="log-time">2026-10-20 23:02</div></div>
        <div class="log-delta">+10</div>
      </div>
    </div>

    <div class="safe-bottom"></div>
  </div>

  <div class="tabbar"><div class="tab">打卡</div><div class="tab active">记录</div></div>
</div>
`

const [appCss, homeCss, histCss] = await Promise.all([
  read('miniprogram/app.wxss'),
  read('miniprogram/pages/home/home.wxss'),
  read('miniprogram/pages/history/history.wxss')
])

const css =
  rpx2px(scope(appCss, '#p-home')) +
  rpx2px(scope(appCss, '#p-hist')) +
  rpx2px(scope(homeCss, '#p-home')) +
  rpx2px(scope(histCss, '#p-hist'))

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>我们的小心动 · 设计预览</title>
<style>${base}${css}</style>
</head>
<body>
${homeMarkup}
${historyMarkup}
</body>
</html>
`

await writeFile(path.join(root, 'design', 'preview.html'), html, 'utf8')
console.log('✅ 已生成 design/preview.html')
