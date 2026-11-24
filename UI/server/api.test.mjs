import test from 'node:test'
import assert from 'node:assert/strict'
import { unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createApiServer, pruneHistory } from './app.mjs'
import { resolveZone } from './report.mjs'

const api = createApiServer({ dbPath: ':memory:', secret: 'test-secret', corsOrigins: ['http://localhost:5173'] })
await new Promise((resolve) => api.server.listen(0, '127.0.0.1', resolve))
const { port } = api.server.address()
const base = `http://127.0.0.1:${port}/api/v1`

const cookieOf = (response) => {
  const values = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean)
  const first = values.find((value) => value.startsWith('twopoles_refresh='))
  return first ? first.split(';')[0] : ''
}

let accessToken = ''
let refreshCookie = ''
let sessionId = ''
let mealId = ''
let planId = ''
let analysisId = ''
const weekStart = '2026-11-02'

async function request(path, { method = 'GET', body, token = accessToken, cookie = refreshCookie, idempotencyKey, ifMatch } = {}) {
  const headers = {}
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (token) headers.authorization = `Bearer ${token}`
  if (cookie) headers.cookie = cookie
  if (idempotencyKey) headers['idempotency-key'] = idempotencyKey
  if (ifMatch !== undefined) headers['if-match'] = ifMatch
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  const type = response.headers.get('content-type') ?? ''
  const payload = type.includes('application/json') ? await response.json() : await response.text()
  return { status: response.status, body: payload, setCookie: cookieOf(response) }
}

async function waitForExport(jobId) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const job = await request(`/export/${jobId}`)
    if (job.body.status !== 'pending') return job
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  assert.fail('导出作业未完成')
}

test('health is public', async () => {
  const response = await request('/health', { token: '' })
  assert.equal(response.status, 200)
  assert.equal(response.body.ok, true)
})

test('device account issues access token and refresh cookie', async () => {
  const response = await request('/auth/device', { method: 'POST', token: '' })
  assert.equal(response.status, 200)
  assert.ok(response.body.accessToken)
  assert.equal(response.body.user.type, 'anonymous')
  assert.match(response.setCookie, /^twopoles_refresh=/)
  accessToken = response.body.accessToken
  refreshCookie = response.setCookie
})

test('refresh rotates the cookie and keeps the account', async () => {
  const response = await request('/auth/refresh', { method: 'POST', token: '', cookie: refreshCookie })
  assert.equal(response.status, 200)
  assert.ok(response.body.accessToken)
  assert.notEqual(response.setCookie, refreshCookie)
  accessToken = response.body.accessToken
  refreshCookie = response.setCookie
})

test('device account can bind a registered identifier without losing the session', async () => {
  const bound = await request('/auth/bind', {
    method: 'POST',
    body: { identifier: 'bound@example.com', password: 'correct-horse' }
  })
  assert.equal(bound.status, 200)
  assert.equal(bound.body.user.type, 'registered')
  const login = await request('/auth/login', {
    method: 'POST',
    token: '',
    body: { identifier: 'bound@example.com', password: 'correct-horse' }
  })
  assert.equal(login.status, 200)
  assert.equal(login.body.user.id, accessToken ? bound.body.user.id : '')
})

test('profile round-trips and validates age', async () => {
  const invalid = await request('/profile', {
    method: 'PUT',
    body: { age: 9 }
  })
  assert.equal(invalid.status, 400)
  assert.equal(invalid.body.code, 'validation_failed')

  const profile = {
    id: 'ignored',
    nickname: '同步测试',
    age: 24,
    goal: '耐力',
    experience: '中级',
    availableTimes: ['30'],
    equipment: ['椅子'],
    availableVenues: ['宿舍或家'],
    restrictions: ['膝关节不适'],
    height: 172,
    weight: 65,
    personalBests: [],
    gymRecords: []
  }
  const response = await request('/profile', { method: 'PUT', body: profile })
  assert.equal(response.status, 200)
  assert.equal(response.body.profile.age, 24)
  assert.equal(response.body.profile.goal, '耐力')
  assert.deepEqual(response.body.profile.restrictions, ['膝关节不适'])
  const read = await request('/profile')
  assert.equal(read.body.profile.nickname, '同步测试')
})

test('profile avatar is validated, synchronized and explicitly removable', async () => {
  // 1×1 JPEG, generated for this test.
  const avatarDataUrl = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAAf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AH//Z'
  const saved = await request('/profile', { method: 'PUT', body: { avatarDataUrl } })
  assert.equal(saved.status, 200)
  assert.equal(saved.body.profile.avatarDataUrl, avatarDataUrl)
  assert.equal((await request('/sync')).body.profile.avatarDataUrl, avatarDataUrl)

  const invalid = await request('/profile', { method: 'PUT', body: { avatarDataUrl: 'https://example.test/avatar.jpg' } })
  assert.equal(invalid.status, 400)
  assert.equal((await request('/profile')).body.profile.avatarDataUrl, avatarDataUrl)

  const removed = await request('/profile', { method: 'PUT', body: { avatarDataUrl: null } })
  assert.equal(removed.status, 200)
  assert.equal(removed.body.profile.avatarDataUrl, undefined)
  assert.equal((await request('/profile')).body.profile.avatarDataUrl, undefined)
})

