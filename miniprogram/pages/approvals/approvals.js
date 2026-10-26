var session = require('../../core/session.js')

var STATUS_TEXT = {
  pending: '等对方处理',
  approved: '已同意',
  rejected: '已拒绝',
  expired: '已过期'
}

Page({
  data: {
    ready: false,
    toMe: [],
    mine: [],
    error: '',
    busy: false
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
    return session.listApprovals().then(function (r) {
      if (!r || !r.ok) {
        self.setData({ ready: false, error: (r && r.message) || '加载失败' })
        return
      }
      self.setData({
        ready: true,
        error: '',
        toMe: self.decorate(r.toMe),
        mine: self.decorate(r.mine)
      })
    })
  },

  decorate: function (list) {
    return (list || []).map(function (t) {
      return Object.assign({}, t, {
        statusText: STATUS_TEXT[t.status] || t.status,
        timeText: t.createdAt ? new Date(t.createdAt).toISOString().slice(5, 16).replace('T', ' ') : ''
      })
    })
  },

  decide: function (e) {
    var self = this
    var id = e.currentTarget.dataset.id
    var approve = e.currentTarget.dataset.approve === '1'
    if (this.data.busy) return

    wx.showModal({
      title: approve ? '同意这张申请？' : '拒绝这张申请？',
      content: approve ? '同意后会按规则执行相应操作。' : '拒绝后扣分/改动都不会生效。',
      confirmText: approve ? '同意' : '拒绝',
      confirmColor: approve ? '#2FAE8B' : '#FF5C77',
      success: function (res) {
        if (!res.confirm) return
        self.setData({ busy: true })
        session.decideApproval(id, approve).then(function (r) {
          self.setData({ busy: false })
          if (!r || !r.ok) {
            wx.showToast({ title: (r && r.message) || '处理失败', icon: 'none' })
            return
          }
          wx.showToast({ title: approve ? '已同意' : '已拒绝', icon: 'success' })
          self.load()
        })
      }
    })
  }
})
