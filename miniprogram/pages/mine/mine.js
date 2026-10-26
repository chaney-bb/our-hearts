var api = require('../../core/api.js')
var session = require('../../core/session.js')

var GENDER_TEXT = { male: '男', female: '女', other: '其他' }

Page({
  data: {
    ready: false,
    mode: 'mock',
    needRegister: false,
    me: null,
    partner: null,
    bound: false,
    inviteCode: '',
    daysTogether: 1,
    labels: { realName: '姓名', phone: '手机号', birthday: '生日', gender: '性别', bio: '自我介绍' },
    genderText: '',
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
    return session.get().then(function (s) {
      if (!s || !s.ok) {
        self.setData({ ready: false, error: (s && s.message) || '加载失败' })
        return
      }
      self.setData({
        ready: true,
        error: '',
        mode: api.getMode(),
        needRegister: s.needRegister,
        me: s.me,
        partner: s.partner,
        bound: s.bound,
        inviteCode: s.inviteCode,
        daysTogether: s.daysTogether,
        genderText: GENDER_TEXT[s.me && s.me.gender] || '未填'
      })
    })
  },

  editProfile: function () {
    wx.navigateTo({ url: '/pages/register/register?mode=edit' })
  },

  gotoRegister: function () {
    wx.navigateTo({ url: '/pages/register/register' })
  },

  copyCode: function () {
    wx.setClipboardData({ data: this.data.inviteCode })
  },

  verify: function () {
    session.verify().then(function (r) {
      if (!r || !r.ok) {
        wx.showModal({ title: '对账失败', content: (r && r.message) || '请求没成功', showCancel: false })
        return
      }
      wx.showModal({
        title: r.wallet === r.ledger ? '账是对的 ✅' : '账对不上 ⚠️',
        content: '钱包余额：' + r.wallet + '\n流水合计：' + r.ledger,
        showCancel: false
      })
    })
  },

  onUnbind: function () {
    var self = this
    if (!this.data.bound) {
      wx.showToast({ title: '现在没有绑定关系', icon: 'none' })
      return
    }
    wx.showModal({
      title: '解除绑定',
      content: '解绑后两个人都会回到"未配对"，爱心清零，打卡记录封存（不会删）。确定吗？',
      confirmText: '继续',
      confirmColor: '#FF5C77',
      success: function (res) {
        if (!res.confirm) return
        wx.showModal({
          title: '再确认一次',
          content: '这个操作不可撤销。真的很确定吗？',
          confirmText: '确定解绑',
          confirmColor: '#FF5C77',
          success: function (r2) {
            if (!r2.confirm) return
            session.unbind().then(function (r) {
              if (!r || !r.ok) {
                wx.showToast({ title: (r && r.message) || '解绑失败', icon: 'none' })
                return
              }
              wx.showToast({ title: '已解绑', icon: 'success' })
              self.load()
            })
          }
        })
      }
    })
  }
})