test('sessions are idempotent and feedback accepts null RPE', async () => {
  const session = {
    id: 'local-session-1',
    clientId: 'local-session-1',
    date: weekStart,
    exerciseName: '坐站训练',
    type: '坐站训练',
    actualDuration: 20,
    actualReps: 16,
    actualSets: 2,
    completionStatus: 'completed',
    rpe: 7,
    discomfort: false,
    cameraUsed: true,
    countedReps: 15,
    manualCorrections: 1
  }
  const first = await request('/sessions', { method: 'POST', body: session, idempotencyKey: 'idem-session-1' })
  assert.equal(first.status, 201)
  sessionId = first.body.session.id
  assert.equal(first.body.session.clientId, 'local-session-1')
  assert.equal(first.body.session.countedReps, 15)
  assert.equal(first.body.session.actualReps, 16)
  const replay = await request('/sessions', { method: 'POST', body: session, idempotencyKey: 'idem-session-1' })
  assert.equal(replay.status, 201)
  assert.equal(replay.body.session.id, sessionId)
  const duplicate = await request('/sessions', { method: 'POST', body: session, idempotencyKey: 'another-key' })
  assert.equal(duplicate.status, 200)
  assert.equal(duplicate.body.session.id, sessionId)

  const feedback = await request('/sessions/local-session-1/feedback', {
    method: 'PATCH',
    body: { rpe: null, discomfort: true, reason: '膝盖发酸', notes: '降低一组' }
  })
  assert.equal(feedback.status, 200)
  assert.equal(feedback.body.session.rpe, null)
  assert.equal(feedback.body.session.discomfort, true)
  assert.equal(feedback.body.session.completionReason, '膝盖发酸')

  const nullRpe = await request('/sessions', {
    method: 'POST',
    body: { clientId: 'local-session-2', date: weekStart, exerciseName: '站姿弯举', completionStatus: 'partial', rpe: null }
  })
  assert.equal(nullRpe.status, 201)
  assert.equal(nullRpe.body.session.rpe, null)
})

test('motion analyses are idempotent, linkable and soft-deleted', async () => {
  const analysis = {
    id: 'local-analysis-1',
    clientId: 'local-analysis-1',
    date: weekStart,
    action: 'squat',
    exerciseName: '深蹲',
    view: 'side',
    status: 'completed',
    lowConfidenceReasons: [],
    findings: [{
      ruleId: 'SQ-SE-01', title: '下蹲深度不足', detail: '第 1 次最低点髋部没有低于膝部',
      timeMs: 1200, measured: -0.2, thresholdLabel: '最低点髋点低于膝点（≥ 0）', sourceLabel: 'NSCA'
    }],
    metrics: [{ id: 'metric-rep-count', label: '完整重复次数', value: 1 }],
    repCount: 1,
    gaitCycles: null,
    ruleVersion: 'motion-analysis-rules-v1',
    createdAt: '2026-11-02T08:00:00.000Z'
  }
  const first = await request('/analyses', { method: 'POST', body: analysis, idempotencyKey: 'idem-analysis-1' })
  assert.equal(first.status, 201)
  assert.equal(first.body.analysis.clientId, 'local-analysis-1')
  assert.equal(first.body.analysis.findings.length, 1)
  const replay = await request('/analyses', { method: 'POST', body: analysis, idempotencyKey: 'idem-analysis-1' })
  assert.equal(replay.status, 201)
  assert.equal(replay.body.analysis.id, first.body.analysis.id)
  const duplicate = await request('/analyses', { method: 'POST', body: analysis, idempotencyKey: 'another-analysis-key' })
  assert.equal(duplicate.status, 200)
  assert.equal(duplicate.body.analysis.id, first.body.analysis.id)

  const linked = await request('/analyses/local-analysis-1', { method: 'PATCH', body: { sessionId } })
  assert.equal(linked.status, 200)
  assert.equal(linked.body.analysis.sessionId, sessionId)
  const untouched = await request('/analyses/local-analysis-1', { method: 'PATCH', body: {} })
  assert.equal(untouched.status, 200)
  assert.equal(untouched.body.analysis.sessionId, sessionId, '没带 sessionId 不能把已有绑定清掉')
  const unlinked = await request('/analyses/local-analysis-1', { method: 'PATCH', body: { sessionId: null } })
  assert.equal(unlinked.status, 200)
  assert.equal(unlinked.body.analysis.sessionId, undefined)
  const missingSession = await request('/analyses/local-analysis-1', { method: 'PATCH', body: { sessionId: 'missing-session' } })
  assert.equal(missingSession.status, 404)

  const removed = await request('/analyses/local-analysis-1', { method: 'DELETE' })
  assert.equal(removed.status, 204)
  assert.equal((await request('/analyses')).body.analyses.length, 0)

  const second = await request('/analyses', {
    method: 'POST',
    body: {
      ...analysis, id: 'local-analysis-2', clientId: 'local-analysis-2',
      action: 'running', exerciseName: '跑姿', view: 'front', status: 'low-confidence',
      lowConfidenceReasons: ['关键点可见度偏低'], repCount: null, gaitCycles: 6,
      sessionId
    },
    idempotencyKey: 'idem-analysis-2'
  })
  assert.equal(second.status, 201)
  analysisId = second.body.analysis.id
  assert.equal(second.body.analysis.status, 'low-confidence')
  assert.equal(second.body.analysis.sessionId, sessionId)
  assert.deepEqual(second.body.analysis.lowConfidenceReasons, ['关键点可见度偏低'])

  const older = await request('/analyses', {
    method: 'POST',
    body: { ...analysis, id: 'local-analysis-older', clientId: 'local-analysis-older', date: '2026-10-01' }
  })
  assert.equal(older.status, 201)
  const listed = await request('/analyses')
  assert.equal(listed.body.analyses[0].date >= listed.body.analyses.at(-1).date, true)

  const badSession = await request('/analyses', {
    method: 'POST', body: { ...analysis, id: 'bad-session-analysis', clientId: 'bad-session-analysis', sessionId: 'missing-session' }
  })
  assert.equal(badSession.status, 404)

  const invalidAction = await request('/analyses', {
    method: 'POST', body: { ...analysis, id: 'bad-analysis', clientId: 'bad-analysis', action: 'bench' }
  })
  assert.equal(invalidAction.status, 400)
  const hugeFindings = await request('/analyses', {
    method: 'POST',
    body: { ...analysis, id: 'huge-analysis', clientId: 'huge-analysis', findings: Array.from({ length: 40 }, () => ({ ruleId: 'x' })) }
  })
  assert.equal(hugeFindings.status, 201)
  assert.equal(hugeFindings.body.analysis.findings.length, 20)
})

