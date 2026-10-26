var checkinApi = require('../../../modules/checkin/api.js')
var rules = require('../../../utils/rules.js')

Page({
  data: {
    ready: false,
    streak: 0,
    dayLabel: '',
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
    var self = this
    this.load().then(function () {
      wx.stopPullDownRefresh()
    })
  },

  load: function () {
    var self = this
    return checkinApi.detail().then(function (d) {
      if (!d || !d.ok) {
        self.setData({
          ready: false,
          error: (d && d.message) || '加载失败',
          errorRaw: (d && (d.detail || d.raw)) || ''
        })
        return
      }

      self.offset = (d.serverNow || Date.now()) - Date.now()
      self.detail = d
      self.setData({
        ready: true,
        streak: d.streak,
        dayLabel: d.today.date,
        error: '',
        errorRaw: '',
        rulesStale: self.checkStale(d.rules)
      })
      self.render()
      self.startTick()
    })
  },

  checkStale: function (sr) {
    if (!sr || !sr.windows || !sr.windows.sleep || !sr.windows.wake) return ''
    var mine = { windows: rules.RULES.windows, hearts: rules.RULES.hearts }
    if (JSON.stringify(sr) === JSON.stringify(mine)) return ''

    var winDiff = JSON.stringify(sr.windows) !== JSON.stringify(mine.windows)
    if (winDiff) {
      return (
        '云端还在跑旧规则（早睡 ' + sr.windows.sleep.start + ' 开始），你本地已经是 ' +
        mine.windows.sleep.start + '。双击「同步规则.bat」，再右键 cloudfunctions/api 重新部署'
      )
    }
    return '云端的爱心分值和本地不一致，双击「同步规则.bat」并重新部署云函数'
  },

  retry: function () {
    this.setData({ ready: false, error: '', errorRaw: '' })
    this.load()
  },

  render: function () {
    var d = this.detail
    if (!d) return

    var now = Date.now() + (this.offset || 0)
    var today = rules.describeToday(d.today.records, now)

    var week = (d.recent || []).map(function (r) {
      return { date: r.date, fullDay: r.fullDay, dayLabel: r.date.slice(5).replace('-', '/') }
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
      self.detail = Object.assign({}, self.detail, res.detail)
      self.setData({
        streak: self.detail.streak,
        dayLabel: (self.detail.today && self.detail.today.date) || self.data.dayLabel
      })
      self.render()

      var r = res.reward || { delta: 0, reasons: [] }
      self.showFloat(r.delta, r.reasons)
      try {
        wx.vibrateShort({ type: 'light' })
      } catch (err) {}
    })
  },

  showFloat: function (delta, reasons) {
    var self = this
    if (!delta) return
    this.setData({ float: '+' + delta, floatSub: (reasons || []).join(' · ') })
    clearTimeout(this.floatTimer)
    this.floatTimer = setTimeout(function () {
      self.setData({ float: '', floatSub: '' })
    }, 1800)
  },

  goHistory: function () {
    wx.switchTab({ url: '/pages/history/history' })
  }
})
