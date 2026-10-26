/**
 * 内核 · 前端会话
 *
 * 页面要"我是谁、和谁一对、邀请码多少"，都走这里，不要去拼 action 字符串。
 */
var api = require('./api.js')

function get() {
  return api.call('session.get')
}

function bind(inviteCode) {
  return api.call('session.bind', { inviteCode: inviteCode })
}

module.exports = { get: get, bind: bind }