test('adjustment resolutions sync across devices with last-write-wins', async () => {
  const key = 'feedback|站姿弯举|sess-a|sess-b|item-1'
  assert.equal((await request('/sync')).body.adjustmentResolutions.length, 0)

  const first = await request('/adjustment-resolutions', {
    method: 'PUT',
    body: { key, status: 'accepted', updatedAt: '2026-11-10T08:00:00.000Z' }
  })
  assert.equal(first.status, 200)
  assert.equal(first.body.resolution.status, 'accepted')
  assert.equal(first.body.resolution.key, key)

  // 重复上报同一条（客户端每次同步都会补传）必须幂等，不能把 updatedAt 刷新成服务端现在
  const replay = await request('/adjustment-resolutions', {
    method: 'PUT',
    body: { key, status: 'accepted', updatedAt: '2026-11-10T08:00:00.000Z' }
  })
  assert.equal(replay.status, 200)
  assert.equal(replay.body.resolution.updatedAt, '2026-11-10T08:00:00.000Z')

  // 更旧的选择不能盖掉更新的
  const stale = await request('/adjustment-resolutions', {
    method: 'PUT',
    body: { key, status: 'dismissed', updatedAt: '2026-11-01T08:00:00.000Z' }
  })
  assert.equal(stale.body.resolution.status, 'accepted')
  assert.equal(stale.body.resolution.updatedAt, '2026-11-10T08:00:00.000Z')

  // 更新的选择要生效
  const newer = await request('/adjustment-resolutions', {
    method: 'PUT',
    body: { key, status: 'dismissed', updatedAt: '2026-11-12T08:00:00.000Z' }
  })
  assert.equal(newer.body.resolution.status, 'dismissed')
  assert.equal(newer.body.resolution.updatedAt, '2026-11-12T08:00:00.000Z')

  // 老版本本地记录没有时间戳：只在服务端没有这条时才能写入
  const legacyNewKey = 'feedback|深蹲|sess-c|sess-d|item-2'
  const legacy = await request('/adjustment-resolutions', {
    method: 'PUT', body: { key: legacyNewKey, status: 'dismissed', updatedAt: '' }
  })
  assert.equal(legacy.body.resolution.status, 'dismissed')
  assert.equal(legacy.body.resolution.updatedAt.length > 0, true)
  const legacyAgainstNewer = await request('/adjustment-resolutions', {
    method: 'PUT', body: { key, status: 'accepted', updatedAt: '' }
  })
  assert.equal(legacyAgainstNewer.body.resolution.status, 'dismissed', '空时间戳不能覆盖已有选择')

  const synced = await request('/sync')
  const rows = synced.body.adjustmentResolutions
  assert.equal(rows.length, 2)
  assert.equal(rows.find((row) => row.key === key).status, 'dismissed')

  assert.equal((await request('/adjustment-resolutions', {
    method: 'PUT', body: { key, status: 'maybe', updatedAt: '2026-11-13T08:00:00.000Z' }
  })).status, 400)
  assert.equal((await request('/adjustment-resolutions', {
    method: 'PUT', body: { status: 'accepted', updatedAt: '2026-11-13T08:00:00.000Z' }
  })).status, 400)
  assert.equal((await request('/adjustment-resolutions', { method: 'PUT', body: { key, status: 'accepted' } })).status, 200,
    '缺少 updatedAt 按空串处理：不报错，也不会覆盖已有选择')
})

test('meals store items and support update/delete', async () => {
  const meal = {
    id: 'local-meal-1',
    clientId: 'local-meal-1',
    date: weekStart,
    mealType: 'lunch',
    time: '12:20',
    completeness: 'partial',
    analyzed: true,
    items: [
      { id: 'item-1', foodName: '米饭', category: '谷薯类', portionSize: 1, portionUnit: '碗', confirmed: true, source: 'manual' },
      { id: 'item-2', foodName: '西兰花', category: '蔬菜类', confirmed: false, source: 'photo', photoConfidence: 0.72, uncertain: true }
    ]
  }
  const first = await request('/meals', { method: 'POST', body: meal, idempotencyKey: 'idem-meal-1' })
  assert.equal(first.status, 201)
  mealId = first.body.meal.id
  assert.equal(first.body.meal.items.length, 2)
  assert.equal(first.body.meal.items[1].uncertain, true)
  const replay = await request('/meals', { method: 'POST', body: meal, idempotencyKey: 'idem-meal-1' })
  assert.equal(replay.status, 201)
  assert.equal(replay.body.meal.id, mealId)

  const update = await request(`/meals/${mealId}`, {
    method: 'PATCH',
    body: {
      time: '12:40',
      completeness: 'complete',
      analyzed: true,
      items: [{ id: 'item-1', foodName: '米饭', category: '谷薯类', portionSize: 1.5, portionUnit: '碗', confirmed: true }]
    }
  })
  assert.equal(update.status, 200)
  assert.equal(update.body.meal.time, '12:40')
  assert.equal(update.body.meal.items.length, 1)
  assert.equal(update.body.meal.items[0].portionSize, 1.5)

  const list = await request(`/meals?date=${weekStart}`)
  assert.equal(list.body.meals.length, 1)
})

