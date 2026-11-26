// 账号与登录态 路由：从 createApiServer 的闭包里拿依赖，逻辑与拆分前逐行一致。
// 约定：命中并写完响应就返回（返回值 !== false）；没命中返回 false，交给下一个分组。
export function createAuthRoutes(api) {
  const {
    ACCESS_TTL_SECONDS,
    REFRESH_COOKIE,
    allow,
    assert,
    audit,
    clearRefreshCookie,
    confirmation,
    db,
    fail,
    hashIdentifier,
    hashPassword,
    identifierSecret,
    issueSession,
    loginBlocked,
    loginFailures,
    normalizeIdentifier,
    nowIso,
    parseCookies,
    randomUUID,
    recordLoginFailure,
    refreshCookie,
    requireUser,
    revokeRefreshToken,
    rotateRefreshToken,
    secret,
    secureCookies,
    sendEmpty,
    sendJson,
    signAccessToken,
    userFromRequest,
    userJson,
    verifyPassword,
    wipeUser
  } = api
  return async function handleAuth(request, req, res) {
    const { path, method, body, ip, url, user } = request

    if (path.startsWith('/auth/')) {
      if (!allow(`auth:${ip}`, 30, 60_000)) fail('rate_limited', 429, '登录请求过于频繁，请稍后再试')
      if (path === '/auth/device' && method === 'POST') {
        const now = nowIso()
        const id = randomUUID()
        const identifier = `device:${id}`
        db.prepare('INSERT INTO users (id, type, identifier_hash, password_hash, created_at) VALUES (?, ?, ?, NULL, ?)')
          .run(id, 'anonymous', hashIdentifier(identifier, identifierSecret), now)
        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id)
        const result = issueSession(res, user)
        return sendJson(res, result.status, result.body, result.headers)
      }
      if (path === '/auth/register' && method === 'POST') {
        const identifier = normalizeIdentifier(body.identifier)
        assert(identifier, '请输入有效的邮箱或手机号')
        const password = typeof body.password === 'string' ? body.password : ''
        assert(password.length >= 8 && password.length <= 200, '密码至少 8 位')
        const exists = db.prepare('SELECT id FROM users WHERE identifier_hash = ?').get(hashIdentifier(identifier, identifierSecret))
        assert(!exists, '该账号已注册')
        const id = randomUUID()
        const now = nowIso()
        db.prepare('INSERT INTO users (id, type, identifier_hash, password_hash, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(id, 'registered', hashIdentifier(identifier, identifierSecret), hashPassword(password), now)
        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id)
        audit(db, id, 'auth.register')
        const result = issueSession(res, user)
        return sendJson(res, result.status, result.body, result.headers)
      }
      if (path === '/auth/login' && method === 'POST') {
        const identifier = normalizeIdentifier(body.identifier)
        const password = typeof body.password === 'string' ? body.password : ''
        assert(identifier && password, '请输入账号和密码')
        // 按账号计数失败次数：成功登录不计数，也不会把后续正常登录挡住
        if (loginBlocked(identifier)) fail('rate_limited', 429, '这个账号的登录尝试过于频繁，请稍后再试')
        const user = db.prepare('SELECT * FROM users WHERE identifier_hash = ? AND deleted_at IS NULL')
          .get(hashIdentifier(identifier, identifierSecret))
        if (!user || !verifyPassword(password, user.password_hash)) {
          recordLoginFailure(identifier)
          fail('unauthorized', 401, '账号或密码不正确')
        }
        loginFailures.delete(identifier)
        const result = issueSession(res, user)
        return sendJson(res, result.status, result.body, result.headers)
      }
      if (path === '/auth/refresh' && method === 'POST') {
        const raw = parseCookies(req)[REFRESH_COOKIE]
        const rotated = rotateRefreshToken(db, raw)
        if (!rotated) {
          return sendJson(res, 401, { code: 'unauthorized', message: '登录已过期，请重新登录' }, {
            'Set-Cookie': clearRefreshCookie(secureCookies)
          })
        }
        const accessToken = signAccessToken(rotated.user.id, secret)
        return sendJson(res, 200, {
          userId: rotated.user.id,
          user: userJson(rotated.user),
          accessToken,
          expiresIn: ACCESS_TTL_SECONDS
        }, { 'Set-Cookie': refreshCookie(rotated.refreshToken, secureCookies) })
      }
      if (path === '/auth/bind' && method === 'POST') {
        const current = userFromRequest(req, db, secret)
        if (!current) return sendJson(res, 401, { code: 'unauthorized', message: '请先登录' })
        if (current.type !== 'anonymous') fail('validation_failed', 400, '只有设备账号可以绑定正式账号')
        const identifier = normalizeIdentifier(body.identifier)
        assert(identifier, '请输入有效的邮箱或手机号')
        const password = typeof body.password === 'string' ? body.password : ''
        assert(password.length >= 8 && password.length <= 200, '密码至少 8 位')
        const taken = db.prepare('SELECT id FROM users WHERE identifier_hash = ? AND id != ?')
          .get(hashIdentifier(identifier, identifierSecret), current.id)
        assert(!taken, '该账号已注册')
        db.prepare('UPDATE users SET type = ?, identifier_hash = ?, password_hash = ? WHERE id = ?')
          .run('registered', hashIdentifier(identifier, identifierSecret), hashPassword(password), current.id)
        audit(db, current.id, 'auth.bind')
        const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(current.id)
        return sendJson(res, 200, { user: userJson(updated) })
      }
      if (path === '/auth/logout' && method === 'POST') {
        revokeRefreshToken(db, parseCookies(req)[REFRESH_COOKIE])
        return sendEmpty(res, 204, { 'Set-Cookie': clearRefreshCookie(secureCookies) })
      }
      if (path === '/auth/delete-account' && method === 'POST') {
        const user = requireUser(req)
        const need = confirmation(db, user.id, 'delete-account', body)
        if (need) return sendJson(res, need.status, need.body)
        wipeUser(db, user.id, true)
        return sendEmpty(res, 204, { 'Set-Cookie': clearRefreshCookie(secureCookies) })
      }
      return sendJson(res, 404, { code: 'not_found', message: '接口不存在' })
    }

    return false
  }
}
