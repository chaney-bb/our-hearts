var api = require('../../core/api.js')
var session = require('../../core/session.js')
var checkinApi = require('../../modules/checkin/api.js')
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
    errorRaw: '',
    rulesStale: ''
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

  // 首页数据 = 内核的"我是谁" + 打卡模块的"今天怎么样"
  // 两个请求并行发出，加新功能时首页会变成更多个 summary 并行，不用改结构
  load: function () {
    var self = this

    return Promise.all([session.get(), checkinApi.detail()]).then(function (arr) {
      var s = arr[0]
      var d = arr[1]
      var bad = !s || !s.ok ? s : !d || !d.ok ? d : null

      if (bad) {
        // 出错了也要说清楚原因，不能一直卡在"正在唤醒"
        self.setData({
          ready: false,
          error: (bad && bad.message) || '加载失败，原因不明',
          errorRaw: (bad && (bad.detail || bad.raw)) || ''
        })
        return
      }

      // 用服务器时间校准本机（防止手机时间不准）
      self.offset = (d.serverNow || s.serverNow || Date.now()) - Date.now()

      self.setData({
        home: {
          me: s.me,
          partner: s.partner,
          bound: s.bound,
          inviteCode: s.inviteCode,
          daysTogether: s.daysTogether,
          hearts: d.hearts,
          streak: d.streak,
          today: d.today,
          recent: d.recent
        },
        ready: true,
        mode: api.getMode(),
        error: '',
        errorRaw: '',
        rulesStale: self.checkStale(d.rules)
      })

      self.render()
      self.startTick()
    })
  },

  // 云端规则和本地规则不一致 -> 说明云函数没重新部署
  checkStale: function (sr) {
    if (!sr || !sr.windows || !sr.windows.sleep || !sr.windows.wake) return ''
    var mine = { windows: rules.RULES.windows, hearts: rules.RULES.hearts }
    if (JSON.stringify(sr) === JSON.stringify(mine)) return ''

    var winDiff = JSON.stringify(sr.windows) !== JSON.stringify(mine.windows)
    if (winDiff) {
      return (
        '云端还在跑旧规则（早睡 ' + sr.windows.sleep.start + ' 开始、早起 ' + sr.windows.wake.start +
        ' 开始），你本地已经改成 ' + mine.windows.sleep.start + ' / ' + mine.windows.wake.start +
        '。双击项目根目录的「同步规则.bat」，再右键 cloudfunctions/api 上传并部署才会生效'
      )
    }
    return (
      '云端的爱心分值和本地不一致（云端：早睡 +' + sr.hearts.sleep + ' 全勤 +' + sr.hearts.fullDay +
      '，本地：早睡 +' + mine.hearts.sleep + ' 全勤 +' + mine.hearts.fullDay +
      '）。双击「同步规则.bat」，再重新部署云函数'
    )
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
    checkinApi.act(type).then(function (res) {
      self.busy = false
      if (!res || !res.ok) {
        wx.showToast({ title: (res && res.message) || '打卡失败', icon: 'none' })
        return
      }
      self.offset = res.serverNow - Date.now()
      self.setData({ home: Object.assign({}, self.data.home, res.detail) })
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