test('meal thumbnails are fetched separately and stay out of sync/export', async () => {
  const photoThumb = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQ=='
  const created = await request('/meals', {
    method: 'POST',
    body: { clientId: 'thumb-meal', date: weekStart, mealType: 'lunch', photoThumb, photoId: 'photo-1', items: [] }
  })
  assert.equal(created.status, 201)
  assert.equal(created.body.meal.photoThumb, undefined, '创建响应不再带缩略图')

  const thumb = await request('/meals/thumb-meal/thumb')
  assert.equal(thumb.status, 200)
  assert.equal(thumb.body.photoThumb, photoThumb)
  assert.equal((await request('/meals/not-a-meal/thumb')).status, 404)

  const sync = await request('/sync')
  const synced = sync.body.meals.find((meal) => meal.clientId === 'thumb-meal')
  assert.ok(synced)
  assert.equal('photoThumb' in synced, false, '同步不带缩略图')
})

test('plans are versioned and stale adjustments return 409', async () => {
  const plan = {
    id: 'local-plan-1',
    clientId: 'local-plan-1',
    version: 1,
    weekStartDate: weekStart,
    weekEndDate: '2026-11-08',
    reason: '规则计划',
    items: [
      { id: 'plan-item-completed', date: weekStart, exerciseName: '坐站训练', type: '坐站训练', plannedSets: 2, plannedReps: 8, completed: true },
      { id: 'plan-item-open', date: weekStart, exerciseName: '站姿弯举', type: '站姿弯举', plannedSets: 2, plannedReps: 10 }
    ]
  }
  const created = await request('/plans', { method: 'POST', body: plan, idempotencyKey: 'idem-plan-1' })
  assert.equal(created.status, 201)
  planId = created.body.plan.id
  assert.equal(created.body.plan.items.length, 2)
  const replay = await request('/plans', { method: 'POST', body: plan, idempotencyKey: 'idem-plan-1' })
  assert.equal(replay.status, 201)

  const current = await request(`/plans/current?week=${weekStart}`)
  assert.equal(current.body.plan.version, 1)

  const adjustment = await request(`/plans/${planId}/adjustments`, {
    method: 'POST',
    ifMatch: '"1"',
    body: {
      baseVersion: 1,
      reason: '降低训练量',
      changes: [
        { itemId: 'plan-item-completed', type: 'changed', newValue: { plannedReps: 99 } },
        { itemId: 'plan-item-open', type: 'changed', newValue: { plannedReps: 12, plannedDuration: 6 } }
      ]
    }
  })
  assert.equal(adjustment.status, 201)
  const accepted = await request(`/plans/adjustments/${adjustment.body.adjustment.id}/accept`, {
    method: 'POST',
    ifMatch: '"1"',
    body: { baseVersion: 1 }
  })
  assert.equal(accepted.status, 200)
  assert.equal(accepted.body.newVersion, 2)
  const completed = accepted.body.plan.items.find((item) => item.id === 'plan-item-completed')
  const open = accepted.body.plan.items.find((item) => item.id === 'plan-item-open')
  assert.equal(completed.plannedReps, 8)
  assert.equal(open.plannedReps, 12)
  assert.equal(open.plannedDuration, 6)

  const oldPlan = await request(`/plans/current?week=${weekStart}`)
  assert.equal(oldPlan.body.plan.version, 2)

  const retry = await request(`/plans/adjustments/${adjustment.body.adjustment.id}/accept`, {
    method: 'POST',
    ifMatch: '"1"',
    body: { baseVersion: 1 }
  })
  assert.equal(retry.status, 200)
  assert.equal(retry.body.newVersion, 2)

  const staleAdjustment = await request(`/plans/${planId}/adjustments`, {
    method: 'POST',
    ifMatch: '"1"',
    body: { baseVersion: 1, reason: '旧版本调整', changes: [] }
  })
  const stale = await request(`/plans/adjustments/${staleAdjustment.body.adjustment.id}/accept`, {
    method: 'POST',
    ifMatch: '"1"',
    body: { baseVersion: 1 }
  })
  assert.equal(stale.status, 409)
  assert.equal(stale.body.code, 'conflict')
  assert.equal(stale.body.detail.latest.version, 2)
  const missing = await request(`/plans/adjustments/${staleAdjustment.body.adjustment.id}/accept`, {
    method: 'POST', body: { baseVersion: 2 }
  })
  assert.equal(missing.status, 428)
  const mismatched = await request(`/plans/adjustments/${staleAdjustment.body.adjustment.id}/accept`, {
    method: 'POST', ifMatch: '"1"', body: { baseVersion: 2 }
  })
  assert.equal(mismatched.status, 400)
  const rebased = await request(`/plans/adjustments/${staleAdjustment.body.adjustment.id}/accept`, {
    method: 'POST', ifMatch: '"2"', body: { baseVersion: 2 }
  })
  assert.equal(rebased.status, 409, '旧建议不能只换请求头绕过版本校验')
  assert.equal(api.db.prepare('SELECT COUNT(*) AS n FROM plans WHERE user_id = (SELECT user_id FROM plans WHERE id = ?)').get(planId).n, 2)
})

test('weekly report uses server plan and sessions without filling missing RPE with zero', async () => {
  const response = await request(`/reports/weekly?start=${weekStart}`)
  assert.equal(response.status, 200)
  const report = response.body.report
  assert.equal(report.weekStartDate, weekStart)
  assert.equal(report.plannedSessions, 1)
  assert.equal(report.completedSessions, 1)
  assert.equal(report.totalDuration, 20)
  assert.equal(report.loadByDay[0], null)
  assert.equal(report.totalLoad, null)
  assert.ok(report.dataQuality.some((line) => line.includes('未记录 RPE')))
})

test('privacy settings round-trip', async () => {
  const write = await request('/settings/privacy', {
    method: 'PUT',
    body: { showEnergyEstimate: true, saveFoodPhotoLocally: false, exportFormat: 'csv' }
  })
  assert.equal(write.status, 200)
  assert.equal(write.body.privacy.showEnergyEstimate, true)
  assert.equal(write.body.privacy.saveFoodPhotoLocally, false)
  const read = await request('/settings/privacy')
  assert.equal(read.body.privacy.exportFormat, 'csv')
})

