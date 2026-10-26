/**
 * 数据层统一入口：页面只调这里，不关心数据到底存在云上还是本机
 *
 * api.init()            -> 返回 'cloud' 或 'mock'
 * api.call(action, d)   -> Promise<结果>
 * api.forceLocal(reason)-> 运行中强制切回本地模式（云开发出问题时的应急开关）
 * api.diagnose()        -> 打印一行环境信息，排查用
 */
var config = require('./config.js')
var cloud = require('./cloud.js')
var mock = require('./mock.js')

var client = mock
var mode = 'mock'
var lastError = ''

function init() {
  var envId = String(config.envId || '').trim()

  if (!envId) {
    mode = 'mock'
    client = mock
    return mode
  }

  if (!wx.cloud) {
    lastError = '当前基础库不支持云开发（需要 2.2.3 以上），请在开发者工具「详情 → 本地设置」里调高调试基础库版本'
    console.warn('[未检测到 wx.cloud]', lastError)
    mode = 'mock'
    client = mock
    return mode
  }

  try {
    wx.cloud.init({ env: envId, traceUser: true })
    mode = 'cloud'
    client = cloud
  } catch (err) {
    lastError = 'wx.cloud.init 失败：' + ((err && (err.errMsg || err.message)) || err)
    console.error('[云开发初始化失败]', err)
    mode = 'mock'
    client = mock
  }

  diagnose(envId)
  return mode
}

// 把常见的云开发报错翻译成人话
function explain(raw) {
  var text = String(raw || '')
  if (/FunctionName|FUNCTION_NOT_FOUND|-501000|function not found/i.test(text)) {
    return '云函数 api 还没部署。右键 cloudfunctions/api 文件夹 → 上传并部署：云端安装依赖'
  }
  if (/collection not exist|DATABASE_COLLECTION_NOT_EXIST|-502005/i.test(text)) {
    return '云开发数据库里缺集合。去「云开发 → 数据库」建 4 个：profiles、couples、checkins、heart_logs'
  }
  if (/env.*not.*exist|CLOUDBASE_ENV|invalid env|-601001/i.test(text)) {
    return '环境 ID 不对，或这个环境不属于当前 AppID。去云开发控制台复制一遍环境 ID 对比'
  }
  if (/permission|PERMISSION_DENIED|-502001|not authorized/i.test(text)) {
    return '数据库权限被拒。把 4 个集合的权限都改成「所有用户不可读写」（只有云函数能操作）'
  }
  if (/timeout|TIMEOUT|-404011/i.test(text)) {
    return '云函数执行超时，可能是没部署成功或云环境异常，重新部署一次试试'
  }
  return '原始错误：' + text
}

function call(action, data) {
  return client.call(action, data || {}).catch(function (err) {
    var raw = (err && (err.raw || err.errMsg || err.message)) || '未知错误'
    lastError = explain(raw)
    console.error('[数据请求失败]', action, raw)
    return {
      ok: false,
      code: 'CLOUD_ERROR',
      message: lastError,
      raw: raw
    }
  })
}

// 云开发搞不定时，一键切回本地模式，至少能先把界面用起来
function forceLocal(reason) {
  lastError = reason || ''
  mode = 'mock'
  client = mock
  return mode
}

function diagnose(envId) {
  var sdk = ''
  try {
    sdk = (wx.getAppBaseInfo ? wx.getAppBaseInfo() : wx.getSystemInfoSync()).SDKVersion
  } catch (e) {}
  console.log('[环境诊断] 模式=' + mode + ' | 环境ID=' + (envId || '(空)') + ' | wx.cloud=' + !!wx.cloud + ' | 基础库=' + sdk)
}

module.exports = {
  init: init,
  call: call,
  forceLocal: forceLocal,
  getMode: function () {
    return mode
  },
  getLastError: function () {
    return lastError
  }
}
