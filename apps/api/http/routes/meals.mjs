// 餐食记录 路由：从 createApiServer 的闭包里拿依赖，逻辑与拆分前逐行一致。
// 约定：命中并写完响应就返回（返回值 !== false）；没命中返回 false，交给下一个分组。
export function createMealsRoutes(api) {
  const {
    assert,
    db,
    fail,
    findMeal,
    idempotencyResult,
    isDate,
    join,
    mealJson,
    nowIso,
    pagination,
    randomUUID,
    readItems,
    readMeal,
    saveIdempotency,
    sendEmpty,
    sendJson,
    stringOrNull,
    writeMealItems
  } = api
  return async function handleMeals(request, req, res) {
    const { path, method, body, ip, url, user } = request

    if (path === '/meals' && method === 'GET') {
      const date = url.searchParams.get('date')
      const { limit, offset } = pagination(url)
      const rows = date && isDate(date)
        ? db.prepare('SELECT * FROM meal_records WHERE user_id = ? AND date = ? AND deleted_at IS NULL ORDER BY time ASC, id ASC LIMIT ? OFFSET ?')
          .all(user.id, date, limit + 1, offset)
        : db.prepare('SELECT * FROM meal_records WHERE user_id = ? AND deleted_at IS NULL ORDER BY date ASC, time ASC, id ASC LIMIT ? OFFSET ?')
          .all(user.id, limit + 1, offset)
      const page = rows.slice(0, limit)
      return sendJson(res, 200, {
        meals: page.map((row) => mealJson(row, readItems(db, 'meal_items', 'meal_record_id', row.id))),
        nextOffset: rows.length > limit ? offset + limit : null
      })
    }

    if (path === '/meals' && method === 'POST') {
      const idKey = String(req.headers['idempotency-key'] ?? '') || null
      const cached = idempotencyResult(db, user.id, idKey, method, path)
      if (cached) return sendJson(res, cached.status, cached.body)
      const raw = body.meal && typeof body.meal === 'object' ? body.meal : body
      const clientId = stringOrNull(raw.clientId || raw.id, 100) ?? randomUUID()
      const existing = db.prepare('SELECT * FROM meal_records WHERE user_id = ? AND client_id = ?').get(user.id, clientId)
      if (existing) {
        if (existing.deleted_at) fail('conflict', 409, '这条餐食记录已删除，不能再用同一个 clientId 重建', { deletedAt: existing.deleted_at })
        const result = { status: 200, body: { meal: readMeal(db, existing.id) } }
        saveIdempotency(db, user.id, idKey, method, path, result.status, result.body)
        return sendJson(res, result.status, result.body)
      }
      const date = isDate(raw.date) ? raw.date : null
      assert(date, '餐食记录缺少日期')
      const mealType = ['breakfast', 'lunch', 'dinner', 'snack'].includes(raw.mealType) ? raw.mealType : 'snack'
      const id = randomUUID()
      const now = nowIso()
      db.exec('BEGIN')
      try {
        db.prepare(`
          INSERT INTO meal_records (
            id, client_id, user_id, date, meal_type, time, completeness, analyzed,
            photo_thumb, photo_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          id, clientId, user.id, date, mealType, stringOrNull(raw.time, 10),
          ['complete', 'partial', 'unknown'].includes(raw.completeness) ? raw.completeness : 'unknown',
          raw.analyzed ? 1 : 0, stringOrNull(raw.photoThumb, 200000), stringOrNull(raw.photoId, 200),
          stringOrNull(raw.createdAt, 40) ?? now, now
        )
        writeMealItems(db, id, Array.isArray(raw.items) ? raw.items : [])
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
      const result = { status: 201, body: { meal: readMeal(db, id) } }
      saveIdempotency(db, user.id, idKey, method, path, result.status, result.body)
      return sendJson(res, result.status, result.body)
    }

    // 缩略图单独取：同步与导出不再携带它（客户端按需拉取并缓存到本机）
    const mealThumbPath = /^\/meals\/([^/]+)\/thumb$/.exec(path)
    if (mealThumbPath && method === 'GET') {
      const row = findMeal(db, user.id, decodeURIComponent(mealThumbPath[1]))
      if (!row) fail('not_found', 404, '餐食记录不存在')
      return sendJson(res, 200, { mealId: row.id, photoThumb: row.photo_thumb ?? null })
    }

    const mealPath = /^\/meals\/([^/]+)$/.exec(path)
    if (mealPath && method === 'PATCH') {
      const row = findMeal(db, user.id, decodeURIComponent(mealPath[1]))
      if (!row) fail('not_found', 404, '餐食记录不存在')
      const now = nowIso()
      db.exec('BEGIN')
      try {
        // 与训练反馈同理：没带 analyzed 的 PATCH 不能顺手把它改成 false
        const fields = []
        const values = []
        const setIfPresent = (key, column, value) => {
          if (!Object.hasOwn(body, key) || value === undefined) return
          fields.push(`${column} = ?`)
          values.push(value)
        }
        setIfPresent('time', 'time', stringOrNull(body.time, 10))
        setIfPresent('mealType', 'meal_type', ['breakfast', 'lunch', 'dinner', 'snack'].includes(body.mealType) ? body.mealType : undefined)
        setIfPresent('completeness', 'completeness', ['complete', 'partial', 'unknown'].includes(body.completeness) ? body.completeness : undefined)
        setIfPresent('analyzed', 'analyzed', body.analyzed ? 1 : 0)
        fields.push('updated_at = ?')
        values.push(now, row.id)
        db.prepare(`UPDATE meal_records SET ${fields.join(', ')} WHERE id = ?`).run(...values)
        if (Array.isArray(body.items)) writeMealItems(db, row.id, body.items)
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
      return sendJson(res, 200, { meal: readMeal(db, row.id) })
    }

    if (mealPath && method === 'DELETE') {
      const row = findMeal(db, user.id, decodeURIComponent(mealPath[1]))
      if (!row) fail('not_found', 404, '餐食记录不存在')
      db.prepare('UPDATE meal_records SET deleted_at = ?, updated_at = ? WHERE id = ?').run(nowIso(), nowIso(), row.id)
      return sendEmpty(res, 204)
    }

    return false
  }
}
