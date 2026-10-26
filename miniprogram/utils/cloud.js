/**
 * 小程序端 -> 云函数 的调用封装
 * 云函数只有一个，叫 api，用 action 区分干什么
 */
function call(action, data) {
  return new Promise(function (resolve, reject) {
    wx.cloud
      .callFunction({
        name: 'api',
        data: Object.assign({ action: action }, data || {})
      })
      .then(function (res) {
        resolve(res.result)
      })
      .catch(function (err) {
        console.error('[云函数调用失败]', action, err)
        // 把原始错误信息带出去，页面才能告诉你到底卡在哪一步
        var raw = (err && (err.errMsg || err.message)) || 'wx.cloud.callFunction 失败'
        var e = new Error(raw)
        e.raw = raw
        e.errCode = err && err.errCode
        reject(e)
      })
  })
}

module.exports = { call: call }