test('sync returns changed records and tombstones', async () => {
  const removed = await request(`/sessions/local-session-2`, { method: 'DELETE' })
  assert.equal(removed.status, 204)
  const response = await request(`/sync?since=2000-01-01T00:00:00.000Z`)
  assert.equal(response.status, 200)
  assert.ok(response.body.serverTime)
  assert.equal(response.body.profile.age, 24)
  assert.ok(response.body.sessions.some((session) => session.clientId === 'local-session-1'))
  assert.ok(response.body.deleted.sessions.some((session) => session.clientId === 'local-session-2'))
  assert.ok(response.body.analyses.some((analysis) => analysis.clientId === 'local-analysis-2'))
  assert.ok(response.body.deleted.analyses.some((analysis) => analysis.clientId === 'local-analysis-1'))
  assert.equal(response.body.plans.at(-1).version, 2)
  assert.equal(response.body.modeLog, undefined)
})

test('export jobs produce JSON and spreadsheet-friendly CSV', async () => {
  const created = await request('/export', { method: 'POST', body: { format: 'csv' } })
  assert.equal(created.status, 202)
  assert.ok(created.body.jobId)
  assert.equal(created.body.status, 'pending')
  const health = await request('/health')
  assert.equal(health.status, 200)
  const job = await waitForExport(created.body.jobId)
  assert.equal(job.status, 200)
  assert.equal(job.body.status, 'completed')
  assert.ok(job.body.downloadUrl)
  const downloadResponse = await fetch(`${base}/export/${created.body.jobId}/download`, {
    headers: { authorization: `Bearer ${accessToken}` }
  })
  assert.equal(downloadResponse.status, 200)
  const bytes = new Uint8Array(await downloadResponse.arrayBuffer())
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf])
  const csvText = new TextDecoder('utf-8').decode(bytes)
  assert.ok(csvText.includes('训练'))
  assert.ok(csvText.includes('餐食'))
  assert.ok(csvText.includes('分析'))

  const jsonJob = await request('/export', { method: 'POST', body: { format: 'json' } })
  await waitForExport(jsonJob.body.jobId)
  const jsonDownload = await request(`/export/${jsonJob.body.jobId}/download`)
  const parsed = jsonDownload.body
  assert.equal(parsed.profile.age, 24)
  assert.ok(Array.isArray(parsed.sessions))
  assert.ok(parsed.analyses.some((analysis) => analysis.clientId === 'local-analysis-2'))
  assert.ok(!JSON.stringify(parsed).includes('data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQ=='), '导出不包含缩略图')
})

test('plan version writes honor If-Match and simultaneous accepts cannot both win', async () => {
  const current = (await request(`/plans/current?week=${weekStart}`)).body.plan
  const nextPlan = { ...current, id: 'local-plan-v3', clientId: 'local-plan-v3', version: 3 }
  const missing = await request('/plans', { method: 'POST', body: nextPlan })
  assert.equal(missing.status, 428)
  const next = await request('/plans', { method: 'POST', ifMatch: '"2"', body: nextPlan, idempotencyKey: 'next-plan-v3' })
  assert.equal(next.status, 201)
  const stale = await request('/plans', { method: 'POST', ifMatch: '"2"', body: { ...nextPlan, clientId: 'stale-plan-v4', version: 4 } })
  assert.equal(stale.status, 409)
  const createAdjustment = () => request(`/plans/${next.body.plan.id}/adjustments`, {
    method: 'POST', ifMatch: '"3"', body: { baseVersion: 3, changes: [] }
  })
  const adjustments = await Promise.all([createAdjustment(), createAdjustment()])
  const accepted = await Promise.all(adjustments.map((item) => request(`/plans/adjustments/${item.body.adjustment.id}/accept`, {
    method: 'POST', ifMatch: '"3"', body: {}
  })))
  assert.deepEqual(accepted.map((item) => item.status).sort(), [200, 409])
  assert.equal((await request(`/plans/current?week=${weekStart}`)).body.plan.version, 4)
})

test('older profile and privacy writes cannot replace newer values', async () => {
  const previous = await request('/profile')
  const stale = await request('/profile', { method: 'PUT', body: { age: 50, updatedAt: '2000-01-01T00:00:00.000Z' } })
  assert.equal(stale.body.profile.age, previous.body.profile.age)
  const privacy = await request('/settings/privacy')
  const stalePrivacy = await request('/settings/privacy', { method: 'PUT', body: {
    cameraEnabled: !privacy.body.privacy.cameraEnabled, updatedAt: '2000-01-01T00:00:00.000Z'
  } })
  assert.equal(stalePrivacy.body.privacy.cameraEnabled, privacy.body.privacy.cameraEnabled)
})

test('personal resources and export downloads are isolated by account', async () => {
  const other = await request('/auth/device', { method: 'POST', token: '', cookie: '' })
  const token = other.body.accessToken
  assert.equal((await request('/sessions', { token })).body.sessions.length, 0)
  assert.equal((await request(`/sessions/${sessionId}/feedback`, { method: 'PATCH', token, body: { rpe: 4 } })).status, 404)
  assert.equal((await request('/analyses', { token })).body.analyses.length, 0)
  assert.equal((await request(`/analyses/${analysisId}`, { method: 'PATCH', token, body: { sessionId: null } })).status, 404)
  assert.equal((await request(`/analyses/${analysisId}`, { method: 'DELETE', token })).status, 404)
  const otherSession = await request('/sessions', {
    method: 'POST', token, body: { clientId: 'other-session', date: weekStart, exerciseName: '别人的训练' }
  })
  assert.equal((await request(`/analyses/${analysisId}`, {
    method: 'PATCH', body: { sessionId: otherSession.body.session.id }
  })).status, 404, '不能关联他人账号的训练记录')
  assert.equal((await request(`/meals/${mealId}`, { method: 'DELETE', token })).status, 404)
  assert.equal((await request(`/plans/${planId}/adjustments`, { method: 'POST', token, ifMatch: '"1"', body: {} })).status, 404)
  const job = api.db.prepare('SELECT id FROM export_jobs LIMIT 1').get()
  assert.equal((await request(`/export/${job.id}/download`, { token })).status, 404)
})

