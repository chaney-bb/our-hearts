var session = require('../../core/session.js')
var clock = require('../../utils/clock.js')

Page({
  data: {
    ready: false,
    balance: 0,
    logs: [],
    warn: '',
    total: 0,
    error: ''
  },

  onShow: function () {
    this.load()
  },

  onPullDownRefresh: function () {
    var self = this
    this.load().then(function () {
      wx.stopPullDownRefresh()
    })
  },

  load: function () {
    var self = this
    return session.ledger().then(function (r) {
      if (!r || !r.ok) {
        self.setData({ ready: false, error: (r && r.message) || '加载失败' })
        return
      }

      var logs = (r.logs || []).map(function (l, i) {
        return {
          id: i,
          reason: l.reason || '爱心变动',
          delta: l.delta > 0 ? '+' + l.delta : String(l.delta),
          positive: l.delta > 0,
          date: l.date || '',
          time: l.at ? clock.timeKey(l.at) : ''
        }
      })

      self.setData({
        ready: true,
        error: '',
        balance: r.balance || 0,
        logs: logs,
        total: logs.length,
        warn: r.warn || ''
      })
    })
  },

  retry: function () {
    this.setData({ ready: false, error: '' })
    this.load()
  }
})
