import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { createPinia, setActivePinia } from 'pinia'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { createMockApi } from '@/mocks/handlers'
import { useAppStore } from '@/stores/app'
import { addConflict, bootstrapSync, clearAllConflicts, configureSync, deviceLogin, enqueueSync, flushOutbox, logout, syncNow, syncState } from '@/services/sync'
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

test('换账号后不再把上一个账号的记录入队', async () => {
  clearOutbox()
  const me = syncState.user!.id
  // 模拟换号：这台设备上次登录的是另一个账号
  syncState.adoptingLocalData = false
  const foreign = { ...meal('foreign-meal'), userId: 'other-account' }
  assert.equal(enqueueSync('meal.create', foreign.clientId!, foreign), false)
  assert.equal(listOutbox().some((op) => op.clientId === 'foreign-meal'), false)
  assert.equal(enqueueSync('session.create', 'foreign-session', { clientId: 'foreign-session', userId: 'other-account' }), false)
  const own = { ...meal('own-meal'), userId: me }
  assert.equal(enqueueSync('meal.create', own.clientId!, own), true, '当前账号自己的记录照常上传')
  clearOutbox()
  syncState.adoptingLocalData = true
})

test('换账号后隐藏其它账号的记录，并可显式并入当前账号', async () => {
  // 直接写存储构造一条“上一个账号”的本机记录，再重新初始化 store
  const foreignSession = {
    id: 'foreign-session-1',
    clientId: 'foreign-session-1',
    userId: 'other-account',
    date: '2026-11-03',
    exerciseName: '深蹲',
    type: '其他' as const,
    completionStatus: 'completed' as const,
    createdAt: new Date().toISOString(),
    _sync: 'pending' as const
  }
  mem.set('twopoles.v1.sessions', JSON.stringify([foreignSession]))
  setActivePinia(createPinia())
  const store = useAppStore()
  store.init()
  await bootstrapSync()
  syncState.adoptingLocalData = false

  assert.equal(store.sessions.some((item) => item.userId === 'other-account'), false, '换账号后不展示上一个账号的记录')
  assert.equal(store.foreignRecordCount, 1)
  assert.equal(store.adoptForeignRecords(), 1)
  assert.equal(store.foreignRecordCount, 0)
  assert.ok(store.sessions.every((item) => item.userId === syncState.user!.id))
  syncState.adoptingLocalData = true
})

test('换账号不会把上一个账号的档案写进当前账号', async () => {
  // A 的档案更新时间比 B 更晚，确保不是靠时间戳比较“碰巧”挡住的
  const later = new Date(Date.now() + 60_000).toISOString()
  mem.set('twopoles.v1.profile', JSON.stringify({
    id: 'other-account',
    age: 41,
    nickname: 'A 的档案',
    goal: '增肌',
    experience: '规律训练',
    availableTimes: [],
    equipment: [],
    restrictions: [],
    updatedAt: later
  }))
  mem.set('twopoles.v1.syncOwner', JSON.stringify('other-account'))
  mem.delete('twopoles.v1.syncMeta')
  mock.state.profile = null
  setActivePinia(createPinia())
  const store = useAppStore()
  store.init()
  await bootstrapSync()

  assert.equal(store.userProfile, null, '换账号后不展示上一个账号的档案')
  await syncNow()
  assert.equal(mock.state.profile, null, '不能把上一个账号的档案上传到当前账号')

  store.updateProfile({ age: 30, nickname: 'B 的档案' })
  await syncNow()
  assert.equal(mock.state.profile?.nickname, 'B 的档案', 'B 自己的档案照常同步')
  assert.equal(store.userProfile?.id, syncState.user!.id)
})

test('计划冲突可以合并本机的完成状态', async () => {
  const store = useAppStore()
  const plan = store.ensureWeekPlan(new Date(2027, 5, 7))
  const [first, second] = plan.items
  store.markItemCompleted(plan.id, first.id, true)
  const clientId = plan.clientId!
  // 服务端最新版本：完成的是另一项，本机这一项在它上面还是未完成
  const serverVersion = {
    ...plan,
    clientId: 'server-version',
    items: plan.items.map(item => ({ ...item, completed: item.id === second.id }))
  }
  addConflict('plan', clientId, '计划版本冲突', serverVersion)
  assert.equal(store.mergeConflictPlan(clientId), true)
  const merged = store.plans.find(item => item.id === plan.id)!
  assert.equal(merged.version, serverVersion.version + 1)
  assert.equal(merged.items.find(item => item.id === first.id)?.completed, true, '本机完成的项保留')
  assert.equal(merged.items.find(item => item.id === second.id)?.completed, true, '服务端完成的项也保留')
  assert.equal(syncState.conflicts.some(item => item.id === `plan:${clientId}`), false)
  clearOutbox()
})

test('冲突记录可以另存为新记录重新上传', async () => {
  const store = useAppStore()
  const local = store.addSession({
    date: '2026-11-03',
    exerciseName: '硬拉',
    type: '其他',
    completionStatus: 'completed',
    actualDuration: 10
  })
  const oldClientId = local.clientId!
  addConflict('session', oldClientId, '测试冲突')
  assert.equal(local._sync, 'conflict')
  assert.equal(store.resaveConflictRecord('session', oldClientId), true)
  assert.notEqual(local.clientId, oldClientId)
  assert.equal(local._sync, 'pending')
  assert.equal(syncState.conflicts.some(item => item.id === `session:${oldClientId}`), false)
  clearOutbox()
})
