var checkinApi = require('../../../../modules/checkin/api.js')
var rules = require('../../../../utils/rules.js')

var HOURS = []
for (var h = 0; h < 24; h++) HOURS.push(h + ':00')

function setPath(obj, path, value) {
  var parts = String(path).split('.')
  var o = obj
  for (var i = 0; i < parts.length - 1; i++) o = o[parts[i]]
  o[parts[parts.length - 1]] = value
}

function getPath(obj, path) {
  var parts = String(path).split('.')
  var o = obj
  for (var i = 0; i < parts.length; i++) o = o[parts[i]]
  return o
}

// 只读模式的"规则明细"：把配置翻译成几句人话
function buildSummary(cfg) {
  var fmt = function (t) {
    return (
      t.window.start + '–' + t.window.end + ' · ' +
      t.tiers
        .map(function (x) {
          return x.hearts > 0 ? '+' + x.hearts : '0'
        })
        .join(' / ')
    )
  }
  return [
    { label: '🌙 早睡', value: fmt(cfg.sleep) },
    { label: '☀️ 早起', value: fmt(cfg.wake) },
    { label: '🔥 一个月打满 ' + cfg.monthly.requiredDays + ' 天', value: '+' + cfg.monthly.bonus },
    { label: '😴 漏打', value: '−' + cfg.sleep.missPenalty + ' / −' + cfg.wake.missPenalty },
    { label: '📮 申诉截止', value: cfg.sleep.appealDeadline + ' / ' + cfg.wake.appealDeadline }
  ]
}

function buildTierNote(cfg) {
  var part = function (t) {
    return t.tiers
      .map(function (x) {
        return x.from + '–' + x.to + ' +' + x.hearts
      })
      .join('，')
  }
  return '早睡档位：' + part(cfg.sleep) + '；早起档位：' + part(cfg.wake)
}

Page({
  data: {
    ready: false,
    editable: false,
    submitting: false,
    cfg: null,
    hours: HOURS,
    summaryLines: [],
    tierNote: '',
    error: '',
    errors: []
  },

  onLoad: function (options) {
    this.setData({ editable: !!(options && options.mode === 'edit') })
  },

  onShow: function () {
    this.load()
  },

  load: function () {
    var self = this
    return checkinApi.detail().then(function (d) {
      if (!d || !d.ok) {
        self.setData({ ready: false, error: (d && d.message) || '加载失败' })
        return
      }
      // 防御：万一服务端返回的是旧版规则结构（云函数没重新部署），
      // 用本地默认值兜底，别让页面变成空白
      var cfg = d.config && d.config.sleep && d.config.monthly ? d.config : rules.DEFAULTS

      self.setData({
        ready: true,
        error: '',
        cfg: JSON.parse(JSON.stringify(cfg)),
        summaryLines: buildSummary(cfg),
        tierNote: buildTierNote(cfg)
      })
    })
  },

  // 只读 → 编辑
  goEdit: function () {
    wx.redirectTo({ url: '/pages/m/checkin/rules/index?mode=edit' })
  },

  onTime: function (e) {
    var path = e.currentTarget.dataset.path
    var cfg = this.data.cfg
    setPath(cfg, path, e.detail.value)

    // 保持"档位首尾对齐窗口"
    if (path === 'sleep.window.start' || path === 'wake.window.start') {
      var type = path.split('.')[0]
      cfg[type].tiers[0].from = e.detail.value
    }
    if (path === 'sleep.window.end' || path === 'wake.window.end') {
      var t2 = path.split('.')[0]
      cfg[t2].tiers[cfg[t2].tiers.length - 1].to = e.detail.value
    }
    this.setData({ cfg: cfg })
  },

  onNumber: function (e) {
    var path = e.currentTarget.dataset.path
    var cfg = this.data.cfg
    var v = parseInt(e.detail.value, 10)
    setPath(cfg, path, isNaN(v) ? 0 : v)
    this.setData({ cfg: cfg })
  },

  // 改某一档的结束时间时，下一档的开始跟着走
  onTierTo: function (e) {
    var cfg = this.data.cfg
    var type = e.currentTarget.dataset.type
    var idx = Number(e.currentTarget.dataset.idx)
    var val = e.detail.value

    cfg[type].tiers[idx].to = val
    if (cfg[type].tiers[idx + 1]) cfg[type].tiers[idx + 1].from = val

    this.setData({ cfg: cfg })
  },

  onCutover: function (e) {
    var cfg = this.data.cfg
    cfg.cutoverHour = Number(e.detail.value)
    this.setData({ cfg: cfg })
  },

  submit: function () {
    var self = this
    if (this.data.submitting) return

    var check = rules.validateConfig(this.data.cfg)
    if (!check.ok) {
      this.setData({ errors: check.errors, error: check.errors[0].message })
      return
    }

    this.setData({ submitting: true, error: '', errors: [] })
    checkinApi.proposeConfig(this.data.cfg).then(function (r) {
      self.setData({ submitting: false })
      if (!r || !r.ok) {
        self.setData({ error: (r && r.message) || '提交失败', errors: (r && r.errors) || [] })
        return
      }
      wx.showModal({
        title: '已发送给 TA',
        content: 'TA 同意之后才会生效。生效前还是按现在的规则走。',
        showCancel: false,
        success: function () {
          wx.navigateBack({ fail: function () {} })
        }
      })
    })
  }
})
