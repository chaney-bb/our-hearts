/**
 * 生成设计预览（HTML 近似稿）
 *
 * 用法：node design/build-preview.mjs
 * 产物：design/preview.html
 *
 * 说明：这不是小程序运行结果，而是把真实的 WXSS 转成浏览器能看的 CSS
 *      （1rpx = 0.5px @ 375px 宽），配上和 WXML 一样的结构，用来看视觉。
 *      三屏：首页（外壳宫格）/ 打卡页 / 我的。
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

// 给每个选择器加上作用域前缀，多个页面的样式放一起也不打架
function scope(css, prefix) {
  css = css.replace(/\/\*[\s\S]*?\*\//g, '')

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
      .map((s) => (s === 'page' ? prefix : s.startsWith('.') || s.startsWith('#') ? prefix + ' ' + s : prefix + ' ' + s))
      .join(', ')
    out += scoped + '{' + body + '}\n'
  }

  out = out.replace(/@@KF(\d+)@@/g, (_, i) => keyframes[Number(i)])
  return out
}

const base = `
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 44px 32px 40px;
    background: #EDE3DF;
    font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
    display: flex; align-items: flex-start; justify-content: center; gap: 30px;
  }
  .frame {
    width: 375px; flex: 0 0 375px;
    border-radius: 28px; overflow: hidden;
    background: #FFF7F3;
    box-shadow: 0 30px 60px rgba(90, 60, 55, 0.18);
    position: relative;
    display: flex; flex-direction: column;
  }
  .frame-label {
    position: absolute; top: -26px; left: 0; right: 0;
    text-align: center; font-size: 12px; color: #A08B87; letter-spacing: 1px;
  }
  .fakenav {
    height: 44px; display: flex; align-items: center; justify-content: center;
    background: #FFFFFF; font-size: 15px; font-weight: 600; color: #3A2A28;
    border-bottom: 1px solid #F6EAE5; flex: 0 0 44px;
  }
  .tabbar {
    display: flex; background: #fff; border-top: 1px solid #F6EAE5; margin-top: auto;
  }
  .tab {
    flex: 1; text-align: center; padding: 10px 0 14px;
    font-size: 11px; color: #B9A5A0;
  }
  .tab.active { color: #FF6B81; font-weight: 600; }
  #p-home .body, #p-checkin .page, #p-mine .page { flex: 1; }
  #p-checkin .page, #p-mine .page { padding-bottom: 8px; min-height: 0; }
`

const homeMarkup = `
<div class="frame" id="p-home">
  <div class="frame-label">首页（外壳）</div>

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
      <span class="heart-num">86</span>
      <span class="heart-unit">我的爱心</span>
    </div>
    <div class="partner-hearts">
      <span class="ph-emoji">🐻</span>
      <span class="ph-name">小肚肚</span>
      <span class="ph-num">💗 102</span>
    </div>
  </div>

  <div class="body">
    <div class="section-head">
      <span class="section-title">我们的小功能</span>
      <span class="section-sub">加功能只改注册表</span>
    </div>

    <div class="grid">
      <div class="grid-cell">
        <div class="grid-item">
          <div class="gi-emoji pink">🌙</div>
          <div class="gi-name">早睡早起</div>
          <div class="gi-desc">一起睡个好觉</div>
          <div class="gi-sub">今日 1/2 · 连续 12 天</div>
        </div>
      </div>
      <div class="grid-cell">
        <div class="grid-item is-off">
          <div class="gi-emoji blue">🧾</div>
          <div class="gi-name">消费申请</div>
          <div class="gi-desc">花之前先报备</div>
          <div class="gi-sub">待上线</div>
        </div>
      </div>
      <div class="grid-cell">
        <div class="grid-item is-off">
          <div class="gi-emoji orange">🍚</div>
          <div class="gi-name">吃饭点餐</div>
          <div class="gi-desc">今天吃点什么</div>
          <div class="gi-sub">待上线</div>
        </div>
      </div>
      <div class="grid-cell">
        <div class="grid-item is-off" style="opacity:.35">
          <div class="gi-emoji pink">＋</div>
          <div class="gi-name">下一个功能</div>
          <div class="gi-desc">占位</div>
        </div>
      </div>
    </div>

    <div class="mock-tip">本地预览模式：数据只存在这台手机上，不会同步。</div>
    <div class="safe-bottom"></div>
  </div>

  <div class="tabbar">
    <div class="tab active">首页</div>
    <div class="tab">我的</div>
  </div>
</div>
`

// 打卡页日历格子（2026-10 是 10/1 周四 → 前面空 3 格）
const calCells = (() => {
  const out = []
  for (let i = 0; i < 3; i++) out.push('<div class="cal-cell"></div>')
  for (let d = 1; d <= 31; d++) {
    const future = d > 26
    const me = future ? 0 : d % 7 === 0 ? 1 : d % 5 === 0 ? 2 : 3
    const ta = future ? 0 : d % 6 === 0 ? 2 : d % 4 === 0 ? 1 : 3
    out.push(
      '<div class="cal-cell">' +
        '<div class="cal-day ' + (d === 26 ? 'is-today' : '') + '">' + d + '</div>' +
        '<div class="bars">' +
        '<div class="bar me lv' + me + '"></div>' +
        '<div class="bar ta lv' + ta + '"></div>' +
        '</div></div>'
    )
  }
  while (out.length % 7 !== 0) out.push('<div class="cal-cell"></div>')
  return out.join('')
})()

const checkinMarkup = `
<div class="frame" id="p-checkin">
  <div class="frame-label">打卡页（点宫格进来）</div>
  <div class="fakenav">早睡早起</div>

  <div class="page">
    <div class="stat-strip">
      <div class="ss-main">
        <span class="ss-num">🔥 12</span>
        <span class="ss-label">连续全勤天数</span>
      </div>
      <div class="ss-time">22:14</div>
    </div>

    <div class="month-strip">
      <span class="ms-label">本月全勤</span>
      <span class="ms-val">18 / 22</span>
      <span class="more">⋯</span>
    </div>

    <div class="miss-card">
      <div class="miss-main">
        <span class="miss-title">🌙 早睡漏打 · 2026-10-24</span>
        <span class="miss-sub">已扣 1 爱心</span>
      </div>
      <div class="miss-btn">说明一下</div>
    </div>

    <div class="section-head">
      <span class="section-title">这一晚的打卡</span>
      <span class="section-sub">2026-10-26 · 看日历 ›</span>
    </div>

    <div class="check-card is-done">
      <div class="emoji-wrap sleep">🌙</div>
      <div class="card-main">
        <div class="card-title">早睡</div>
        <div class="card-meta">21:30 – 24:00</div>
        <div class="card-hint done">22:07 打卡 +2</div>
      </div>
      <div class="btn is-done">已完成</div>
    </div>

    <div class="check-card is-open">
      <div class="emoji-wrap wake">☀️</div>
      <div class="card-main">
        <div class="card-title">早起</div>
        <div class="card-meta">06:00 – 12:00</div>
        <div class="card-hint open">06:00 开放，还有 7 小时 46 分</div>
      </div>
      <div class="btn is-disabled">未开放</div>
    </div>

    <div class="card cal-card">
      <div class="cal-head">
        <span class="cal-title">2026 年 10 月</span>
        <div class="cal-legend">
          <div class="lg"><div class="bar me lv3"></div><span>我</span></div>
          <div class="lg"><div class="bar ta lv3"></div><span>TA</span></div>
        </div>
      </div>
      <div class="cal-week">
        <div class="cal-week-cell">一</div><div class="cal-week-cell">二</div><div class="cal-week-cell">三</div>
        <div class="cal-week-cell">四</div><div class="cal-week-cell">五</div><div class="cal-week-cell">六</div>
        <div class="cal-week-cell">日</div>
      </div>
      <div class="cal-grid">${calCells}</div>
      <div class="cal-note">实心=打满且有爱心 · 半透=打满但有一项 0 分 · 细线=只打了一项 · 空白=没打</div>
    </div>

    <div class="safe-bottom"></div>
  </div>
</div>
`

const mineMarkup = `
<div class="frame" id="p-mine">
  <div class="frame-label">我的（用户体系收口）</div>
  <div class="fakenav">我的</div>

  <div class="page">
    <div class="card me-card">
      <div class="me-av">🐰</div>
      <div class="me-main">
        <div class="me-name">陈陈</div>
        <div class="me-sub">和小肚肚 在一起第 57 天</div>
      </div>
      <div class="edit">修改</div>
    </div>

    <div class="card info-card">
      <div class="info-line"><span class="info-label">姓名</span><span class="info-value">陈某某</span></div>
      <div class="info-line"><span class="info-label">手机号</span><span class="info-value">13800138000</span></div>
      <div class="info-line"><span class="info-label">生日</span><span class="info-value">1995-01-01</span></div>
      <div class="info-line"><span class="info-label">性别</span><span class="info-value">男</span></div>
      <div class="info-line"><span class="info-label">自我介绍</span><span class="info-value">一个爱睡觉的人</span></div>
    </div>

    <div class="card partner-card">
      <div class="p-av">🐻</div>
      <div class="p-main">
        <div class="p-name">小肚肚</div>
        <div class="p-sub">1996-05-20 · 爱吃甜食</div>
      </div>
      <div class="p-tag">已配对</div>
    </div>

    <div class="actions">
      <div class="action"><span>修改资料</span><span class="arrow">›</span></div>
      <div class="action"><span>爱心明细</span><span class="arrow">›</span></div>
      <div class="action danger"><span>解除绑定</span><span class="arrow">›</span></div>
    </div>

    <div class="foot"><span>当前模式：云开发（两人共享）</span></div>
    <div class="safe-bottom"></div>
  </div>

  <div class="tabbar">
    <div class="tab">首页</div>
    <div class="tab active">我的</div>
  </div>
</div>
`

const [appCss, homeCss, checkinCss, mineCss] = await Promise.all([
  read('miniprogram/app.wxss'),
  read('miniprogram/pages/home/home.wxss'),
  read('miniprogram/pages/m/checkin/index.wxss'),
  read('miniprogram/pages/mine/mine.wxss')
])

const css =
  rpx2px(scope(appCss, '#p-home')) +
  rpx2px(scope(appCss, '#p-checkin')) +
  rpx2px(scope(appCss, '#p-mine')) +
  rpx2px(scope(homeCss, '#p-home')) +
  rpx2px(scope(checkinCss, '#p-checkin')) +
  rpx2px(scope(mineCss, '#p-mine'))

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>我们的小心动 · 设计预览</title>
<style>${base}${css}</style>
</head>
<body>
${homeMarkup}
${checkinMarkup}
${mineMarkup}
</body>
</html>
`

await writeFile(path.join(root, 'design', 'preview.html'), html, 'utf8')
console.log('✅ 已生成 design/preview.html（首页 / 打卡 / 我的）')
