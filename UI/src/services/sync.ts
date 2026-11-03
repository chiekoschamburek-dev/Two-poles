import { reactive } from 'vue'
import type { Meal, Plan, PlanChange, PrivacySettings, SessionFeedback, TrainingSession, UserProfile } from '@/types/domain'
import { ApiError, apiEnabled, clearAccessToken } from './api/http'
import * as authApi from './api/auth'
import type { AuthUser } from './api/auth'
import * as profileApi from './api/profile'
import * as sessionsApi from './api/sessions'
import * as mealsApi from './api/meals'
import * as plansApi from './api/plans'
import * as settingsApi from './api/settings'
import * as remoteSync from './api/sync'
import type { RemoteSyncSnapshot } from './api/sync'
import { clearOutbox, enqueue, listOutbox, pendingCount, removeOp, setOpInFlight, updateOp } from './outbox'
import type { OutboxKind, OutboxOp } from './outbox'
import { clearSyncMeta, readSyncConflicts, readSyncMeta, writeSyncConflicts, writeSyncMeta } from './storage'

export type SyncStatus = 'local' | 'idle' | 'syncing' | 'offline' | 'error' | 'unauthorized'

export interface SyncConflict {
  id: string
  kind: 'session' | 'meal' | 'plan' | 'profile'
  clientId: string
  message: string
  at: string
  latestPlan?: Plan
}

export interface UploadBatch {
  profile: UserProfile | null
  privacy: PrivacySettings | null
  sessions: TrainingSession[]
  meals: Meal[]
  plans: Plan[]
}

export interface SyncHandlers {
  getUploadBatch: (firstSync: boolean) => UploadBatch
  applyRemote: (snapshot: RemoteSyncSnapshot) => void
  markProfileSynced: (profile: UserProfile, uploadedAt?: string) => void
  markPrivacySynced: (privacy: PrivacySettings, uploadedAt?: string) => void
  markSessionSynced: (clientId: string, session: TrainingSession, pending: boolean) => void
  markMealSynced: (clientId: string, meal: Meal, pending: boolean) => void
  markPlanSynced: (clientId: string, plan: Plan, pending: boolean) => void
  markConflict: (kind: SyncConflict['kind'], clientId: string, message: string) => void
}

export const syncState = reactive({
  apiEnabled,
  status: (apiEnabled ? 'idle' : 'local') as SyncStatus,
  user: null as AuthUser | null,
  lastSyncAt: '',
  lastRemoteProfileAt: '',
  lastRemotePrivacyAt: '',
  error: '',
  conflicts: [] as SyncConflict[],
  pending: 0
})

let handlers: SyncHandlers | null = null
let syncPromise: Promise<void> | null = null
let scheduled: ReturnType<typeof setTimeout> | null = null
let retryTimer: ReturnType<typeof setTimeout> | null = null
let retryAttempt = 0
let listenersBound = false
let maintenance = false

function cancelScheduledSync() {
  if (scheduled) clearTimeout(scheduled)
  scheduled = null
  resetRetry()
}

function persistConflicts() {
  writeSyncConflicts(syncState.conflicts)
}

function loadConflicts() {
  syncState.conflicts = readSyncConflicts<SyncConflict>().filter((item) => item && typeof item.id === 'string')
}

export function addConflict(kind: SyncConflict['kind'], clientId: string, message: string, latestPlan?: Plan) {
  const at = new Date().toISOString()
  const id = `${kind}:${clientId}`
  syncState.conflicts = [
    { id, kind, clientId, message, at, latestPlan },
    ...syncState.conflicts.filter((item) => item.id !== id)
  ].slice(0, 50)
  persistConflicts()
  handlers?.markConflict(kind, clientId, message)
}

export function clearConflict(id: string) {
  syncState.conflicts = syncState.conflicts.filter((item) => item.id !== id)
  persistConflicts()
}

export function retryConflict(conflict: SyncConflict) {
  for (const op of listOutbox()) {
    if (op.clientId === conflict.clientId && op.status === 'failed') updateOp(op.id, {
      status: 'pending', attempts: 0, nextAt: new Date().toISOString(), error: undefined
    })
  }
  clearConflict(conflict.id)
  resetRetry()
  scheduleSync(0)
}

export function clearAllConflicts() {
  syncState.conflicts = []
  persistConflicts()
}