test('wipe requires a confirmation token and removes all user data', async () => {
  const pendingExport = await request('/export', { method: 'POST', body: { format: 'json' } })
  const first = await request('/data/wipe', { method: 'POST', body: {} })
  assert.equal(first.status, 202)
  assert.ok(first.body.confirmToken)
  const second = await request('/data/wipe', { method: 'POST', body: { confirmToken: first.body.confirmToken } })
  assert.equal(second.status, 204)
  const profile = await request('/profile')
  assert.equal(profile.body.profile, null)
  const sessions = await request('/sessions')
  assert.equal(sessions.body.sessions.length, 0)
  const meals = await request('/meals')
  assert.equal(meals.body.meals.length, 0)
  const analyses = await request('/analyses')
  assert.equal(analyses.body.analyses.length, 0)
  const plans = await request(`/plans/current?week=${weekStart}`)
  assert.equal(plans.body.plan, null)
  assert.equal((await request(`/export/${pendingExport.body.jobId}`)).status, 404)
  const refreshed = await request('/auth/refresh', { method: 'POST', body: {}, token: '' })
  assert.equal(refreshed.status, 200, '清数据保留账号和 cookie 会话')
  accessToken = refreshed.body.accessToken
  refreshCookie = refreshed.setCookie
})

test('registered accounts can login, refresh, logout and delete', async () => {
  const identifier = 'runner@example.com'
  const registered = await request('/auth/register', {
    method: 'POST',
    token: '',
    body: { identifier, password: 'correct-horse' }
  })
  assert.equal(registered.status, 200)
  assert.equal(registered.body.user.type, 'registered')
  const registeredCookie = registered.setCookie
  const duplicate = await request('/auth/register', {
    method: 'POST',
    token: '',
    body: { identifier, password: 'correct-horse' }
  })
  assert.equal(duplicate.status, 400)

  const login = await request('/auth/login', {
    method: 'POST',
    token: '',
    body: { identifier, password: 'correct-horse' }
  })
  assert.equal(login.status, 200)
  const loginToken = login.body.accessToken
  const loginCookie = login.setCookie

  const refresh = await request('/auth/refresh', { method: 'POST', token: '', cookie: loginCookie })
  assert.equal(refresh.status, 200)
  assert.ok(refresh.body.accessToken)

  const profile = await request('/profile', {
    method: 'PUT',
    token: refresh.body.accessToken,
    body: { age: 30, availableTimes: [], equipment: [], restrictions: [] }
  })
  assert.equal(profile.status, 200)

  const logout = await request('/auth/logout', { method: 'POST', token: loginToken, cookie: registeredCookie })
  assert.equal(logout.status, 204)

  const loginAgain = await request('/auth/login', {
    method: 'POST',
    token: '',
    body: { identifier, password: 'correct-horse' }
  })
  const deleteRequest = await request('/auth/delete-account', {
    method: 'POST',
    token: loginAgain.body.accessToken,
    body: {}
  })
  assert.equal(deleteRequest.status, 202)
  const deleted = await request('/auth/delete-account', {
    method: 'POST',
    token: loginAgain.body.accessToken,
    body: { confirmToken: deleteRequest.body.confirmToken }
  })
  assert.equal(deleted.status, 204)
  const loginAfterDelete = await request('/auth/login', {
    method: 'POST',
    token: '',
    body: { identifier, password: 'correct-horse' }
  })
  assert.equal(loginAfterDelete.status, 401)
})

test('unauthorized requests and unknown routes use the shared error envelope', async () => {
  const unauthorized = await request('/sessions', { token: '' })
  assert.equal(unauthorized.status, 401)
  assert.equal(unauthorized.body.code, 'unauthorized')
  const missing = await request('/nope')
  assert.equal(missing.status, 404)
  assert.equal(missing.body.code, 'not_found')
})

test('partial feedback patch keeps the fields the client did not send', async () => {
  const created = await request('/sessions', {
    method: 'POST',
    body: { clientId: 'partial-feedback', date: weekStart, exerciseName: '坐站训练', actualDuration: 15 }
  })
  assert.equal(created.status, 201)
  const full = await request('/sessions/partial-feedback/feedback', {
    method: 'PATCH',
    body: { rpe: 6, discomfort: true, reason: '时间不够', notes: '最后一组降重' }
  })
  assert.equal(full.status, 200)
  const partial = await request('/sessions/partial-feedback/feedback', { method: 'PATCH', body: { rpe: 8 } })
  assert.equal(partial.status, 200)
  assert.equal(partial.body.session.rpe, 8)
  assert.equal(partial.body.session.notes, '最后一组降重', '没带 notes 不能抹掉已有备注')
  assert.equal(partial.body.session.completionReason, '时间不够')
  assert.equal(partial.body.session.discomfort, true)
  const cleared = await request('/sessions/partial-feedback/feedback', { method: 'PATCH', body: { notes: null } })
  assert.equal(cleared.body.session.notes, undefined, '显式 null 仍然表示清空')
  assert.equal(cleared.body.session.completionReason, '时间不够')
})

