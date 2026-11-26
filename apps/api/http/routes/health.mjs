// 健康检查 路由：从 createApiServer 的闭包里拿依赖，逻辑与拆分前逐行一致。
// 约定：命中并写完响应就返回（返回值 !== false）；没命中返回 false，交给下一个分组。
export function createHealthRoutes(api) {
  const {
    nowIso,
    sendJson
  } = api
  return async function handleHealth(request, req, res) {
    const { path, method, body, ip, url, user } = request

    if (path === '/health') {
      return sendJson(res, 200, { ok: true, serverTime: nowIso() })
    }

    return false
  }
}
