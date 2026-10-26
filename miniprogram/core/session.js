/**
 * 内核 · 前端会话
 *
 * 页面要"我是谁、和谁一对、双方爱心多少"，都走这里，不要自己拼 action 字符串。
 */
var api = require('./api.js')

module.exports = {
  get: function () {
    return api.call('session.get')
  },

  // 首次登记（6 项）
  register: function (data) {
    return api.call('session.register', { data: data })
  },

  // 任何时候改资料（userId 改了服务端会重新查重）
  updateProfile: function (data) {
    return api.call('session.updateProfile', { data: data })
  },

  bind: function (inviteCode) {
    return api.call('session.bind', { inviteCode: inviteCode })
  },

  // 解绑：页面必须先弹两次确认，到这里 confirm 一定传 true
  unbind: function () {
    return api.call('session.unbind', { confirm: true })
  },

  // 自检：钱包余额 vs 流水之和（暂时没界面上入口，排查时用）
  verify: function () {
    return api.call('session.verify')
  },

  // 爱心流水明细
  ledger: function () {
    return api.call('session.ledger')
  },

  // 工单（审批）：待我处理的 + 我发起的
  listApprovals: function () {
    return api.call('approvals.list')
  },

  decideApproval: function (id, approve) {
    return api.call('approvals.decide', { id: id, approve: !!approve })
  }
}
