var api = require('../../core/api.js')

module.exports = {
  summary: function () {
    return api.call('checkin.summary')
  },

  detail: function () {
    return api.call('checkin.detail')
  },

  history: function (month) {
    return api.call('checkin.history', { month: month })
  },

  act: function (type) {
    return api.call('checkin.act', { type: type })
  },

  // 缺卡申诉：生成工单给对象审批
  appeal: function (dayKey, type, reason) {
    return api.call('checkin.appeal', { dayKey: dayKey, type: type, reason: reason })
  },

  // 发起"改规则"申请（不会直接生效）
  proposeConfig: function (config) {
    return api.call('checkin.proposeConfig', { config: config })
  }
}
