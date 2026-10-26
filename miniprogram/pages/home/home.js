var api = require('../../core/api.js')
var session = require('../../core/session.js')
var registry = require('../../core/modules.js')
var app = getApp()

Page({
  data: {
    ready: false,
    navTop: 24,
    mode: 'mock',
    needRegister: false,
    needPair: false,
    me: null,
    partner: null,
    bound: false,
    hearts: 0,
    partnerHearts: 0,
    daysTogether: 1,
    inviteCode: '',
    grid: [],
    error: '',
    errorRaw: ''
  },

  onLoad: function () {
    this.setData({ navTop: app.globalData.navTop, mode: app.globalData.mode })
  },

  onShow: function () {
    this.load()
  },

  onPullDownRefresh: function () {
    this.load().then(function () {
      wx.stopPullDownRefresh()
    })
  },

  /**
   * 外壳首页只做三件事：
   *   1. 问内核要会话（我是谁 / 双方余额 / 在一起多少天）
   *   2. 照着注册表渲染宫格
   *   3. 问每个已上线的模块要一句 summary 显示在卡片上
   * 它不认识"打卡"这两个字。
   */
  load: function () {
    var self = this

    return session.get().then(function (s) {
      if (!s || !s.ok) {
        self.fail(s)
        return
      }

      if (s.needRegister) {
        self.setData({ ready: false, needRegister: true, error: '' })
        return
      }

      // 先铺宫格（不管模块能不能用，先把门面画出来）
      var mods = registry.slice().sort(function (a, b) {
        return a.order - b.order
      })
      var grid = mods.map(function (m) {
        return {
          key: m.key,
          name: m.name,
          emoji: m.emoji,
          desc: m.desc,
          color: m.color,
          page: m.page,
          enabled: m.enabled,
          sub: m.enabled ? '' : '待上线'
        }
      })

      self.setData({
        ready: true,
        needRegister: false,
        needPair: s.needPair,
        bound: s.bound,
        me: s.me,
        partner: s.partner,
        hearts: (s.wallet && s.wallet.balance) || 0,
        partnerHearts: (s.partnerWallet && s.partnerWallet.balance) || 0,
        daysTogether: s.daysTogether,
        inviteCode: s.inviteCode,
        mode: api.getMode(),
        grid: grid,
        error: '',
        errorRaw: ''
      })

      // 没配对就不问模块要数据了（门禁会拒）
      if (!s.bound) return

      // 每个已上线模块并行要一句 summary
      var jobs = mods
        .filter(function (m) {
          return m.enabled
        })
        .map(function (m) {
          return api.call(m.key + '.summary').then(
            function (r) {
              return { key: m.key, sub: (r && r.ok && r.sub) || '' }
            },
            function () {
              return { key: m.key, sub: '' }
            }
          )
        })

      return Promise.all(jobs).then(function (arr) {
        var map = {}
        arr.forEach(function (x) {
          map[x.key] = x.sub
        })
        var withSub = grid.map(function (g) {
          if (map[g.key] !== undefined) g.sub = map[g.key]
          return g
        })
        self.setData({ grid: withSub })
      })
    })
  },

  fail: function (res) {
    this.setData({
      ready: false,
      error: (res && res.message) || '加载失败，原因不明',
      errorRaw: (res && (res.detail || res.raw)) || ''
    })
  },

  retry: function () {
    this.setData({ ready: false, error: '', errorRaw: '' })
    this.load()
  },

  useLocal: function () {
    api.forceLocal('用户手动切换到本地模式')
    this.setData({ ready: false, error: '', errorRaw: '', mode: 'mock' })
    this.load()
  },

  gotoRegister: function () {
    wx.navigateTo({ url: '/pages/register/register' })
  },

  openModule: function (e) {
    var item = e.currentTarget.dataset.item
    if (!item) return
    if (!item.enabled) {
      wx.showToast({ title: item.name + ' 还在做，先欠着', icon: 'none' })
      return
    }
    if (this.data.needPair) {
      wx.showToast({ title: '先和 TA 配对才能玩', icon: 'none' })
      return
    }
    wx.navigateTo({ url: item.page })
  },

  copyCode: function () {
    wx.setClipboardData({ data: this.data.inviteCode })
  },

  joinByCode: function () {
    var self = this
    wx.showModal({
      title: '输入 TA 的邀请码',
      editable: true,
      placeholderText: '6 位字母或数字',
      success: function (res) {
        if (!res.confirm || !res.content) return
        var code = String(res.content).trim().toUpperCase()
        if (code.length !== 6) {
          wx.showToast({ title: '邀请码是 6 位哦', icon: 'none' })
          return
        }
        session.bind(code).then(function (r) {
          if (!r || !r.ok) {
            wx.showToast({ title: (r && r.message) || '配对失败', icon: 'none' })
            return
          }
          wx.showToast({ title: '配对成功', icon: 'success' })
          self.load()
        })
      }
    })
  }
})