function bindNetworkListeners() {
  if (listenersBound || typeof window === 'undefined') return
  listenersBound = true
  window.addEventListener('online', () => {
    if (syncState.user) void syncNow()
  })
  window.addEventListener('offline', () => {
    if (syncState.user) syncState.status = 'offline'
  })
}

export function configureSync(next: SyncHandlers) {
  handlers = next
}

export async function bootstrapSync() {
  if (!apiEnabled) {
    syncState.status = 'local'
    return
  }
  bindNetworkListeners()
  loadConflicts()
  syncState.pending = pendingCount()
  const meta = readSyncMeta()
  const restored = await authApi.refresh()
  if (!restored) {
    syncState.status = 'idle'
    return
  }
  syncState.user = restored.user
  syncState.lastSyncAt = meta && meta.userId === restored.user.id ? meta.lastSyncAt : ''
  syncState.status = 'idle'
  await syncNow()
}

async function afterAuth(result: authApi.AuthResult) {
  syncState.user = result.user
  syncState.error = ''
  syncState.status = 'idle'
  syncState.lastSyncAt = ''
  syncState.lastRemoteProfileAt = ''
  syncState.lastRemotePrivacyAt = ''
  syncState.conflicts = []
  persistConflicts()
  clearSyncMeta()
  resetRetry()
  await syncNow()
}

export async function register(identifier: string, password: string) {
  await syncPromise
  await afterAuth(await authApi.register(identifier, password))
}

export async function login(identifier: string, password: string) {
  await syncPromise
  await afterAuth(await authApi.login(identifier, password))
}

export async function deviceLogin() {
  await syncPromise
  await afterAuth(await authApi.device())
}

export async function bindAccount(identifier: string, password: string) {
  const user = await authApi.bind(identifier, password)
  syncState.user = user
  return user
}

export async function logout() {
  await syncPromise
  cancelScheduledSync()
  await authApi.logout()
  resetRetry()
  syncState.user = null
  syncState.lastSyncAt = ''
  syncState.lastRemoteProfileAt = ''
  syncState.lastRemotePrivacyAt = ''
  syncState.status = apiEnabled ? 'idle' : 'local'
  syncState.error = ''
  syncState.conflicts = []
  syncState.pending = 0
  clearSyncMeta()
  clearOutbox()
  persistConflicts()
}

export function enqueueSync(kind: OutboxKind, clientId: string, payload: unknown): boolean {
  if (!apiEnabled || !syncState.user) return false
  try {
    enqueue(kind, clientId, payload)
  } catch (error) {
    syncState.status = 'error'
    syncState.error = error instanceof Error ? error.message : '同步队列写入失败'
    return false
  }
  syncState.pending = pendingCount()
  scheduleSync()
  return true
}

export function scheduleSync(delay = 800) {
  if (!apiEnabled || !syncState.user || maintenance) return
  if (scheduled) clearTimeout(scheduled)
  scheduled = setTimeout(() => {
    scheduled = null
    void syncNow()
  }, delay)
}

function isRetryable(error: unknown): boolean {
  if (error instanceof ApiError) return error.status === 0 || error.status === 429 || error.status >= 500
  return error instanceof TypeError || (error instanceof DOMException && ['AbortError', 'TimeoutError'].includes(error.name))
}

function scheduleRetry() {
  if (!apiEnabled || !syncState.user || retryAttempt >= 5) return
  if (retryTimer) clearTimeout(retryTimer)
  const delay = Math.min(60_000, 2_000 * Math.pow(2, retryAttempt))
  retryAttempt += 1
  retryTimer = setTimeout(() => {
    retryTimer = null
    void syncNow()
  }, delay)
}

function resetRetry() {
  retryAttempt = 0
  if (retryTimer) {
    clearTimeout(retryTimer)
    retryTimer = null
  }
}

function retryDelay(attempts: number): string {
  const seconds = Math.min(60, Math.pow(2, Math.max(0, attempts)) * 1)
  return new Date(Date.now() + seconds * 1000).toISOString()
}

function conflictKind(op: OutboxOp): SyncConflict['kind'] {
  if (op.kind.startsWith('session')) return 'session'
  if (op.kind.startsWith('meal')) return 'meal'
  if (op.kind.startsWith('plan')) return 'plan'
  return 'profile'
}

