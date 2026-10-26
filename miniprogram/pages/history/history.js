var api = require('../../utils/api.js')
var rules = require('../../utils/rules.js')
var app = getApp()

var WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']

Page({
  data: {
    ready: false,
    navTop: 24,
    mode: 'mock',
    month: '',
    monthLabel: '',
    canNext: false,
    weekdays: WEEKDAYS,
    cells: [],
    stats: { fullCount: 0, bestStreak: 0 },
    hearts: 0,
    logs: [],
    error: '',
    errorRaw: '',
    warn: ''
  },

  onLoad: function () {
    this.setData({ navTop: app.globalData.navTop, month: rules.monthKey(Date.now()) })
  },

  onShow: function () {
    this.load()
  },

  onPullDownRefresh: function () {
    this.load().then(function () {
      wx.stopPullDownRefresh()
    })
  },

  load: function () {
    var self = this
    var month = this.data.month || rules.monthKey(Date.now())

    return api.call('history', { month: month }).then(function (res) {
      if (!res || !res.ok) {
        self.setData({
          error: (res && res.message) || '加载失败，原因不明',
          errorRaw: (res && (res.detail || res.raw)) || ''
        })
        return
      }

      var cells = self.buildCells(month, res.days || {})
      var arr = month.split('-')
      var currentMonth = rules.monthKey(Date.now())

      self.setData({
        ready: true,
        error: '',
        errorRaw: '',
        warn: res.warn || '',
        mode: res.mode || 'mock',
        month: month,
        monthLabel: arr[0] + ' 年 ' + Number(arr[1]) + ' 月',
        canNext: month < currentMonth,
        cells: cells,
        stats: res.stats || { fullCount: 0, bestStreak: 0 },
        hearts: res.hearts || 0,
        logs: (res.logs || []).map(function (l, i) {
          return {
            id: i,
            date: l.date,
            time: rules.timeKey(l.at),
            delta: l.delta,
            reason: l.reason
          }
        })
      })
    })
  },

  buildCells: function (month, days) {
    var arr = month.split('-')
    var y = Number(arr[0])
    var m = Number(arr[1])
    var total = new Date(Date.UTC(y, m, 0)).getUTCDate()
    var firstDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay()
    var lead = (firstDow + 6) % 7 // 周一为一周第一天
    var todayKey = rules.dateKey(Date.now())
    var cells = []
    var i, d, key, r

    for (i = 0; i < lead; i++) cells.push({ blank: true, id: 'lead-' + i })

    for (d = 1; d <= total; d++) {
      key = y + '-' + rules.pad2(m) + '-' + rules.pad2(d)
      r = days[key] || {}
      cells.push({
        blank: false,
        id: key,
        day: d,
        sleep: !!r.sleep,
        wake: !!r.wake,
        full: !!(r.sleep && r.wake),
        isToday: key === todayKey
      })
    }

    while (cells.length % 7 !== 0) cells.push({ blank: true, id: 'tail-' + cells.length })

    return cells
  },

  prevMonth: function () {
    var arr = this.data.month.split('-')
    var y = Number(arr[0])
    var m = Number(arr[1]) - 1
    if (m < 1) {
      m = 12
      y = y - 1
    }
    this.setData({ month: y + '-' + rules.pad2(m) })
    this.load()
  },

  nextMonth: function () {
    if (!this.data.canNext) return
    var arr = this.data.month.split('-')
    var y = Number(arr[0])
    var m = Number(arr[1]) + 1
    if (m > 12) {
      m = 1
      y = y + 1
    }
    this.setData({ month: y + '-' + rules.pad2(m) })
    this.load()
  }
})
