// 动作分析记录 路由：从 createApiServer 的闭包里拿依赖，逻辑与拆分前逐行一致。
// 约定：命中并写完响应就返回（返回值 !== false）；没命中返回 false，交给下一个分组。
export function createAnalysesRoutes(api) {
  const {
    analysisJson,
    assert,
    boundedJsonArray,
    db,
    fail,
    findAnalysis,
    findSession,
    idempotencyResult,
    integerOrNull,
    isDate,
    nowIso,
    numberOrNull,
    pagination,
    randomUUID,
    saveIdempotency,
    sendEmpty,
    sendJson,
    stringOrNull
  } = api
  return async function handleAnalyses(request, req, res) {
    const { path, method, body, ip, url, user } = request

    if (path === '/analyses' && method === 'GET') {
      const from = isDate(url.searchParams.get('from')) ? url.searchParams.get('from') : '0000-01-01'
      const to = isDate(url.searchParams.get('to')) ? url.searchParams.get('to') : '9999-12-31'
      const { limit, offset } = pagination(url)
      const rows = db.prepare(`
        SELECT * FROM motion_analyses
        WHERE user_id = ? AND deleted_at IS NULL AND date >= ? AND date <= ?
        ORDER BY date DESC, created_at DESC, id DESC
        LIMIT ? OFFSET ?
      `).all(user.id, from, to, limit + 1, offset)
      const page = rows.slice(0, limit)
      return sendJson(res, 200, { analyses: page.map(analysisJson), nextOffset: rows.length > limit ? offset + limit : null })
    }

    if (path === '/analyses' && method === 'POST') {
      const idKey = String(req.headers['idempotency-key'] ?? '') || null
      const cached = idempotencyResult(db, user.id, idKey, method, path)
      if (cached) return sendJson(res, cached.status, cached.body)
      const raw = body.analysis && typeof body.analysis === 'object' ? body.analysis : body
      const clientId = stringOrNull(raw.clientId || raw.id, 100) ?? randomUUID()
      const existing = db.prepare('SELECT * FROM motion_analyses WHERE user_id = ? AND client_id = ?').get(user.id, clientId)
      if (existing) {
        if (existing.deleted_at) fail('conflict', 409, '这条分析记录已删除，不能再用同一个 clientId 重建', { deletedAt: existing.deleted_at })
        const result = { status: 200, body: { analysis: analysisJson(existing) } }
        saveIdempotency(db, user.id, idKey, method, path, result.status, result.body)
        return sendJson(res, result.status, result.body)
      }
      const date = isDate(raw.date) ? raw.date : null
      const action = typeof raw.action === 'string'
        && raw.action.trim().length > 0
        && raw.action.trim().length <= 80
        ? raw.action.trim()
        : null
      const view = ['side', 'front', 'oblique'].includes(raw.view) ? raw.view : null
      const status = ['completed', 'low-confidence'].includes(raw.status) ? raw.status : null
      const exerciseName = stringOrNull(raw.exerciseName, 120)
      assert(date && action && view && status && exerciseName, '分析记录缺少有效的日期、动作、视角或状态')
      const reasons = Array.isArray(raw.lowConfidenceReasons)
        ? raw.lowConfidenceReasons.filter((reason) => typeof reason === 'string').slice(0, 10).map((reason) => reason.slice(0, 300))
        : []
      let sessionId = null
      if (raw.sessionId !== undefined && raw.sessionId !== null) {
        sessionId = stringOrNull(raw.sessionId, 100)
        assert(sessionId, '关联的训练记录无效')
        if (!findSession(db, user.id, sessionId)) fail('not_found', 404, '关联的训练记录不存在')
      }
      const findings = boundedJsonArray(raw.findings, 20)
      const metrics = boundedJsonArray(raw.metrics, 30)
      // 六层证据是本机 JSON 文本：只做长度与类型约束，不解析成结构（服务端不解释证据）
      const evidence = stringOrNull(raw.evidence, 8000)
      const now = nowIso()
      const id = randomUUID()
      db.prepare(`
        INSERT INTO motion_analyses (
          id, client_id, user_id, date, action, exercise_name, view, status,
          low_confidence_reasons, findings, metrics, rep_count, gait_cycles, usable_ratio, evidence,
          session_id, rule_version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, clientId, user.id, date, action, exerciseName, view, status,
        JSON.stringify(reasons), JSON.stringify(findings), JSON.stringify(metrics),
        integerOrNull(raw.repCount), integerOrNull(raw.gaitCycles), numberOrNull(raw.usableRatio), evidence, sessionId,
        stringOrNull(raw.ruleVersion, 80) ?? 'motion-analysis-rules-v1',
        stringOrNull(raw.createdAt, 40) ?? now, now
      )
      const row = db.prepare('SELECT * FROM motion_analyses WHERE id = ?').get(id)
      const result = { status: 201, body: { analysis: analysisJson(row) } }
      saveIdempotency(db, user.id, idKey, method, path, result.status, result.body)
      return sendJson(res, result.status, result.body)
    }

    const analysisPath = /^\/analyses\/([^/]+)$/.exec(path)
    if (analysisPath && method === 'PATCH') {
      const row = findAnalysis(db, user.id, decodeURIComponent(analysisPath[1]))
      if (!row) fail('not_found', 404, '分析记录不存在')
      // 只有请求里真的出现 sessionId 才改关联：省略这个字段不能把已有绑定清掉
      if (!Object.hasOwn(body, 'sessionId')) return sendJson(res, 200, { analysis: analysisJson(row) })
      const sessionId = body.sessionId === null ? null : stringOrNull(body.sessionId, 100)
      if (sessionId) {
        const session = findSession(db, user.id, sessionId)
        if (!session) fail('not_found', 404, '关联的训练记录不存在')
      }
      db.prepare('UPDATE motion_analyses SET session_id = ?, updated_at = ? WHERE id = ?').run(sessionId, nowIso(), row.id)
      return sendJson(res, 200, { analysis: analysisJson(db.prepare('SELECT * FROM motion_analyses WHERE id = ?').get(row.id)) })
    }

    if (analysisPath && method === 'DELETE') {
      const row = findAnalysis(db, user.id, decodeURIComponent(analysisPath[1]))
      if (!row) fail('not_found', 404, '分析记录不存在')
      db.prepare('UPDATE motion_analyses SET deleted_at = ?, updated_at = ? WHERE id = ?').run(nowIso(), nowIso(), row.id)
      return sendEmpty(res, 204)
    }

    return false
  }
}