test('partial meal patch keeps analyzed', async () => {
  const created = await request('/meals', {
    method: 'POST',
    body: { clientId: 'partial-meal', date: weekStart, mealType: 'dinner', analyzed: true, items: [{ foodName: '米饭', category: '谷薯类' }] }
  })
  assert.equal(created.status, 201)
  const patched = await request('/meals/partial-meal', { method: 'PATCH', body: { time: '19:00' } })
  assert.equal(patched.status, 200)
  assert.equal(patched.body.meal.time, '19:00')
  assert.equal(patched.body.meal.analyzed, true, '没带 analyzed 不能把它改回 false')
})

test('idempotency keys are scoped to the endpoint and the method', async () => {
  const first = await request('/sessions', {
    method: 'POST',
    idempotencyKey: 'shared-key',
    body: { clientId: 'idem-scope', date: weekStart, exerciseName: '深蹲' }
  })
  assert.equal(first.status, 201)
  const second = await request('/meals', {
    method: 'POST',
    idempotencyKey: 'shared-key',
    body: { clientId: 'idem-scope-meal', date: weekStart, mealType: 'snack', items: [] }
  })
  assert.equal(second.status, 201, '换了接口就必须真的执行，而不是回放上一个接口的响应')
  assert.ok(second.body.meal)
  assert.equal(second.body.meal.clientId, 'idem-scope-meal')
})

test('a malformed cookie is rejected instead of crashing the request', async () => {
  const response = await fetch(`${base}/auth/refresh`, {
    method: 'POST',
    headers: { cookie: 'twopoles_refresh=%E0%A4%A' }
  })
  assert.equal(response.status, 401)
})

test('a deleted clientId cannot be silently recreated', async () => {
  const body = { clientId: 'resurrect', date: weekStart, exerciseName: '卧推' }
  assert.equal((await request('/sessions', { method: 'POST', body })).status, 201)
  assert.equal((await request('/sessions/resurrect', { method: 'DELETE' })).status, 204)
  const again = await request('/sessions', { method: 'POST', body })
  assert.equal(again.status, 409, '软删记录不能假装创建成功，也不能给客户端一个墓碑')
  assert.equal(again.body.code, 'conflict')
})

test('a plan whose items are all invalid is rejected instead of returning an empty plan', async () => {
  const response = await request('/plans', {
    method: 'POST',
    body: {
      plan: {
        clientId: 'bad-items',
        version: 1,
        weekStartDate: '2027-01-04',
        reason: 'invalid',
        items: [{ exerciseName: '' }]
      }
    }
  })
  assert.equal(response.status, 400)
  assert.equal(response.body.code, 'validation_failed')
})

test('an invalid timezone falls back to the system zone instead of throwing', async () => {
  assert.equal(resolveZone('Asia/Shanghai'), 'Asia/Shanghai')
  assert.equal(resolveZone(''), '')
  assert.equal(resolveZone('   '), '')
  assert.equal(resolveZone('Not/AZone'), '', '非法时区要退回系统时区，不能让请求 500')
})

test('login attempts are limited per account even when the IP changes', async () => {
  const statuses = []
  for (let attempt = 0; attempt < 12; attempt++) {
    const response = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.9.0.${attempt}` },
      body: JSON.stringify({ identifier: 'brute@example.com', password: 'wrong-password' })
    })
    statuses.push(response.status)
  }
  assert.ok(statuses.filter((status) => status === 401).length >= 5, '前几次正常返回认证失败')
  assert.equal(statuses.at(-1), 429, '同一账号的连续尝试必须被单独限流')
})

test('successful login resets the per-account failure counter', async () => {
  const identifier = 'limit-reset@example.com'
  const register = await fetch(`${base}/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.11.0.1' },
    body: JSON.stringify({ identifier, password: 'correct-horse' })
  })
  assert.equal(register.status, 200)
  const attempt = (password, ip) => fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ identifier, password })
  })
  for (let index = 0; index < 3; index++) {
    assert.equal((await attempt('wrong-password', `10.11.1.${index}`)).status, 401)
  }
  assert.equal((await attempt('correct-horse', '10.11.2.1')).status, 200, '失败几次后仍能正常登录')
  // 成功会清零：再错 10 次仍是 401，第 11 次才 429
  for (let index = 0; index < 10; index++) {
    assert.equal((await attempt('wrong-password', `10.11.3.${index}`)).status, 401)
  }
  assert.equal((await attempt('wrong-password', '10.11.4.1')).status, 429)
})

test('list endpoints are paginated and report the next offset', async () => {
  const first = await request('/sessions?limit=1')
  assert.equal(first.status, 200)
  assert.equal(first.body.sessions.length, 1)
  assert.equal(first.body.nextOffset, 1, '还有更多时返回下一页起点')
  const second = await request('/sessions?limit=1&offset=1')
  assert.equal(second.status, 200)
  assert.notEqual(second.body.sessions[0]?.id, first.body.sessions[0]?.id)
  const all = await request('/sessions?limit=500')
  assert.equal(all.body.nextOffset, null, '取完就没有下一页')
  assert.ok(all.body.sessions.length >= 2)
  const meals = await request('/meals?limit=1')
  assert.equal(meals.body.meals.length, 1)
  assert.equal(meals.body.nextOffset, 1)
})

test('sync only returns plans changed after since', async () => {
  const week = '2027-03-01'
  const created = await request('/plans', {
    method: 'POST',
    ifMatch: '"0"',
    body: { plan: { clientId: 'delta-plan', version: 1, weekStartDate: week, reason: 'delta', items: [{ id: 'd1', date: week, exerciseName: '深蹲' }] } }
  })
  assert.equal(created.status, 201)
  const full = await request('/sync')
  assert.ok(full.body.plans.some((plan) => plan.weekStartDate === week), '全量同步带上新计划')
  await new Promise((resolve) => setTimeout(resolve, 5))
  const next = await request('/plans', {
    method: 'POST',
    ifMatch: '"1"',
    body: { plan: { clientId: 'delta-plan:v2', version: 2, weekStartDate: week, reason: 'delta-2', items: [{ id: 'd1', date: week, exerciseName: '深蹲' }] } }
  })
  assert.equal(next.status, 201)
  const delta = await request(`/sync?since=${encodeURIComponent(full.body.serverTime)}`)
  assert.equal(delta.body.plans.length, 1, '增量同步只带变了的那一版')
  assert.equal(delta.body.plans[0].version, 2)
  assert.equal(delta.body.plans[0].weekStartDate, week)
})