async function executeOp(op: OutboxOp): Promise<void> {
  const hasNewer = () => listOutbox().some((item) => item.id !== op.id && item.clientId === op.clientId && item.kind.split('.')[0] === op.kind.split('.')[0])
  switch (op.kind) {
    case 'profile.update': {
      const remote = await profileApi.putProfile(op.payload as UserProfile)
      handlers?.markProfileSynced(remote, (op.payload as UserProfile).updatedAt)
      return
    }
    case 'privacy.update': {
      const remote = await settingsApi.putPrivacy(op.payload as Partial<PrivacySettings>)
      handlers?.markPrivacySynced(remote, (op.payload as PrivacySettings).updatedAt)
      return
    }
    case 'session.create': {
      const remote = await sessionsApi.create(op.payload as TrainingSession)
      handlers?.markSessionSynced(op.clientId, remote, hasNewer())
      return
    }
    case 'session.feedback': {
      const payload = op.payload as { session: TrainingSession; feedback: SessionFeedback }
      const remote = await sessionsApi.feedback(payload.session, payload.feedback)
      handlers?.markSessionSynced(op.clientId, remote, hasNewer())
      return
    }
    case 'session.delete': {
      try {
        await sessionsApi.remove(op.payload as TrainingSession)
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 404) throw error
      }
      return
    }
    case 'meal.create': {
      const remote = await mealsApi.create(op.payload as Meal)
      handlers?.markMealSynced(op.clientId, remote, hasNewer())
      return
    }
    case 'meal.update': {
      const remote = await mealsApi.update(op.payload as Meal)
      handlers?.markMealSynced(op.clientId, remote, hasNewer())
      return
    }
    case 'meal.delete': {
      try {
        await mealsApi.remove(op.payload as Meal)
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 404) throw error
      }
      return
    }
    case 'plan.create': {
      const plan = op.payload as Plan
      const remote = await plansApi.create(plan)
      handlers?.markPlanSynced(op.clientId, remote, hasNewer())
      return
    }
    case 'plan.adjustment': {
      const payload = op.payload as { plan: Plan; baseVersion: number; changes: PlanChange[]; reason: string }
      const adjustment = await plansApi.createAdjustment(payload.plan, payload.baseVersion, payload.changes, payload.reason, op.id)
      const accepted = await plansApi.acceptAdjustment(adjustment.id, payload.baseVersion)
      handlers?.markPlanSynced(op.clientId, accepted.plan, hasNewer())
      return
    }
  }
}

export async function flushOutbox() {
  if (!apiEnabled || !syncState.user) return
  const now = Date.now()
  for (const op of listOutbox()) {
    if (op.status === 'failed') continue
    if (Date.parse(op.nextAt) > now) continue
    try {
      // 循环快照中的操作可能已被用户的新输入合并替换。
      if (!listOutbox().some((item) => item.id === op.id)) continue
      setOpInFlight(op.id, true)
      await executeOp(op)
      removeOp(op.id)
      syncState.error = ''
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        syncState.status = 'unauthorized'
        syncState.error = '登录已过期，请重新登录后再同步'
        break
      }
      if (error instanceof ApiError && error.code === 'conflict') {
        addConflict(conflictKind(op), op.clientId, error.message, (error.detail as { latest?: Plan } | undefined)?.latest)
        removeOp(op.id)
        continue
      }
      if (isRetryable(error)) {
        const attempts = op.attempts + 1
        const message = error instanceof Error ? error.message : '网络请求失败'
        if (attempts >= 5) {
          updateOp(op.id, { status: 'failed', attempts, error: message, nextAt: retryDelay(attempts) })
          addConflict(conflictKind(op), op.clientId, `同步失败：${message}`)
        } else {
          updateOp(op.id, { attempts, error: message, nextAt: retryDelay(attempts) })
          syncState.status = 'offline'
          syncState.error = message
          scheduleRetry()
        }
        break
      }
      const message = error instanceof Error ? error.message : '同步被服务器拒绝'
      updateOp(op.id, { status: 'failed', attempts: op.attempts + 1, error: message, nextAt: retryDelay(op.attempts + 1) })
      addConflict(conflictKind(op), op.clientId, message)
    } finally {
      setOpInFlight(op.id, false)
    }
  }
  syncState.pending = pendingCount()
}

