import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { createPinia, setActivePinia } from 'pinia'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { createMockApi } from '@/mocks/handlers'
import { useAppStore } from '@/stores/app'
import { bootstrapSync, clearAllConflicts, configureSync, deviceLogin, flushOutbox, logout, syncNow, syncState } from '@/services/sync'
import { clearOutbox, enqueue, listOutbox, updateOp } from '@/services/outbox'
import { ApiError, clearAccessToken, request, setAccessToken } from '@/services/api/http'
import * as mealsApi from '@/services/api/meals'
import type { Meal } from '@/types/domain'

const mem = new Map<string, string>()
globalThis.localStorage = {
  getItem: (key: string) => mem.get(key) ?? null,
  setItem: (key: string, value: string) => { mem.set(key, value) },
  removeItem: (key: string) => { mem.delete(key) }
} as Storage
globalThis.document = { documentElement: { dataset: {} } } as unknown as Document
const mock = createMockApi()
const server = setupServer(...mock.handlers)
server.listen({ onUnhandledRequest: 'bypass' })
after(async () => { await logout(); server.close() })
const meal = (id: string): Meal => ({ id, clientId: id, userId: 'mock-user', date: '2026-11-03',
  time: '12:00', mealType: 'lunch', completeness: 'unknown', analyzed: false, createdAt: new Date().toISOString(),
  items: [{ id: 'rice', mealId: id, foodName: '米饭', foodId: '', category: '谷薯类', confirmed: true, source: 'manual' }] })

test('MSW v1: authentication, idempotency and a single 401 refresh', async () => {
  await deviceLogin()
  const first = await mealsApi.create(meal('idem'))
  const second = await mealsApi.create(meal('idem'))
  assert.equal(first.id, second.id)
  assert.equal(mock.state.meals.length, 1)
  clearAccessToken()
  assert.equal((await mealsApi.list()).length, 1, '401 后自动刷新并重放一次')
  mock.state.refreshable = false
  clearAccessToken()
  await assert.rejects(() => request('/meals'), (error: unknown) => error instanceof ApiError && error.status === 401)
  mock.state.refreshable = true
  setAccessToken('mock-access')
})

test('sync preserves queued writes and retry attempts instead of recreating them', async () => {
  clearOutbox()
  const local = meal('retry')
  configureSync({ getUploadBatch: () => ({ profile: null, privacy: null, sessions: [], meals: [local], plans: [] }),
    applyRemote: () => {}, markProfileSynced: () => {}, markPrivacySynced: () => {}, markSessionSynced: () => {},
    markMealSynced: () => {}, markPlanSynced: () => {}, markConflict: () => {} })
  enqueue('meal.create', local.id, local)
  server.use(http.post('http://twopoles.test/api/v1/meals', () => HttpResponse.error()))
  await syncNow()
  assert.equal(listOutbox()[0].attempts, 1)
  const opId = listOutbox()[0].id
  for (let attempt = 2; attempt <= 5; attempt++) {
    updateOp(opId, { nextAt: new Date(0).toISOString() })
    await syncNow()
    assert.equal(listOutbox()[0].id, opId)
    assert.equal(listOutbox()[0].attempts, attempt)
  }
  assert.equal(listOutbox()[0].status, 'failed')
  await syncNow()
  assert.equal(listOutbox()[0].status, 'failed', '失败队列不得被后台重新入队重置')
  assert.ok(syncState.conflicts.length)
  server.resetHandlers()
  clearOutbox(); clearAllConflicts()
})

test('editing during an in-flight create preserves a separate update and pending state', async () => {
  let release!: () => void
  let entered!: () => void
  const waiting = new Promise<void>((resolve) => { entered = resolve })
  const gate = new Promise<void>((resolve) => { release = resolve })
  server.use(http.post('http://twopoles.test/api/v1/meals', async ({ request }) => {
    const body = await request.json() as Meal
    entered(); await gate
    const remote = { ...body, id: 'server-inflight', serverId: 'server-inflight' }
    mock.state.meals.push(remote)
    return HttpResponse.json({ meal: remote }, { status: 201 })
  }))
  let pending = false
  configureSync({ getUploadBatch: () => ({ profile: null, privacy: null, sessions: [], meals: [], plans: [] }),
    applyRemote: () => {}, markProfileSynced: () => {}, markPrivacySynced: () => {}, markSessionSynced: () => {},
    markMealSynced: (_id, _remote, nextPending) => { pending = nextPending }, markPlanSynced: () => {}, markConflict: () => {} })
  const local = meal('inflight')
  enqueue('meal.create', local.id, local)
  const flushing = flushOutbox()
  await waiting
  enqueue('meal.update', local.id, { ...local, time: '13:00' })
  release(); await flushing
  assert.equal(pending, true)
  assert.equal(listOutbox().length, 1)
  assert.equal(listOutbox()[0].kind, 'meal.update')
  server.resetHandlers()
  await flushOutbox()
  assert.equal(mock.state.meals.find((item) => item.clientId === local.id)?.time, '13:00')
  assert.equal(listOutbox().length, 0)
})