test('retention job prunes expired tokens, idempotency keys, audit rows and old export jobs', async () => {
  const userId = api.db.prepare('SELECT id FROM users LIMIT 1').get().id
  const old = new Date(Date.now() - 200 * 86_400_000).toISOString()
  api.db.prepare('INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)')
    .run('old-refresh', userId, 'old-hash', old, old)
  api.db.prepare('INSERT INTO idempotency_keys (user_id, key, method, path, status, response_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(userId, 'old-idem', 'POST', '/sessions', 201, '{}', old)
  api.db.prepare('INSERT INTO audit_events (user_id, actor_role, action, created_at) VALUES (?, ?, ?, ?)')
    .run(userId, 'user', 'test.old', old)
  api.db.prepare("INSERT INTO export_jobs (id, user_id, format, status, created_at) VALUES (?, ?, 'json', 'completed', ?)")
    .run('old-export', userId, old)
  api.db.prepare("INSERT INTO export_jobs (id, user_id, format, status, created_at) VALUES (?, ?, 'json', 'pending', ?)")
    .run('old-pending', userId, old)
  const result = pruneHistory(api.db)
  assert.ok(result.refreshTokens >= 1)
  assert.ok(result.idempotencyKeys >= 1)
  assert.ok(result.auditEvents >= 1)
  assert.ok(result.exportJobs >= 1)
  assert.equal(api.db.prepare("SELECT COUNT(*) AS n FROM export_jobs WHERE id = 'old-pending'").get().n, 1, '未完成的导出作业不能删')
  assert.equal(api.db.prepare("SELECT COUNT(*) AS n FROM export_jobs WHERE id = 'old-export'").get().n, 0)

  // 空壳匿名账号：老且没有任何数据 → 清理；有训练记录的匿名账号保留
  const staleAnonymous = randomUUID()
  api.db.prepare("INSERT INTO users (id, type, identifier_hash, password_hash, created_at) VALUES (?, 'anonymous', ?, NULL, ?)")
    .run(staleAnonymous, `stale-${staleAnonymous}`, old)
  const activeAnonymous = randomUUID()
  api.db.prepare("INSERT INTO users (id, type, identifier_hash, password_hash, created_at) VALUES (?, 'anonymous', ?, NULL, ?)")
    .run(activeAnonymous, `active-${activeAnonymous}`, old)
  api.db.prepare('INSERT INTO training_sessions (id, client_id, user_id, date, exercise_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(randomUUID(), 'keep-session', activeAnonymous, weekStart, '深蹲', old, old)
  const prunedAgain = pruneHistory(api.db)
  assert.ok(prunedAgain.users >= 1)
  assert.equal(api.db.prepare('SELECT COUNT(*) AS n FROM users WHERE id = ?').get(staleAnonymous).n, 0)
  assert.equal(api.db.prepare('SELECT COUNT(*) AS n FROM users WHERE id = ?').get(activeAnonymous).n, 1, '有数据的匿名账号不能删')
})

test('refresh with a bad cookie is a clean 401', async () => {
  const response = await fetch(`${base}/auth/refresh`, {
    method: 'POST',
    headers: { cookie: 'twopoles_refresh=not-a-real-token' }
  })
  assert.equal(response.status, 401)
  assert.ok(response.headers.getSetCookie().some((value) => value.startsWith('twopoles_refresh=;')), '失败时清掉 refresh cookie')
})

test('a new export supersedes the previous snapshot content', async () => {
  const first = await request('/export', { method: 'POST', body: { format: 'json' } })
  await waitForExport(first.body.jobId)
  const second = await request('/export', { method: 'POST', body: { format: 'csv' } })
  assert.equal(second.status, 202)
  const gone = await request(`/export/${first.body.jobId}/download`)
  assert.equal(gone.status, 404, '只保留最新一份导出内容')
  const older = await request(`/export/${first.body.jobId}`)
  assert.equal(older.body.status, 'completed')
  assert.equal(older.body.downloadUrl, null, '内容被清掉后不再给下载地址')
})

test('rotating AUTH_SECRET does not lock existing accounts out', async () => {
  const file = join(tmpdir(), `twopoles-rotate-${randomUUID()}.sqlite`)
  const startServer = async (secret) => {
    const instance = createApiServer({ dbPath: file, secret, identifierSecret: 'stable-hash-key' })
    await new Promise((resolve) => instance.server.listen(0, '127.0.0.1', resolve))
    const { port } = instance.server.address()
    return { instance, base: `http://127.0.0.1:${port}/api/v1` }
  }
  const first = await startServer('secret-one')
  const registered = await fetch(`${first.base}/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier: 'rotate@example.com', password: 'correct-horse' })
  })
  assert.equal(registered.status, 200)
  await first.instance.close()

  const second = await startServer('secret-two')
  const login = await fetch(`${second.base}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier: 'rotate@example.com', password: 'correct-horse' })
  })
  assert.equal(login.status, 200, '只换 AUTH_SECRET 不该让老账号登不进来')
  const wrongPassword = await fetch(`${second.base}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier: 'rotate@example.com', password: 'nope' })
  })
  assert.equal(wrongPassword.status, 401)
  await second.instance.close()
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      unlinkSync(`${file}${suffix}`)
    } catch {
      // 测试收尾，文件可能已不存在
    }
  }
})

test.after(async () => {
  await api.close()
})
