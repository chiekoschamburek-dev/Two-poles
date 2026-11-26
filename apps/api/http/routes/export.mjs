// 数据导出 路由：从 createApiServer 的闭包里拿依赖，逻辑与拆分前逐行一致。
// 约定：命中并写完响应就返回（返回值 !== false）；没命中返回 false，交给下一个分组。
export function createExportRoutes(api) {
  const {
    allow,
    db,
    fail,
    nowIso,
    randomUUID,
    scheduleExports,
    sendJson
  } = api
  return async function handleExport(request, req, res) {
    const { path, method, body, ip, url, user } = request

    if (path === '/export' && method === 'GET') {
      // 只取状态列：content 是整份导出快照，为了列 20 条任务把它全读进内存不划算
      const rows = db.prepare(`
        SELECT id, format, status, created_at, completed_at
        FROM export_jobs WHERE user_id = ? ORDER BY created_at DESC LIMIT 20
      `).all(user.id)
      return sendJson(res, 200, {
        jobs: rows.map((row) => ({
          jobId: row.id,
          format: row.format,
          status: row.status,
          createdAt: row.created_at,
          completedAt: row.completed_at
        }))
      })
    }

    if (path === '/export' && method === 'POST') {
      if (!allow(`export:${user.id}`, 10, 60_000)) fail('rate_limited', 429, '导出请求过于频繁')
      const format = body.format === 'json' ? 'json' : 'csv'
      const id = randomUUID()
      const now = nowIso()
      db.prepare(`
        INSERT INTO export_jobs (id, user_id, format, status, content, error, created_at, completed_at)
        VALUES (?, ?, ?, 'pending', NULL, NULL, ?, NULL)
      `).run(id, user.id, format, now)
      // 导出文件是整份用户数据快照；只保留最新一份，避免主库（和备份）被历史导出无限撑大
      db.prepare("UPDATE export_jobs SET content = NULL WHERE user_id = ? AND status = 'completed'").run(user.id)
      setImmediate(scheduleExports)
      return sendJson(res, 202, { jobId: id, format, status: 'pending' })
    }

    const exportPath = /^\/export\/([^/]+)$/.exec(path)
    if (exportPath && method === 'GET') {
      const job = db.prepare('SELECT id, format, status, error, content IS NOT NULL AS has_content FROM export_jobs WHERE id = ? AND user_id = ?')
        .get(decodeURIComponent(exportPath[1]), user.id)
      if (!job) fail('not_found', 404, '导出任务不存在')
      return sendJson(res, 200, {
        jobId: job.id,
        format: job.format,
        status: job.status,
        // 内容被新导出清空后就不再给下载地址：否则客户端点进去只能拿到 404
        downloadUrl: job.status === 'completed' && job.has_content ? `/api/v1/export/${job.id}/download` : null,
        error: job.error ?? undefined
      })
    }

    const downloadPath = /^\/export\/([^/]+)\/download$/.exec(path)
    if (downloadPath && method === 'GET') {
      const job = db.prepare('SELECT * FROM export_jobs WHERE id = ? AND user_id = ?').get(decodeURIComponent(downloadPath[1]), user.id)
      if (!job) fail('not_found', 404, '导出任务不存在')
      if (job.status !== 'completed' || !job.content) fail('not_found', 404, '导出文件尚未就绪')
      res.writeHead(200, {
        'Content-Type': job.format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="twopoles-${job.id.slice(0, 8)}.${job.format}"`,
        'Cache-Control': 'no-store'
      })
      return res.end(job.content)
    }

    return false
  }
}
