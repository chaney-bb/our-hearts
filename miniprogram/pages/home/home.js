var api = require('../../utils/api.js')
var rules = require('../../utils/rules.js')
var app = getApp()

Page({
  data: {
    ready: false,
    navTop: 24,
    mode: 'mock',
    home: null,
    items: [],
    clock: '',
    week: [],
    weekFull: 0,
    todayFull: false,
    float: '',
    floatSub: '',
    error: '',
    errorRaw: ''
  },

  onLoad: function () {
    this.setData({ navTop: app.globalData.navTop, mode: app.globalData.mode })
  },

  onShow: function () {
    this.load()
  },

  onHide: function () {
    this.stopTick()
  },

  onUnload: function () {
    this.stopTick()
  },

  onPullDownRefresh: function () {
    this.load().then(function () {
      wx.stopPullDownRefresh()
    })
  },

  // 拉取首页数据
  load: function () {
    var self = this
    return api.call('home').then(function (res) {
      if (!res || !res.ok) {
        // 出错了也要说清楚原因，不能一直卡在"正在唤醒"
        self.setData({
          ready: false,
          error: (res && res.message) || '加载失败，原因不明',
          errorRaw: (res && res.raw) || ''
        })
        return
      }
      // 用服务器时间校准本机（防止手机时间不准）
      self.offset = res.serverNow - Date.now()
      self.setData({ home: res, ready: true, mode: res.mode || 'mock', error: '', errorRaw: '' })
      self.render()
      self.startTick()
    })
  },

  retry: function () {
    this.setData({ ready: false, error: '', errorRaw: '' })
    this.load()
  },

  // 云开发实在连不上时，先用本地模式把界面用起来
  useLocal: function () {
    api.forceLocal('用户手动切换到本地模式')
    this.setData({ ready: false, error: '', errorRaw: '', mode: 'mock' })
    this.load()
  },

  // 每秒重算一次倒计时和按钮状态
  render: function () {
    var h = this.data.home
    if (!h) return

    var now = Date.now() + (this.offset || 0)
    var today = rules.describeToday(h.today.records, now)

    var week = (h.recent || []).map(function (r) {
      return {
        date: r.date,
        fullDay: r.fullDay,
        dayLabel: r.date.slice(5).replace('-', '/')
      }
    })
    var weekFull = 0
    for (var i = 0; i < week.length; i++) if (week[i].fullDay) weekFull++

    this.setData({
      items: today.items,
      clock: rules.timeKey(now),
      week: week,
      weekFull: weekFull,
      todayFull: today.fullDay
    })
  },

  startTick: function () {
    this.stopTick()
    var self = this
    this.timer = setInterval(function () {
      self.render()
    }, 1000)
  },

  stopTick: function () {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  },

  // 点打卡
  onCheckin: function (e) {
    var self = this
    var type = e.currentTarget.dataset.type
    var item = null
    for (var i = 0; i < this.data.items.length; i++) {
      if (this.data.items[i].key === type) item = this.data.items[i]
    }
    if (!item) return

    if (item.done) {
      wx.showToast({ title: '今天已经打过卡啦', icon: 'none' })
      return
    }
    if (!item.canCheck) {
      wx.showToast({
        title: item.state === 'expired' ? '今天已经过了打卡时间' : '还没到打卡时间哦',
        icon: 'none'
      })
      return
    }
    if (this.busy) return

    this.busy = true
    api.call('checkin', { type: type }).then(function (res) {
      self.busy = false
      if (!res || !res.ok) {
        wx.showToast({ title: (res && res.message) || '打卡失败', icon: 'none' })
        return
      }
      self.offset = res.home.serverNow - Date.now()
      self.setData({ home: res.home })
      self.render()

      var r = res.reward || { delta: 0, reasons: [] }
      self.showFloat(r.delta, r.reasons)
      try {
        wx.vibrateShort({ type: 'light' })
      } catch (err) {}
    })
  },

  // 爱心 +N 飘出来
  showFloat: function (delta, reasons) {
    var self = this
    if (!delta) return
    this.setData({ float: '+' + delta, floatSub: (reasons || []).join(' · ') })
    clearTimeout(this.floatTimer)
    this.floatTimer = setTimeout(function () {
      self.setData({ float: '', floatSub: '' })
    }, 1800)
  },

  copyCode: function () {
    wx.setClipboardData({ data: this.data.home.inviteCode })
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
        api.call('joinCouple', { inviteCode: code }).then(function (r) {
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
