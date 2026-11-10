import { http, HttpResponse } from 'msw'
import type { AuthUser } from '@/services/api/auth'
import type { RemoteSyncSnapshot } from '@/services/api/sync'
import type { Meal, MotionAnalysis, Plan, PrivacySettings, TrainingSession, UserProfile } from '@/types/domain'
import { buildWeeklyReport } from '@/services/weekRules'

/** 仅供开发联调的单账号内存适配器；测试和浏览器使用同一份 v1 契约。 */
export function createMockApi() {
  const user: AuthUser = { id: 'mock-user', type: 'anonymous', createdAt: new Date().toISOString() }
  const state = {
    authenticated: false,
    refreshable: false,
    profile: null as UserProfile | null,
    privacy: null as PrivacySettings | null,
    sessions: [] as TrainingSession[],
    meals: [] as Meal[],
    analyses: [] as MotionAnalysis[],
    plans: [] as Plan[],
    deleted: {
      sessions: [] as { id: string; clientId?: string }[],
      meals: [] as { id: string; clientId?: string }[],
      plans: [],
      analyses: [] as { id: string; clientId?: string }[]
    },
    idempotency: new Map<string, unknown>(),
    adjustments: new Map<string, { id: string; planId: string; baseVersion: number; changes: { itemId: string; newValue?: object }[] }>(),
    exports: new Map<string, { format: string; content: string }>()
  }
  const error = (status: number, code: string, message: string, detail?: unknown) => HttpResponse.json({ code, message, detail }, { status })
  const stamp = () => new Date().toISOString()
  const session = () => {
    state.authenticated = state.refreshable = true
    return HttpResponse.json({ user, userId: user.id, accessToken: 'mock-access', expiresIn: 900 })
  }
  const handlers = [http.all('*/api/v1/*', async ({ request }) => {
    const url = new URL(request.url)
    const path = url.pathname.slice('/api/v1'.length)
    const method = request.method
    const body = ['GET', 'HEAD'].includes(method) ? {} : await request.json().catch(() => ({})) as Record<string, any>
    if (path === '/auth/refresh') return state.refreshable ? session() : error(401, 'unauthorized', '会话已过期')
    if (['/auth/device', '/auth/login', '/auth/register'].includes(path)) {
      if (path !== '/auth/device') user.type = 'registered'
      return session()
    }
    if (path === '/auth/logout') {
      state.authenticated = state.refreshable = false
      return new HttpResponse(null, { status: 204 })
    }
    if (!state.authenticated || request.headers.get('authorization') !== 'Bearer mock-access') return error(401, 'unauthorized', '请先登录')
    if (path === '/auth/bind') { user.type = 'registered'; return HttpResponse.json({ user }) }
    if (path === '/profile') {
      if (method === 'PUT') state.profile = { ...state.profile, ...body, id: user.id, updatedAt: stamp() } as UserProfile
      return HttpResponse.json({ profile: state.profile })
    }
    if (path === '/settings/privacy') {
      if (method === 'PUT') state.privacy = { ...state.privacy, ...body, updatedAt: stamp() } as PrivacySettings
      return HttpResponse.json({ privacy: state.privacy })
    }
    if (path === '/sync') {
      const snapshot: RemoteSyncSnapshot = { serverTime: stamp(), profile: state.profile, privacy: state.privacy,
        sessions: state.sessions, meals: state.meals, analyses: state.analyses, plans: state.plans, modeLog: [], deleted: state.deleted }
      return HttpResponse.json(snapshot)
    }
    for (const resource of ['sessions', 'meals', 'analyses'] as const) {
      if (path === `/${resource}` && method === 'GET') return HttpResponse.json({ [resource]: state[resource] })
      const singular = resource === 'sessions' ? 'session' : resource === 'meals' ? 'meal' : 'analysis'
      if (path === `/${resource}` && method === 'POST') {
        const key = `${resource}:${request.headers.get('idempotency-key') ?? body.clientId ?? body.id}`
        const cached = state.idempotency.get(key)
        if (cached) return HttpResponse.json(cached, { status: 201 })
        const item = { ...body, id: crypto.randomUUID(), clientId: body.clientId ?? body.id, userId: user.id, updatedAt: stamp() }
        ;(state[resource] as unknown[]).push(item)
        const result = { [singular]: item }
        state.idempotency.set(key, result)
        return HttpResponse.json(result, { status: 201 })
      }
      if (path.startsWith(`/${resource}/`)) {
        const id = decodeURIComponent(path.split('/')[2])
        const index = state[resource].findIndex((item) => item.id === id || item.clientId === id)
        if (index < 0) return error(404, 'not_found', '记录不存在')
        const item = state[resource][index]
        if (method === 'DELETE') {
          state.deleted[resource].push({ id: item.id, clientId: item.clientId })
          state[resource].splice(index, 1)
          return new HttpResponse(null, { status: 204 })
        }
        if (method === 'PATCH') {
          Object.assign(item, body, { updatedAt: stamp() })
          if (resource === 'sessions') Object.assign(item, { actualDuration: body.duration, actualDistance: body.distance, completionReason: body.reason })
          return HttpResponse.json({ [singular]: item })
        }
      }
    }
    if (path === '/plans/current') return HttpResponse.json({ plan: state.plans[state.plans.length - 1] ?? null })
    if (path === '/plans' && method === 'POST') {
      const raw = body.plan as Plan
      const existing = state.plans.find((plan) => plan.clientId === (raw.clientId ?? raw.id))
      if (existing) return HttpResponse.json({ plan: existing })
      const latest = state.plans.filter((plan) => plan.weekStartDate === raw.weekStartDate && plan.mode === raw.mode).sort((a, b) => b.version - a.version)[0]
      if (latest && !request.headers.has('if-match')) return error(428, 'precondition_required', '计划写入需要 If-Match')
      if (latest && (request.headers.get('if-match') !== `"${latest.version}"` || raw.version !== latest.version + 1)) return error(409, 'conflict', '计划版本冲突', { latest })
      const plan = { ...raw, id: crypto.randomUUID(), serverId: undefined, clientId: raw.clientId ?? raw.id, updatedAt: stamp() }
      state.plans.push(plan)
      return HttpResponse.json({ plan }, { status: 201 })
    }
    if (/^\/plans\/[^/]+\/adjustments$/.test(path) && method === 'POST') {
      const id = crypto.randomUUID()
      const adjustment = { id, planId: decodeURIComponent(path.split('/')[2]), baseVersion: body.baseVersion, changes: body.changes }
      state.adjustments.set(id, adjustment)
      return HttpResponse.json({ adjustment }, { status: 201 })
    }
    if (/^\/plans\/adjustments\/[^/]+\/accept$/.test(path)) {
      const adjustment = state.adjustments.get(path.split('/')[3])
      if (!adjustment) return error(404, 'not_found', '调整不存在')
      const latest = state.plans[state.plans.length - 1]!
      if (request.headers.get('if-match') !== `"${latest.version}"` || adjustment.baseVersion !== latest.version) return error(409, 'conflict', '计划版本冲突', { latest })
      const plan = { ...latest, id: crypto.randomUUID(), version: latest.version + 1, items: latest.items.map((item) => {
        const change = adjustment.changes.find((entry) => entry.itemId === item.id)
        return !item.locked && !item.completed && change ? { ...item, ...change.newValue } : item
      }) }
      state.plans.push(plan)
      return HttpResponse.json({ plan, newVersion: plan.version, lockedPreserved: true, adjustmentId: adjustment.id })
    }
    if (path === '/reports/weekly') return HttpResponse.json({ report: buildWeeklyReport(state.sessions, state.meals,
      new Date(`${url.searchParams.get('start')}T00:00:00`), { profile: state.profile, mode: 'public' }) })
    if (path === '/export' && method === 'POST') {
      const id = crypto.randomUUID()
      state.exports.set(id, { format: body.format, content: JSON.stringify({ profile: state.profile, sessions: state.sessions, meals: state.meals, plans: state.plans }) })
      return HttpResponse.json({ jobId: id, format: body.format, status: 'pending' }, { status: 202 })
    }
    if (path.startsWith('/export/')) {
      const id = path.split('/')[2]
      const job = state.exports.get(id)
      if (!job) return error(404, 'not_found', '导出不存在')
      if (path.endsWith('/download')) return new HttpResponse(job.content, { headers: { 'content-type': 'application/json' } })
      return HttpResponse.json({ jobId: id, format: job.format, status: 'completed', downloadUrl: `/api/v1/export/${id}/download` })
    }
    if (['/data/wipe', '/auth/delete-account'].includes(path)) {
      if (!body.confirmToken) return HttpResponse.json({ confirmToken: 'mock-confirm', expiresIn: 300 }, { status: 202 })
      if (body.confirmToken !== 'mock-confirm') return error(400, 'validation_failed', '确认令牌无效')
      state.profile = state.privacy = null
      state.sessions = []; state.meals = []; state.plans = []
      state.exports.clear(); state.idempotency.clear(); state.adjustments.clear()
      if (path.endsWith('delete-account')) state.authenticated = state.refreshable = false
      return new HttpResponse(null, { status: 204 })
    }
    return error(404, 'not_found', 'Mock 未定义此接口')
  })]
  return { handlers, state }
}

export const mockApi = createMockApi()
export const handlers = mockApi.handlers
