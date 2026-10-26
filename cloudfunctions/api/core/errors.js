/**
 * 内核 · 错误约定
 *
 * 内核内部用 throw bizError(...) 表达"业务上的失败"（未配对、没登记、爱心不够…），
 * 路由层看到 err.biz 就翻译成 { ok:false, code, message } 返回给前端，
 * 不会当成系统异常（那样会丢掉原因）。
 */
function bizError(code, message) {
  const err = new Error(message || code)
  err.biz = true
  err.code = code
  return err
}

module.exports = { bizError: bizError }
