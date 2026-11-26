// 周报与同步 路由：从 createApiServer 的闭包里拿依赖，逻辑与拆分前逐行一致。
// 约定：命中并写完响应就返回（返回值 !== false）；没命中返回 false，交给下一个分组。
export function createReportsRoutes(api) {
  const {
    analysisJson,
    buildWeeklyReport,
    db,
    fail,
    isoLocal,
    latestPlan,
    mealJson,
    mealRowsForWeek,
    mondayOf,
    nowIso,
    planJson,
    privacyJson,
    profileJson,
    readItems,
    sendJson,
    sessionJson,
    sessionRowsForWeek,
    todayIso,
    weekDates
  } = api
  return async function handleReports(request, req, res) {
    const { path, method, body, ip, url, user } = request

    if (path === '/reports/weekly' && method === 'GET') {
      const start = mondayOf(url.searchParams.get('start') ?? todayIso())
      if (!start) fail('validation_failed', 400, 'start 参数不是有效日期')
      const plan = latestPlan(db, user.id, isoLocal(start))
      const days = weekDates(start)
      const from = isoLocal(days[0])
      const to = isoLocal(days.at(-1))
      const report = buildWeeklyReport({
        start: from,
        userId: user.id,
        sessions: sessionRowsForWeek(db, user.id, from, to),
        meals: mealRowsForWeek(db, user.id, from, to),
        planItems: plan?.items ?? []
      })
      return sendJson(res, 200, { report })
    }

    if (path === '/sync' && method === 'GET') {
      const since = url.searchParams.get('since')
      const serverTime = nowIso()
      const profileRow = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(user.id)
      const privacyRow = db.prepare('SELECT * FROM privacy_settings WHERE user_id = ?').get(user.id)
      const profileChanged = !since || (profileRow && profileRow.updated_at > since)
      const privacyChanged = !since || (privacyRow && privacyRow.updated_at > since)
      const sessionRows = since
        ? db.prepare(`
            SELECT * FROM training_sessions
            WHERE user_id = ? AND (updated_at > ? OR deleted_at > ?)
            ORDER BY date ASC
          `).all(user.id, since, since)
        : db.prepare('SELECT * FROM training_sessions WHERE user_id = ? ORDER BY date ASC').all(user.id)
      const mealRows = since
        ? db.prepare(`
            SELECT * FROM meal_records
            WHERE user_id = ? AND (updated_at > ? OR deleted_at > ?)
            ORDER BY date ASC
          `).all(user.id, since, since)
        : db.prepare('SELECT * FROM meal_records WHERE user_id = ? ORDER BY date ASC').all(user.id)
      const analysisRows = since
        ? db.prepare(`
            SELECT * FROM motion_analyses
            WHERE user_id = ? AND (updated_at > ? OR deleted_at > ?)
            ORDER BY date DESC, created_at DESC
          `).all(user.id, since, since)
        : db.prepare('SELECT * FROM motion_analyses WHERE user_id = ? ORDER BY date DESC, created_at DESC').all(user.id)
      const plans = (since
        ? db.prepare(`
            SELECT * FROM plans
            WHERE user_id = ? AND deleted_at IS NULL AND updated_at > ?
            ORDER BY week_start ASC, version ASC
          `).all(user.id, since)
        : db.prepare('SELECT * FROM plans WHERE user_id = ? AND deleted_at IS NULL ORDER BY week_start ASC, version ASC').all(user.id))
        .map((row) => planJson(row, readItems(db, 'plan_items', 'plan_id', row.id)))
      const resolutionRows = since
        ? db.prepare(`
            SELECT * FROM adjustment_resolutions
            WHERE user_id = ? AND updated_at > ?
            ORDER BY updated_at ASC
          `).all(user.id, since)
        : db.prepare('SELECT * FROM adjustment_resolutions WHERE user_id = ? ORDER BY updated_at ASC').all(user.id)
      const deleted = {
        sessions: sessionRows.filter((row) => row.deleted_at).map((row) => ({ id: row.id, clientId: row.client_id })),
        meals: mealRows.filter((row) => row.deleted_at).map((row) => ({ id: row.id, clientId: row.client_id })),
        plans: [],
        analyses: analysisRows.filter((row) => row.deleted_at).map((row) => ({ id: row.id, clientId: row.client_id }))
      }
      db.prepare(`
        INSERT INTO sync_state (user_id, last_sync_at) VALUES (?, ?)
        ON CONFLICT(user_id) DO UPDATE SET last_sync_at = excluded.last_sync_at
      `).run(user.id, serverTime)
      return sendJson(res, 200, {
        serverTime,
        profile: profileChanged ? profileJson(profileRow) : null,
        privacy: privacyChanged ? privacyJson(privacyRow) : null,
        sessions: sessionRows.filter((row) => !row.deleted_at).map(sessionJson),
        meals: mealRows.filter((row) => !row.deleted_at).map((row) => mealJson(row, readItems(db, 'meal_items', 'meal_record_id', row.id))),
        analyses: analysisRows.filter((row) => !row.deleted_at).map(analysisJson),
        plans,
        adjustmentResolutions: resolutionRows.map((row) => ({
          key: row.resolution_key,
          status: row.status,
          updatedAt: row.updated_at
        })),
        deleted
      })
    }

    return false
  }
}
