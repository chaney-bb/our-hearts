/**
 * 打卡模块 · 前端接口层
 *
 * 页面只调这里，不直接写 'checkin.act' 这种字符串。
 * 以后要换接口名、加缓存、加乐观更新，都只改这个文件。
 */
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
  }
}
