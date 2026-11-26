// 档案 / 隐私 / 数据清除 / 调整确认 路由：从 createApiServer 的闭包里拿依赖，逻辑与拆分前逐行一致。
// 约定：命中并写完响应就返回（返回值 !== false）；没命中返回 false，交给下一个分组。
export function createAccountRoutes(api) {
  const {
    allow,
    audit,
    confirmation,
    db,
    fail,
    isIso,
    nowIso,
    privacyJson,
    profileJson,
    requireUser,
    secret,
    sendEmpty,
    sendJson,
    stringOrNull,
    userFromRequest,
    wipeUser,
    writeProfile
  } = api
  return async function handleAccount(request, req, res) {
    const { path, method, body, ip, url, user } = request

    if (path === '/data/wipe' && method === 'POST') {
      const user = requireUser(req)
      if (!allow(`wipe:${user.id}`, 5, 60_000)) fail('rate_limited', 429, '清除请求过于频繁')
      const need = confirmation(db, user.id, 'wipe', body)
      if (need) return sendJson(res, need.status, need.body)
      wipeUser(db, user.id, false)
      audit(db, user.id, 'data.wipe')
      return sendEmpty(res, 204)
    }
    if (!user) fail('unauthorized', 401, '请先登录')

    if (path === '/profile') {
      if (method === 'GET') {
        const row = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(user.id)
        return sendJson(res, 200, { profile: profileJson(row) })
      }
      if (method === 'PUT') {
        const currentRow = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(user.id)
        const patch = body.profile && typeof body.profile === 'object' ? body.profile : body
        if (currentRow && isIso(patch.updatedAt) && patch.updatedAt < currentRow.updated_at) {
          return sendJson(res, 200, { profile: profileJson(currentRow) })
        }
        const row = writeProfile(db, user.id, patch, profileJson(currentRow))
        audit(db, user.id, 'profile.update', 'profile', user.id)
        return sendJson(res, 200, { profile: profileJson(row) })
      }
    }

    if (path === '/settings/privacy') {
      if (method === 'GET') {
        const row = db.prepare('SELECT * FROM privacy_settings WHERE user_id = ?').get(user.id)
        return sendJson(res, 200, { privacy: privacyJson(row) })
      }
      if (method === 'PUT') {
        const current = privacyJson(db.prepare('SELECT * FROM privacy_settings WHERE user_id = ?').get(user.id))
        const patch = body.privacy && typeof body.privacy === 'object' ? body.privacy : body
        if (current.updatedAt && isIso(patch.updatedAt) && patch.updatedAt < current.updatedAt) {
          return sendJson(res, 200, { privacy: current })
        }
        const merged = { ...current, ...patch }
        if (merged.exportFormat !== 'csv') merged.exportFormat = 'json'
        merged.cameraEnabled = !!merged.cameraEnabled
        merged.showEnergyEstimate = !!merged.showEnergyEstimate
        merged.saveFoodPhotoLocally = !!merged.saveFoodPhotoLocally
        const updatedAt = nowIso()
        db.prepare(`
          INSERT INTO privacy_settings (user_id, json, updated_at) VALUES (?, ?, ?)
          ON CONFLICT(user_id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at
        `).run(user.id, JSON.stringify(merged), updatedAt)
        return sendJson(res, 200, { privacy: { ...merged, updatedAt } })
      }
    }

    /**
     * 已处理的计划调整建议：单条上报，按 updatedAt 做 last-write-wins。
     * 客户端会按「首次全量 + 之后按同步窗口」重复上报，重复同一条必须是幂等的：
     * 时间戳相同视为没有更新，直接回现有行。
     */
    if (path === '/adjustment-resolutions' && method === 'PUT') {
      const key = stringOrNull(body.key, 400)
      const status = body.status
      if (!key) fail('invalid_key', 400, '缺少建议标识')
      if (status !== 'accepted' && status !== 'dismissed') fail('invalid_status', 400, '状态只能是 accepted 或 dismissed')
      const incomingAt = isIso(body.updatedAt) ? body.updatedAt : ''
      const existing = db.prepare(
        'SELECT * FROM adjustment_resolutions WHERE user_id = ? AND resolution_key = ?'
      ).get(user.id, key)
      // 空时间戳是老版本迁移上来的记录：只在服务端还没有这条时才写入，绝不覆盖别的设备的明确选择
      if (!existing || (incomingAt && incomingAt > existing.updated_at)) {
        db.prepare(`
          INSERT INTO adjustment_resolutions (user_id, resolution_key, status, updated_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(user_id, resolution_key) DO UPDATE
            SET status = excluded.status, updated_at = excluded.updated_at
        `).run(user.id, key, status, incomingAt || nowIso())
        const row = db.prepare('SELECT * FROM adjustment_resolutions WHERE user_id = ? AND resolution_key = ?').get(user.id, key)
        return sendJson(res, 200, { resolution: { key: row.resolution_key, status: row.status, updatedAt: row.updated_at } })
      }
      return sendJson(res, 200, { resolution: { key: existing.resolution_key, status: existing.status, updatedAt: existing.updated_at } })
    }

    return false
  }
}
