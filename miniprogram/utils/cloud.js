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
        reject(err)
      })
  })
}

module.exports = { call: call }