function pushLocal(firstSync: boolean) {
  const batch = handlers?.getUploadBatch(firstSync)
  if (!batch) return
  const queued = listOutbox()
  const has = (prefix: string, clientId: string) => queued.some((op) => op.kind.startsWith(prefix) && op.clientId === clientId)
  if (batch.profile && !has('profile.', batch.profile.id)) enqueue('profile.update', batch.profile.id, batch.profile)
  if (batch.privacy && !has('privacy.', 'privacy')) enqueue('privacy.update', 'privacy', batch.privacy)
  for (const session of batch.sessions) {
    const id = session.clientId ?? session.id
    if (has('session.', id)) continue
    if (!session.serverId) enqueue('session.create', id, session)
    else enqueue('session.feedback', id, { session, feedback: {
      sessionId: session.id, duration: session.actualDuration, distance: session.actualDistance, rpe: session.rpe,
      discomfort: session.discomfort, reason: session.completionReason, notes: session.notes
    } })
  }
  for (const meal of batch.meals) {
    const id = meal.clientId ?? meal.id
    if (!has('meal.', id)) enqueue(meal.serverId ? 'meal.update' : 'meal.create', id, meal)
  }
  for (const plan of batch.plans) {
    const id = plan.clientId ?? plan.id
    if (!has('plan.', id)) enqueue('plan.create', id, plan)
  }
  syncState.pending = pendingCount()
}

export async function syncNow(): Promise<void> {
  if (!apiEnabled || !syncState.user || maintenance) return
  if (syncPromise) return syncPromise
  syncState.status = 'syncing'
  syncState.error = ''
  syncPromise = (async () => {
    try {
      const firstSync = !syncState.lastSyncAt
      const snapshot = await remoteSync.pull(syncState.lastSyncAt || undefined)
      if (snapshot.profile) syncState.lastRemoteProfileAt = snapshot.profile.updatedAt ?? ''
      if (snapshot.privacy) syncState.lastRemotePrivacyAt = snapshot.privacy.updatedAt ?? ''
      handlers?.applyRemote(snapshot)
      pushLocal(firstSync)
      syncState.lastSyncAt = snapshot.serverTime
      writeSyncMeta({ lastSyncAt: snapshot.serverTime, userId: syncState.user!.id })
      await flushOutbox()
      if (syncState.status === 'syncing') {
        syncState.status = typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'idle'
      }
      if (syncState.status === 'idle') {
        if (syncState.pending > 0) scheduleRetry()
        else resetRetry()
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        syncState.status = 'unauthorized'
        syncState.error = '登录已过期，请重新登录后再同步'
      } else {
        syncState.status = typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'error'
        syncState.error = error instanceof Error ? error.message : '同步失败'
        if (isRetryable(error)) scheduleRetry()
      }
    } finally {
      syncState.pending = pendingCount()
      syncPromise = null
    }
  })()
  return syncPromise
}

export async function exportRemote(format: 'json' | 'csv'): Promise<{ blob: Blob; filename: string }> {
  let job = await settingsApi.createExport(format)
  for (let i = 0; i < 40 && job.status === 'pending'; i++) {
    await new Promise((resolve) => setTimeout(resolve, 250))
    job = await settingsApi.getExport(job.jobId)
  }
  if (job.status !== 'completed') throw new Error(job.error || '导出任务未完成')
  const blob = await settingsApi.downloadExport(job.jobId)
  const stamp = new Date().toISOString().slice(0, 10)
  return { blob, filename: `twopoles-${stamp}.${format}` }
}

export async function wipeRemote(): Promise<void> {
  maintenance = true
  cancelScheduledSync()
  try {
    await syncPromise
    const confirmation = await settingsApi.requestWipe()
    await settingsApi.confirmWipe(confirmation.confirmToken)
    clearOutbox()
    syncState.pending = 0
    clearSyncMeta()
    syncState.lastSyncAt = ''
    syncState.lastRemoteProfileAt = ''
    syncState.lastRemotePrivacyAt = ''
  } finally {
    maintenance = false
  }
}

export async function deleteRemoteAccount(): Promise<void> {
  maintenance = true
  cancelScheduledSync()
  try {
    await syncPromise
    const confirmation = await settingsApi.requestDeleteAccount()
    await settingsApi.confirmDeleteAccount(confirmation.confirmToken)
    clearAccessToken()
    syncState.user = null
    syncState.lastSyncAt = ''
    syncState.lastRemoteProfileAt = ''
    syncState.lastRemotePrivacyAt = ''
    syncState.status = apiEnabled ? 'idle' : 'local'
    syncState.pending = 0
    syncState.conflicts = []
    resetRetry()
    clearOutbox()
    clearSyncMeta()
    persistConflicts()
  } finally {
    maintenance = false
  }
}

export function refreshPending() {
  syncState.pending = pendingCount()
}
