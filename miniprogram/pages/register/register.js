var session = require('../../core/session.js')
var app = getApp()

var EMOJIS = ['🐰', '🐻', '🐱', '🐶', '🦊', '🐼', '🐨', '🐯', '🦄', '🐷']
var GENDERS = [
  { value: 'female', label: '女' },
  { value: 'male', label: '男' },
  { value: 'other', label: '其他' }
]

Page({
  data: {
    navTop: 24,
    isEdit: false,
    emojis: EMOJIS,
    genders: GENDERS,
    form: {
      userId: '',
      realName: '',
      phone: '',
      birthday: '',
      gender: '',
      bio: '',
      avatarEmoji: '🐰'
    },
    today: '',
    submitting: false,
    error: ''
  },

  onLoad: function (options) {
    var self = this
    var d = new Date()
    var today = d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2)
    var isEdit = !!(options && options.mode === 'edit')

    this.setData({ navTop: app.globalData.navTop, today: today, isEdit: isEdit })

    // 编辑模式：先把现有资料填进去
    if (isEdit) {
      session.get().then(function (s) {
        if (!s || !s.ok || !s.me) return
        self.setData({
          form: {
            userId: s.me.userId || '',
            realName: s.me.realName || '',
            phone: s.me.phone || '',
            birthday: s.me.birthday || '',
            gender: s.me.gender || '',
            bio: s.me.bio || '',
            avatarEmoji: s.me.avatarEmoji || '🐰'
          }
        })
      })
    }
  },

  goBack: function () {
    wx.navigateBack({
      fail: function () {
        wx.switchTab({ url: '/pages/home/home' })
      }
    })
  },

  onInput: function (e) {
    var key = e.currentTarget.dataset.key
    var form = Object.assign({}, this.data.form)
    form[key] = e.detail.value
    this.setData({ form: form })
  },

  pickEmoji: function (e) {
    var form = Object.assign({}, this.data.form)
    form.avatarEmoji = e.currentTarget.dataset.emoji
    this.setData({ form: form })
  },

  pickGender: function (e) {
    var form = Object.assign({}, this.data.form)
    form.gender = e.currentTarget.dataset.value
    this.setData({ form: form })
  },

  pickBirthday: function (e) {
    var form = Object.assign({}, this.data.form)
    form.birthday = e.detail.value
    this.setData({ form: form })
  },

  submit: function () {
    var self = this
    if (this.data.submitting) return

    var f = this.data.form
    var miss = ''
    if (!f.userId) miss = '用户 ID'
    else if (!f.realName) miss = '真实姓名'
    else if (!f.phone) miss = '手机号'
    else if (!f.birthday) miss = '生日'
    else if (!f.gender) miss = '性别'
    if (miss) {
      wx.showToast({ title: '还差：' + miss, icon: 'none' })
      return
    }

    this.setData({ submitting: true, error: '' })
    var job = this.data.isEdit ? session.updateProfile(f) : session.register(f)
    job.then(function (res) {
      self.setData({ submitting: false })
      if (!res || !res.ok) {
        self.setData({ error: (res && res.message) || '提交失败' })
        return
      }
      wx.showToast({ title: self.data.isEdit ? '改好了' : '登记好了', icon: 'success' })
      setTimeout(function () {
        wx.navigateBack({
          fail: function () {
            wx.switchTab({ url: '/pages/home/home' })
          }
        })
      }, 600)
    })
  }
})
