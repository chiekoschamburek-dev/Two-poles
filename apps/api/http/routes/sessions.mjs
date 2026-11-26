// 训练记录 路由：从 createApiServer 的闭包里拿依赖，逻辑与拆分前逐行一致。
// 约定：命中并写完响应就返回（返回值 !== false）；没命中返回 false，交给下一个分组。
export function createSessionsRoutes(api) {
  const {
    assert,
    bool,
    db,
    fail,
    findSession,
    idempotencyResult,
    integerOrNull,
    isDate,
    join,
    nowIso,
    numberOrNull,
    pagination,
    randomUUID,
    saveIdempotency,
    sendEmpty,
    sendJson,
    sessionJson,
    stringOrNull
  } = api
  return async function handleSessions(request, req, res) {
    const { path, method, body, ip, url, user } = request

    if (path === '/sessions' && method === 'GET') {
      const from = isDate(url.searchParams.get('from')) ? url.searchParams.get('from') : '0000-01-01'
      const to = isDate(url.searchParams.get('to')) ? url.searchParams.get('to') : '9999-12-31'
      const { limit, offset } = pagination(url)
      const rows = db.prepare(`
        SELECT * FROM training_sessions
        WHERE user_id = ? AND deleted_at IS NULL AND date >= ? AND date <= ?
        ORDER BY date ASC, created_at ASC, id ASC
        LIMIT ? OFFSET ?
      `).all(user.id, from, to, limit + 1, offset)
      const page = rows.slice(0, limit)
      return sendJson(res, 200, { sessions: page.map(sessionJson), nextOffset: rows.length > limit ? offset + limit : null })
    }

    if (path === '/sessions' && method === 'POST') {
      const idKey = String(req.headers['idempotency-key'] ?? '') || null
      const cached = idempotencyResult(db, user.id, idKey, method, path)
      if (cached) return sendJson(res, cached.status, cached.body)
      const raw = body.session && typeof body.session === 'object' ? body.session : body
      const clientId = stringOrNull(raw.clientId || raw.id, 100) ?? randomUUID()
      const existing = db.prepare('SELECT * FROM training_sessions WHERE user_id = ? AND client_id = ?').get(user.id, clientId)
      if (existing) {
        // 软删的记录不能用同一个 clientId 复活，但也不能假装成功：否则客户端把墓碑当已同步，
        // 记录在本机还在、在服务端和换设备后已经没了。
        if (existing.deleted_at) fail('conflict', 409, '这条训练记录已删除，不能再用同一个 clientId 重建', { deletedAt: existing.deleted_at })
        const result = { status: 200, body: { session: sessionJson(existing) } }
        saveIdempotency(db, user.id, idKey, method, path, result.status, result.body)
        return sendJson(res, result.status, result.body)
      }
      const date = isDate(raw.date) ? raw.date : null
      const exerciseName = stringOrNull(raw.exerciseName, 120)
      assert(date && exerciseName, '训练记录缺少日期或动作名')
      const rpe = raw.rpe === null || raw.rpe === undefined ? null : integerOrNull(raw.rpe)
      assert(rpe === null || (rpe >= 0 && rpe <= 10), 'RPE 必须在 0–10 之间或留空')
      const now = nowIso()
      const id = randomUUID()
      db.prepare(`
        INSERT INTO training_sessions (
          id, client_id, user_id, plan_item_id, date, exercise_name, type, actual_duration,
          actual_distance, actual_sets, actual_reps, completion_status, completion_reason,
          rpe, discomfort, notes, camera_used, manual_corrections, counted_reps,
          avg_confidence, calibrated_neutral, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, clientId, user.id, stringOrNull(raw.planItemId, 100), date, exerciseName,
        stringOrNull(raw.type, 40) ?? '其他', integerOrNull(raw.actualDuration),
        integerOrNull(raw.actualDistance), integerOrNull(raw.actualSets), integerOrNull(raw.actualReps),
        ['completed', 'partial', 'skipped'].includes(raw.completionStatus) ? raw.completionStatus : 'completed',
        stringOrNull(raw.completionReason, 300), rpe, bool(raw.discomfort) ? 1 : 0,
        stringOrNull(raw.notes, 1000), bool(raw.cameraUsed) ? 1 : 0,
        integerOrNull(raw.manualCorrections) ?? 0, integerOrNull(raw.countedReps),
        numberOrNull(raw.confidence), integerOrNull(raw.calibratedNeutral),
        stringOrNull(raw.createdAt, 40) ?? now, now
      )
      const row = db.prepare('SELECT * FROM training_sessions WHERE id = ?').get(id)
      const result = { status: 201, body: { session: sessionJson(row) } }
      saveIdempotency(db, user.id, idKey, method, path, result.status, result.body)
      return sendJson(res, result.status, result.body)
    }

    const sessionFeedback = /^\/sessions\/([^/]+)\/feedback$/.exec(path)
    if (sessionFeedback && method === 'PATCH') {
      const row = findSession(db, user.id, decodeURIComponent(sessionFeedback[1]))
      if (!row) fail('not_found', 404, '训练记录不存在')
      const rpe = body.rpe === null || body.rpe === undefined ? null : integerOrNull(body.rpe)
      assert(rpe === null || (rpe >= 0 && rpe <= 10), 'RPE 必须在 0–10 之间或留空')
      // 只写请求里真的出现的字段：前端不带 notes/reason 时不能把已经记下的内容清掉。
      // 显式传 null 仍然表示"清空"，所以按 key 是否存在判断，而不是按值。
      const fields = []
      const values = []
      const setIfPresent = (key, column, value) => {
        if (!Object.hasOwn(body, key)) return
        fields.push(`${column} = ?`)
        values.push(value)
      }
      setIfPresent('duration', 'actual_duration', integerOrNull(body.duration))
      setIfPresent('distance', 'actual_distance', integerOrNull(body.distance))
      setIfPresent('rpe', 'rpe', rpe)
      setIfPresent('discomfort', 'discomfort', bool(body.discomfort) ? 1 : 0)
      setIfPresent('reason', 'completion_reason', stringOrNull(body.reason, 300))
      setIfPresent('notes', 'notes', stringOrNull(body.notes, 1000))
      if (!fields.length) return sendJson(res, 200, { session: sessionJson(row) })
      fields.push('updated_at = ?')
      values.push(nowIso(), row.id)
      db.prepare(`UPDATE training_sessions SET ${fields.join(', ')} WHERE id = ?`).run(...values)
      return sendJson(res, 200, { session: sessionJson(db.prepare('SELECT * FROM training_sessions WHERE id = ?').get(row.id)) })
    }

    const sessionPath = /^\/sessions\/([^/]+)$/.exec(path)
    if (sessionPath && method === 'DELETE') {
      const row = findSession(db, user.id, decodeURIComponent(sessionPath[1]))
      if (!row) fail('not_found', 404, '训练记录不存在')
      db.prepare('UPDATE training_sessions SET deleted_at = ?, updated_at = ? WHERE id = ?').run(nowIso(), nowIso(), row.id)
      return sendEmpty(res, 204)
    }

    return false
  }
}
