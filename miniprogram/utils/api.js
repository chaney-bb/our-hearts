/**
 * 数据层统一入口：页面只调这里，不关心数据到底存在云上还是本机
 *
 * api.init()          -> 返回 'cloud' 或 'mock'
 * api.call(action, d) -> Promise<结果>
 */
var config = require('./config.js')
var cloud = require('./cloud.js')
var mock = require('./mock.js')

var client = mock
var mode = 'mock'

function init() {
  var envId = String(config.envId || '').trim()

  if (!envId) {
    mode = 'mock'
    client = mock
    return mode
  }

  if (!wx.cloud) {
    console.warn('[未检测到 wx.cloud] 请把小程序基础库调到 2.2.3 以上')
    mode = 'mock'
    client = mock
    return mode
  }

  wx.cloud.init({ env: envId, traceUser: true })
  mode = 'cloud'
  client = cloud
  return mode
}

function call(action, data) {
  return client.call(action, data || {}).catch(function (err) {
    console.error('[数据请求失败]', action, err)
    return { ok: false, code: 'NETWORK', message: '网络不太顺，稍后再试' }
  })
}

module.exports = {
  init: init,
  call: call,
  getMode: function () {
    return mode
  }
}
