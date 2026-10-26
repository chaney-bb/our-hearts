/**
 * 内核 · 统一返回格式
 *
 * 所有接口都返回一样的信封，前端只写一套解析。
 * 出错时必须带 message（人话）和 detail（原始错误），
 * 不允许再出现"服务打了个盹"这种把原因吞掉的文案。
 */
function ok(data) {
  if (!data) return { ok: true, serverNow: Date.now() }
  return Object.assign({ ok: true, serverNow: Date.now() }, data)
}

function fail(code, message, detail) {
  const res = {
    ok: false,
    code: code || 'ERROR',
    message: message || '出错了',
    serverNow: Date.now()
  }
  if (detail) res.detail = String(detail)
  return res
}

/**
 * 业务失败（不算异常）：模块里直接 return respond.biz('DUP', '今天已经打过卡啦')
 * 路由层看到 ok === false 就原样返回给前端
 * extra 会作为 errors 一起返回（比如规则校验的详细报错列表）
 */
function biz(code, message, extra) {
  const res = { ok: false, code: code || 'BIZ', message: message || '操作没成功' }
  if (extra) res.errors = extra
  return res
}

module.exports = { ok: ok, fail: fail, biz: biz }
