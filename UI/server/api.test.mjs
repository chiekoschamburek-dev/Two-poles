import test from 'node:test'
import assert from 'node:assert/strict'
import { createApiServer } from './app.mjs'

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

test.after(async () => {
  await api.close()
})