test('store: offline creation, reconnect and delete survive synchronization', async () => {
  setActivePinia(createPinia())
  const store = useAppStore()
  store.init()
  await bootstrapSync()
  const input = { date: '2026-11-03', mealType: 'lunch' as const, time: '12:00',
    items: [{ foodName: '米饭', category: '谷薯类' as const, confirmed: true, source: 'manual' as const }] }
  server.use(http.post('http://twopoles.test/api/v1/meals', () => HttpResponse.error()))
  const local = store.addMeal(input)
  await syncNow()
  assert.equal(local._sync, 'pending')
  const queued = listOutbox().find((op) => op.clientId === local.clientId)!
  server.resetHandlers()
  updateOp(queued.id, { nextAt: new Date(0).toISOString() })
  await syncNow()
  assert.equal(local._sync, 'synced')
  assert.equal(mock.state.meals.filter((item) => item.clientId === local.clientId).length, 1)
  const originalSetItem = localStorage.setItem
  localStorage.setItem = (key, value) => {
    if (key.endsWith('.outbox')) throw new DOMException('Quota exceeded', 'QuotaExceededError')
    originalSetItem(key, value)
  }
  store.removeMeal(local.id)
  assert.ok(store.meals.some((item) => item.clientId === local.clientId), '删除无法入队时保留原记录')
  assert.ok(syncState.error.includes('队列写入失败'))
  localStorage.setItem = originalSetItem
  store.removeMeal(local.id)
  await syncNow()
  assert.ok(!store.meals.some((item) => item.clientId === local.clientId), '拉取不得复活待删除记录')
  assert.ok(!mock.state.meals.some((item) => item.clientId === local.clientId))
})

test('store: plan completion, adjustments and regeneration persist as distinct versions', async () => {
  const store = useAppStore()
  store.updateProfile({ age: 30, goal: '保持活力', experience: '偶尔运动', availableTimes: ['20 分钟'],
    equipment: ['无器材', '椅子'], availableVenues: ['宿舍或家'], restrictions: [] })
  const plan = store.ensureWeekPlan(new Date(2026, 10, 3))
  await syncNow()
  assert.equal(plan._sync, 'synced')
  const item = plan.items[0]
  store.markItemCompleted(plan.id, item.id, true)
  await syncNow()
  assert.equal(plan.version, 2)
  assert.equal(mock.state.plans[1].items.find((row) => row.id === item.id)?.completed, true)
  store.markItemCompleted(plan.id, item.id, false)
  await syncNow()
  store.acceptAdjustment(plan.id, [{ itemId: item.id, type: 'changed', newValue: { plannedDuration: 8 } }], '调整时长')
  await syncNow()
  assert.equal(plan._sync, 'synced')
  assert.equal(mock.state.plans[mock.state.plans.length - 1].version, 4)
  assert.equal(mock.state.plans[mock.state.plans.length - 1].items.find((row) => row.id === item.id)?.plannedDuration, 8)
  const fresh = store.regenerateWeekPlan(new Date(2026, 10, 3))!
  await syncNow()
  assert.equal(fresh.version, 5)
  assert.equal(fresh._sync, 'synced')
  assert.equal(mock.state.plans.length, 5)
  assert.equal(mock.state.plans[0].version, 1, '旧版本不覆盖')
})

test('store: clearing optional profile fields clears their saved account values', async () => {
  const store = useAppStore()
  store.updateProfile({ age: 30, nickname: '测试档案', height: 172, targetEvent: '测试比赛' })
  await syncNow()
  assert.equal(mock.state.profile?.nickname, '测试档案')
  assert.equal(mock.state.profile?.height, 172)
  assert.equal(mock.state.profile?.targetEvent, '测试比赛')

  store.updateProfile({ nickname: undefined, height: undefined, targetEvent: undefined })
  await syncNow()
  assert.equal(mock.state.profile?.nickname, null)
  assert.equal(mock.state.profile?.height, null)
  assert.equal(mock.state.profile?.targetEvent, null)
  assert.equal(mock.state.profile?.age, 30)
})
