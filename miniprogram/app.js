const api = require('./utils/api.js')

App({
  globalData: {
    navTop: 24,   // 自定义导航栏下方内容的起始位置（px）
    mode: 'mock'  // 'mock' = 本地假数据；'cloud' = 连云开发
  },

  onLaunch() {
    this.measureNav()
    // 初始化数据层：填了云开发环境 ID 就走云，否则走本地预览模式
    this.globalData.mode = api.init()
    console.log('[数据模式]', this.globalData.mode === 'cloud' ? '云开发' : '本地预览（数据只存在本机）')
  },

  // 自定义导航栏：算出状态栏 + 胶囊按钮的高度，页面顶部留白用
  measureNav() {
    let statusBar = 20
    try {
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
      statusBar = info.statusBarHeight || 20
    } catch (e) {}
    this.globalData.navTop = statusBar + 12
  }
})
