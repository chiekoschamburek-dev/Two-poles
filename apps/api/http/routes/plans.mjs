// 计划与调整 路由：从 createApiServer 的闭包里拿依赖，逻辑与拆分前逐行一致。
// 约定：命中并写完响应就返回（返回值 !== false）；没命中返回 false，交给下一个分组。
export function createPlansRoutes(api) {
  const {
    assert,
    db,
    fail,
    findPlan,
    idempotencyResult,
    integerOrNull,
    isDate,
    isoLocal,
    jsonParse,
    latestPlan,
    mondayOf,
    nowIso,
    planBaseVersion,
    randomUUID,
    readItems,
    readPlan,
    saveIdempotency,
    sendJson,
    stringOrNull,
    todayIso,
    transaction,
    weekDates,
    writePlanItems
  } = api
  return async function handlePlans(request, req, res) {
    const { path, method, body, ip, url, user } = request

    if (path === '/plans/current' && method === 'GET') {
      const week = mondayOf(url.searchParams.get('week') ?? todayIso())
      if (!week) fail('validation_failed', 400, 'week 参数不是有效日期')
      const plan = latestPlan(db, user.id, isoLocal(week))
      return sendJson(res, 200, { plan })
    }

    if (path === '/plans' && method === 'POST') {
      const idKey = String(req.headers['idempotency-key'] ?? '') || null
      const cached = idempotencyResult(db, user.id, idKey, method, path)
      if (cached) return sendJson(res, cached.status, cached.body)
      const raw = body.plan && typeof body.plan === 'object' ? body.plan : body
      const clientId = stringOrNull(raw.clientId || raw.id, 120) ?? randomUUID()
      const existing = db.prepare('SELECT * FROM plans WHERE user_id = ? AND client_id = ?').get(user.id, clientId)
      if (existing) {
        const result = { status: 200, body: { plan: readPlan(db, existing.id) } }
        saveIdempotency(db, user.id, idKey, method, path, result.status, result.body)
        return sendJson(res, result.status, result.body)
      }
      const version = integerOrNull(raw.version) ?? 1
      const weekStart = mondayOf(raw.weekStartDate)
      assert(weekStart, '计划缺少有效的周起始日期')
      const weekStartIso = isoLocal(weekStart)
      const sameVersion = db.prepare(`
        SELECT * FROM plans WHERE user_id = ? AND week_start = ? AND version = ?
      `).get(user.id, weekStartIso, version)
      if (sameVersion) {
        const latest = latestPlan(db, user.id, weekStartIso)
        return sendJson(res, 409, {
          code: 'conflict',
          message: '计划版本冲突',
          detail: { latest, reason: 'same-version' }
        })
      }
      assert(Array.isArray(raw.items), '计划缺少 items')
      const id = randomUUID()
      const weekEndDate = isDate(raw.weekEndDate)
        ? raw.weekEndDate
        : isoLocal(weekDates(weekStart).at(-1))
      const now = nowIso()
      db.exec('BEGIN')
      try {
        const current = latestPlan(db, user.id, weekStartIso)
        if (current) {
          const baseVersion = planBaseVersion(req, body)
          if (current.version !== baseVersion || version !== baseVersion + 1) {
            fail('conflict', 409, '计划已更新，请比较最新计划后再提交', { latest: current, currentVersion: current.version })
          }
        }
        db.prepare(`
          INSERT INTO plans (
            id, user_id, client_id, version, week_start, week_end, reason,
            rules_version, source, locked, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          id, user.id, clientId, version, weekStartIso, weekEndDate,
          stringOrNull(raw.reason, 500) ?? '本机计划同步', stringOrNull(raw.rulesVersion, 80) ?? 'plan-rules-v4',
          stringOrNull(raw.source, 20) ?? 'rules', raw.locked ? 1 : 0,
          stringOrNull(raw.createdAt, 40) ?? now, now
        )
        const written = writePlanItems(db, id, raw.items)
        // 全部条目都缺日期/动作名时不能回 201 + 空计划：客户端会把空计划当成同步成功
        assert(raw.items.length === 0 || written > 0, '计划条目都缺少日期或动作名')
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
      const result = { status: 201, body: { plan: readPlan(db, id) } }
      saveIdempotency(db, user.id, idKey, method, path, result.status, result.body)
      return sendJson(res, result.status, result.body)
    }

    const adjustPath = /^\/plans\/([^/]+)\/adjustments$/.exec(path)
      ?? (path === '/plans/adjustments' && typeof body.planId === 'string' ? [path, body.planId] : null)
    if (adjustPath && method === 'POST') {
      const baseVersion = planBaseVersion(req, body)
      const idKey = String(req.headers['idempotency-key'] ?? '') || null
      const cached = idempotencyResult(db, user.id, idKey, method, path)
      if (cached) return sendJson(res, cached.status, cached.body)
      const plan = findPlan(db, user.id, decodeURIComponent(adjustPath[1]))
      if (!plan) fail('not_found', 404, '计划不存在')
      const changes = Array.isArray(body.changes) ? body.changes : []
      const id = randomUUID()
      db.prepare(`
        INSERT INTO plan_adjustments (id, plan_id, user_id, base_version, created_at, reason, status, changes_json)
        VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
      `).run(id, plan.id, user.id, baseVersion, nowIso(), stringOrNull(body.reason, 500), JSON.stringify(changes))
      const result = { status: 201, body: { adjustment: { id, planId: plan.id, baseVersion, status: 'pending', changes } } }
      saveIdempotency(db, user.id, idKey, method, path, result.status, result.body)
      return sendJson(res, result.status, result.body)
    }

    const acceptPath = /^\/plans\/adjustments\/([^/]+)\/accept$/.exec(path)
    if (acceptPath && method === 'POST') {
      const baseVersion = planBaseVersion(req, body)
      const result = transaction(db, () => {
        const adjustment = db.prepare('SELECT * FROM plan_adjustments WHERE id = ? AND user_id = ?')
          .get(decodeURIComponent(acceptPath[1]), user.id)
        if (!adjustment) fail('not_found', 404, '调整不存在')
        const planRow = db.prepare('SELECT * FROM plans WHERE id = ? AND user_id = ?').get(adjustment.plan_id, user.id)
        if (!planRow) fail('not_found', 404, '计划不存在')
        if (adjustment.status === 'accepted') {
          const acceptedPlan = db.prepare('SELECT * FROM plans WHERE user_id = ? AND client_id = ?')
            .get(user.id, `adjustment:${adjustment.id}`)
          if (acceptedPlan) {
            return {
              adjustmentId: adjustment.id,
              newVersion: acceptedPlan.version,
              plan: readPlan(db, acceptedPlan.id)
            }
          }
        }
        const latestRow = db.prepare(`
          SELECT * FROM plans
          WHERE user_id = ? AND week_start = ? AND deleted_at IS NULL
          ORDER BY version DESC LIMIT 1
        `).get(user.id, planRow.week_start)
        if (!latestRow) fail('not_found', 404, '计划不存在')
        if (latestRow.version !== baseVersion || adjustment.base_version !== baseVersion) {
          fail('conflict', 409, '计划已被其他版本更新，请比较最新计划后重新提交',
            { latest: readPlan(db, latestRow.id), baseVersion, currentVersion: latestRow.version })
        }
        const changes = jsonParse(adjustment.changes_json, [])
        const items = readItems(db, 'plan_items', 'plan_id', latestRow.id)
        const byClientId = new Map(items.map((item) => [item.client_item_id || item.id, { ...item }]))
        for (const change of changes) {
          if (!change || change.type !== 'changed') continue
          const item = byClientId.get(String(change.itemId))
          if (!item) continue
          if (item.completed) {
            continue
          }
          const patch = change.newValue && typeof change.newValue === 'object' ? change.newValue : {}
          if (patch.date !== undefined) item.date = isDate(patch.date) ? patch.date : item.date
          if (patch.exerciseName !== undefined) item.exercise_name = stringOrNull(patch.exerciseName, 120) ?? item.exercise_name
          if (patch.type !== undefined) item.type = stringOrNull(patch.type, 40) ?? item.type
          if (patch.note !== undefined) item.note = stringOrNull(patch.note, 200)
          if (patch.plannedDuration !== undefined) item.planned_duration = integerOrNull(patch.plannedDuration)
          if (patch.plannedDistance !== undefined) item.planned_distance = integerOrNull(patch.plannedDistance)
          if (patch.plannedSets !== undefined) item.planned_sets = integerOrNull(patch.plannedSets)
          if (patch.plannedReps !== undefined) item.planned_reps = integerOrNull(patch.plannedReps)
          if (patch.plannedHoldSeconds !== undefined) item.planned_hold_seconds = integerOrNull(patch.plannedHoldSeconds)
          if (patch.plannedTargetMinutes !== undefined) item.planned_target_minutes = integerOrNull(patch.plannedTargetMinutes)
        }
        const now = nowIso()
        const newPlanId = randomUUID()
        db.prepare(`
          INSERT INTO plans (
            id, user_id, client_id, version, week_start, week_end, reason,
            rules_version, source, locked, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          newPlanId, user.id, `adjustment:${adjustment.id}`, latestRow.version + 1,
          latestRow.week_start, latestRow.week_end, `${latestRow.reason}（调整 ${adjustment.id}）`,
          latestRow.rules_version, latestRow.source, latestRow.locked, now, now
        )
        const insert = db.prepare(`
          INSERT INTO plan_items (
            id, client_item_id, plan_id, date, exercise_id, exercise_name, type, note,
            planned_duration, planned_distance, planned_sets, planned_reps, planned_hold_seconds,
            planned_target_minutes, locked, completed, alternatives_json, order_index
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        [...byClientId.values()].forEach((item, index) => {
          insert.run(
            randomUUID(), item.client_item_id || item.id, newPlanId, item.date, item.exercise_id,
            item.exercise_name, item.type, item.note, item.planned_duration, item.planned_distance,
            item.planned_sets, item.planned_reps, item.planned_hold_seconds, item.planned_target_minutes,
            item.locked, item.completed, item.alternatives_json, index
          )
        })
        db.prepare('UPDATE plan_adjustments SET status = ? WHERE id = ?').run('accepted', adjustment.id)
        return {
          adjustmentId: adjustment.id,
          newVersion: latestRow.version + 1,
          plan: readPlan(db, newPlanId)
        }
      })
      return sendJson(res, 200, result)
    }

    return false
  }
}
