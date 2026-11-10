import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { AdjustmentResolutions, FoodCategory, Meal, MealItem, MealType, MotionAnalysis, Plan, PlanChange, UserProfile, Toast, TrainingSession, SessionFeedback, PrivacySettings, SpeechSettings, PlanItem, ThemePreference, ModelEnergyEstimate } from '@/types/domain'
import { newId } from '@/utils/id'
import { analyzeMeal, deriveCompleteness } from '@/services/mealRules'
import { estimateEnergy, unitKey } from '@/services/foodComposition'
import type { EnergyEstimate } from '@/services/foodComposition'
import { clearMealPhotos, deleteMealPhoto } from '@/services/mealPhotos'
import { clearAnalysisKeyframes, deleteAnalysisKeyframes } from '@/services/analysisKeyframes'
import { AUTO_RECOMMEND_MIN_AGE, buildDayPlan, PLAN_RULES_VERSION, PLAN_VERSION } from '@/services/planRules'
import { findExercise, gateReason } from '@/services/exercises'
import { buildPlanFeedbackMessages, validatePlanFeedback } from '@/services/planFeedback'
import { normalizeProfile } from '@/services/profileRules'
import {
  NO_LLM_DEFAULT,
  buildPlanMessages,
  buildPlanQuestionMessages,
  callPlanProxy,
  canUseLlm,
  desiredWeeklySessions,
  extractJson,
  fetchLlmStatus,
  loadLlmConfig,
  readPlanImage,
  saveLlmConfig,
  validatePlanDraft,
  validatePlanQuestions
} from '@/services/llm'
import type { LlmConfig, LlmDefaultStatus, PlanDraft, PlanDraftState, PlanSourceInput } from '@/services/llm'
import { weekDates, weekStart } from '@/services/weekRules'
import { WELLNESS_DISMISS_KEY } from '@/services/wellnessCards'
import { toISODate } from '@/utils/time'
import { clearStoredState, loadStoredState, saveStoredState, clearSyncMeta } from '@/services/storage'
import { addConflict, bootstrapSync, clearAllConflicts, configureSync, enqueueSync, refreshPending, syncState } from '@/services/sync'
import { listOutbox, removeOp } from '@/services/outbox'
import type { UploadBatch } from '@/services/sync'
import type { RemoteSyncSnapshot } from '@/services/api/sync'

export interface NewMealInput {
  date: string
  mealType: MealType
  time: string
  items: {
    foodName: string
    category: FoodCategory
    portionSize?: number
    portionUnit?: string
    source?: 'manual' | 'photo'
    photoConfidence?: number
    uncertain?: boolean
    userConfirmed?: boolean
    modelEnergy?: ModelEnergyEstimate
  }[]
  /** 仅本机保存的压缩缩略图；不传则只保存识别结果 */
  photoThumb?: string
  /** 本机原图在 IndexedDB 里的 key */
  photoId?: string
}

export const useAppStore = defineStore('app', () => {
  // === State ===
  const userProfile = ref<UserProfile | null>(null)
  const sessions = ref<TrainingSession[]>([])
  const meals = ref<Meal[]>([])
  const analyses = ref<MotionAnalysis[]>([])
  const privacy = ref<PrivacySettings>({
    cameraEnabled: true,
    saveVideoLocally: false,
    dataRetentionDays: 90,
    exportFormat: 'json',
    showEnergyEstimate: false,
    saveFoodPhotoLocally: true
  })
  /** F19 语音节奏播报：默认关闭，避免与读屏的 aria-live 双声道同时发声（plan.md §4.4） */
  const speech = ref<SpeechSettings>({ enabled: false, voiceURI: '' })
  const toasts = ref<Toast[]>([])
  const initialized = ref(false)
  /** 被用户收起的解释/洞察类卡片 id。调研结论：这类卡片必须可隐藏，不能常驻占位 */
  const collapsedCards = ref<string[]>([])
  const themePref = ref<ThemePreference>('system')
  const darkMedia = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null
  /** 每周一份当前计划（含版本）；被替换掉的旧版本进 planHistory，永不静默覆盖 */
  const plans = ref<Plan[]>([])
  const planHistory = ref<Plan[]>([])
  /** 本机自定的"1 单位 = 几克"，key 见 unitKey()；没填的单位退回演示假设 */
  const unitGrams = ref<Record<string, number>>({})
  /** 已接受/已暂不调整的计划建议；避免同一条证据反复弹卡 */
  const adjustmentResolutions = ref<AdjustmentResolutions>({})
  /** 存储写满只提示一次，避免每次操作都弹同一个错误 */
  let quotaWarned = false

  // === Computed ===
  const hasProfile = computed(() => !!userProfile.value)

  // === Actions ===

  /** 把偏好解析成实际主题并落到 &lt;html data-theme&gt;；index.html 里有一份同逻辑的首帧前版本 */
  function applyTheme() {
    const dark = themePref.value === 'dark' || (themePref.value === 'system' && !!darkMedia?.matches)
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  }

  function setTheme(pref: ThemePreference) {
    themePref.value = pref
    applyTheme()
    persistState()
  }

  /**
   * Initialize app from localStorage
   */
  function init() {
    applyTheme()
    // 模型配置单独存一个 key，和 state 分开；读不出来也不影响其余功能
    llmConfig.value = loadLlmConfig()
    void refreshLlmStatus()
    darkMedia?.addEventListener?.('change', applyTheme)
    const data = loadStoredState()
    // 旧档案没有 PB / 极限数组：在这里补齐，页面就不用到处写 `?? []`
    userProfile.value = normalizeProfile(data.profile ?? null)
    sessions.value = Array.isArray(data.sessions) ? data.sessions : []
    meals.value = Array.isArray(data.meals) ? data.meals : []
    analyses.value = Array.isArray(data.analyses) ? data.analyses : []
    if (data.privacy) privacy.value = { ...privacy.value, ...data.privacy }
    if (data.speech && typeof data.speech.enabled === 'boolean') {
      speech.value = { enabled: data.speech.enabled, voiceURI: typeof data.speech.voiceURI === 'string' ? data.speech.voiceURI : '' }
    }
    if (Array.isArray(data.collapsed)) collapsedCards.value = data.collapsed
    if (data.theme === 'light' || data.theme === 'dark' || data.theme === 'system') themePref.value = data.theme
    applyTheme()
    if (Array.isArray(data.plans)) plans.value = data.plans
    if (Array.isArray(data.planHistory)) planHistory.value = data.planHistory
    if (data.unitGrams && typeof data.unitGrams === 'object') {
      const clean: Record<string, number> = {}
      // 上限只防手滑（1 碗 = 5 kg），不是营养判断
      for (const [k, v] of Object.entries(data.unitGrams)) if (typeof v === 'number' && v > 0 && v <= 5000) clean[k] = v
      unitGrams.value = clean
    }
    if (data.adjustmentResolutions && typeof data.adjustmentResolutions === 'object') {
      const clean: AdjustmentResolutions = {}
      for (const [k, v] of Object.entries(data.adjustmentResolutions)) {
        if (v === 'accepted' || v === 'dismissed') clean[k] = v
      }
      adjustmentResolutions.value = clean
    }
    initialized.value = true
    configureSyncHandlers()
    void bootstrapSync()
  }

  /**
   * Save state to localStorage
   */
  function persistState() {
    const state = {
      profile: userProfile.value,
      sessions: sessions.value,
      meals: meals.value,
      analyses: analyses.value,
      privacy: privacy.value,
      speech: speech.value,
      collapsed: collapsedCards.value,
      theme: themePref.value,
      plans: plans.value,
      planHistory: planHistory.value,
      unitGrams: unitGrams.value,
      adjustmentResolutions: adjustmentResolutions.value
    }
    const failed = saveStoredState(state)
    if (failed.length) {
      console.error('Failed to persist state to localStorage:', failed)
      // 缩略图会让状态变大；写满时报出来，而不是静默以为已保存
      if (!quotaWarned) {
        quotaWarned = true
        showToast({
          type: 'error',
          title: '本机存储写入失败',
          message: '可能是饮食照片缩略图占满了浏览器存储。可在设置里关闭缩略图保存，或先导出并清理旧记录。',
          duration: 7000
        })
      }
    } else {
      quotaWarned = false
    }
  }

  // ——— 同步层：本机优先，登录后在后台拉取/补传 ———
  function getUploadBatch(firstSync: boolean): UploadBatch {
    const since = syncState.lastSyncAt
    const localProfileAt = userProfile.value?.updatedAt ?? ''
    const localPrivacyAt = privacy.value.updatedAt ?? ''
    const profileNeedsUpload = !!userProfile.value && (firstSync
      ? (syncState.lastRemoteProfileAt ? localProfileAt !== syncState.lastRemoteProfileAt : true)
      : localProfileAt > since)
    const privacyNeedsUpload = firstSync
      ? (syncState.lastRemotePrivacyAt ? localPrivacyAt !== syncState.lastRemotePrivacyAt : true)
      : localPrivacyAt > since
    // 首次登录只补传本机记录；刚从服务端拉下来的记录已标记 synced，不重复上传
    const needs = (item: { _sync?: string }) => item._sync === 'pending' || (firstSync && !item._sync)
    return {
      profile: profileNeedsUpload ? { ...userProfile.value! } : null,
      privacy: privacyNeedsUpload ? { ...privacy.value } : null,
      sessions: sessions.value.filter(needs).map((item) => ({ ...item })),
      meals: meals.value.filter(needs).map((item) => ({ ...item, items: item.items.map((row) => ({ ...row })) })),
      plans: [...planHistory.value, ...plans.value].filter(needs).map((item) => ({ ...item, items: item.items.map((row) => ({ ...row })) })),
      analyses: analyses.value.filter(needs).map((item) => ({
        ...item,
        findings: item.findings.map((finding) => ({ ...finding })),
        metrics: item.metrics.map((metric) => ({ ...metric }))
      }))
    }
  }

  function markProfileSynced(remote: UserProfile, uploadedAt?: string) {
    if (!userProfile.value) return
    const previousId = userProfile.value.id
    userProfile.value = userProfile.value.updatedAt === uploadedAt ? normalizeProfile(remote) : {
      ...userProfile.value,
      id: remote.id,
      updatedAt: userProfile.value.updatedAt
    }
    if (previousId && previousId !== remote.id) {
      for (const item of sessions.value) if (item.userId === previousId || item.userId === 'demo-user') item.userId = remote.id
      for (const item of meals.value) if (item.userId === previousId || item.userId === 'demo-user') item.userId = remote.id
      for (const item of [...plans.value, ...planHistory.value]) item.userId = remote.id
    }
    persistState()
  }

  function markPrivacySynced(remote: PrivacySettings, uploadedAt?: string) {
    if (privacy.value.updatedAt === uploadedAt) privacy.value = { ...privacy.value, ...remote }
    persistState()
  }

  function markSessionSynced(clientId: string, remote: TrainingSession, pending: boolean) {
    const local = sessions.value.find((item) => (item.clientId ?? item.id) === clientId || item.id === clientId || item.serverId === remote.id)
    if (!local) return
    local.serverId = remote.serverId ?? remote.id
    if (!pending) local.updatedAt = remote.updatedAt ?? local.updatedAt
    local._sync = pending ? 'pending' : 'synced'
    persistState()
  }

  function markMealSynced(clientId: string, remote: Meal, pending: boolean) {
    const local = meals.value.find((item) => (item.clientId ?? item.id) === clientId || item.id === clientId || item.serverId === remote.id)
    if (!local) return
    local.serverId = remote.serverId ?? remote.id
    if (!pending) local.updatedAt = remote.updatedAt ?? local.updatedAt
    local._sync = pending ? 'pending' : 'synced'
    persistState()
  }

  function markPlanSynced(clientId: string, remote: Plan, pending: boolean) {
    const local = [...plans.value, ...planHistory.value].find((item) =>
      (item.clientId ?? item.id) === clientId || item.id === clientId || item.serverId === remote.id
    )
    if (!local) return
    local.serverId = remote.serverId ?? remote.id
    if (remote.version >= local.version) {
      local.version = remote.version
      local.updatedAt = remote.updatedAt ?? local.updatedAt
    }
    local._sync = pending ? 'pending' : 'synced'
    persistState()
  }

  function markAnalysisSynced(clientId: string, remote: MotionAnalysis, pending: boolean) {
    const local = analyses.value.find((item) =>
      (item.clientId ?? item.id) === clientId || item.id === clientId || item.serverId === remote.id
    )
    if (!local) return
    local.serverId = remote.serverId ?? remote.id
    if (!pending) local.updatedAt = remote.updatedAt ?? local.updatedAt
    local._sync = pending ? 'pending' : 'synced'
    persistState()
  }

  function markConflict(kind: 'session' | 'meal' | 'analysis' | 'plan' | 'profile', clientId: string, _message: string) {
    if (kind === 'session') {
      const local = sessions.value.find((item) => (item.clientId ?? item.id) === clientId || item.id === clientId)
      if (local) local._sync = 'conflict'
    } else if (kind === 'meal') {
      const local = meals.value.find((item) => (item.clientId ?? item.id) === clientId || item.id === clientId)
      if (local) local._sync = 'conflict'
    } else if (kind === 'analysis') {
      const local = analyses.value.find((item) => (item.clientId ?? item.id) === clientId || item.id === clientId)
      if (local) local._sync = 'conflict'
    } else if (kind === 'plan') {
      const local = [...plans.value, ...planHistory.value].find((item) => (item.clientId ?? item.id) === clientId || item.id === clientId)
      if (local) local._sync = 'conflict'
    } else if (userProfile.value) {
      userProfile.value.updatedAt = new Date().toISOString()
    }
    persistState()
  }

  function deletedKeys(records: { id: string; clientId?: string }[]): Set<string> {
    const keys = new Set<string>()
    for (const record of records) {
      if (record.id) keys.add(record.id)
      if (record.clientId) keys.add(record.clientId)
    }
    return keys
  }

  function applyRemoteSnapshot(snapshot: RemoteSyncSnapshot) {
    const queuedDeletes = listOutbox().filter((op) => op.kind.endsWith('.delete'))
    const deleting = (kind: string, remote: { id: string; clientId?: string }) => queuedDeletes.some((op) =>
      op.kind === `${kind}.delete` && (op.clientId === remote.clientId || op.clientId === remote.id))
    const keepDeleted = (kind: 'session' | 'meal' | 'analysis', item: TrainingSession | Meal | MotionAnalysis, keys: Set<string>) => {
      if (![item.id, item.serverId ?? '', item.clientId ?? ''].some((key) => keys.has(key))) return true
      if (item._sync !== 'pending' && item._sync !== 'conflict') return false
      const id = item.clientId ?? item.id
      for (const op of listOutbox()) if (op.kind.startsWith(`${kind}.`) && op.clientId === id) removeOp(op.id)
      addConflict(kind, id, '服务端已删除此记录；本机修改已保留，请导出核对后处理')
      return true
    }
    if (snapshot.profile) {
      const remoteTime = snapshot.profile.updatedAt ?? ''
      const localTime = userProfile.value?.updatedAt ?? ''
      if (!userProfile.value || remoteTime > localTime) userProfile.value = normalizeProfile(snapshot.profile)
    }
    if (snapshot.privacy) {
      const remoteTime = snapshot.privacy.updatedAt ?? ''
      const localTime = privacy.value.updatedAt ?? ''
      if (!privacy.value.updatedAt || remoteTime > localTime) privacy.value = { ...privacy.value, ...snapshot.privacy }
    }

    const deletedSessions = deletedKeys(snapshot.deleted?.sessions ?? [])
    if (deletedSessions.size) {
      sessions.value = sessions.value.filter((item) => keepDeleted('session', item, deletedSessions))
    }
    for (const remote of snapshot.sessions ?? []) {
      if (deleting('session', remote)) continue
      const local = sessions.value.find((item) =>
        (item.clientId ?? item.id) === (remote.clientId ?? remote.id) || item.serverId === remote.id || item.id === remote.id
      )
      if (local && (local._sync === 'pending' || local._sync === 'conflict')) {
        local.serverId = remote.serverId ?? remote.id
        continue
      }
      if (local) {
        Object.assign(local, remote, {
          id: local.id,
          clientId: local.clientId ?? remote.clientId,
          serverId: remote.serverId ?? remote.id,
          _sync: 'synced'
        })
      } else {
        sessions.value.push({ ...remote, _sync: 'synced' })
      }
    }

    const deletedMeals = deletedKeys(snapshot.deleted?.meals ?? [])
    if (deletedMeals.size) {
      meals.value = meals.value.filter((item) => keepDeleted('meal', item, deletedMeals))
    }
    for (const remote of snapshot.meals ?? []) {
      if (deleting('meal', remote)) continue
      const local = meals.value.find((item) =>
        (item.clientId ?? item.id) === (remote.clientId ?? remote.id) || item.serverId === remote.id || item.id === remote.id
      )
      if (local && (local._sync === 'pending' || local._sync === 'conflict')) {
        local.serverId = remote.serverId ?? remote.id
        continue
      }
      if (local) {
        Object.assign(local, remote, {
          id: local.id,
          clientId: local.clientId ?? remote.clientId,
          serverId: remote.serverId ?? remote.id,
          _sync: 'synced'
        })
      } else {
        meals.value.push({ ...remote, _sync: 'synced' })
      }
    }

    const deletedAnalyses = deletedKeys(snapshot.deleted?.analyses ?? [])
    if (deletedAnalyses.size) {
      analyses.value = analyses.value.filter((item) => keepDeleted('analysis', item, deletedAnalyses))
    }
    for (const remote of snapshot.analyses ?? []) {
      if (deleting('analysis', remote)) continue
      const local = analyses.value.find((item) =>
        (item.clientId ?? item.id) === (remote.clientId ?? remote.id) || item.serverId === remote.id || item.id === remote.id
      )
      if (local && (local._sync === 'pending' || local._sync === 'conflict')) {
        local.serverId = remote.serverId ?? remote.id
        continue
      }
      if (local) {
        Object.assign(local, remote, {
          id: local.id,
          clientId: local.clientId ?? remote.clientId,
          serverId: remote.serverId ?? remote.id,
          _sync: 'synced'
        })
      } else {
        analyses.value.push({ ...remote, _sync: 'synced' })
      }
    }

    const remotePlans = snapshot.plans ?? []
    const grouped = new Map<string, Plan[]>()
    for (const plan of remotePlans) {
      const key = plan.weekStartDate
      const list = grouped.get(key) ?? []
      list.push(plan)
      grouped.set(key, list)
    }
    const latest = [...grouped.values()].map((list) => list.sort((a, b) => a.version - b.version)[list.length - 1]).filter(Boolean)
    const latestIds = new Set(latest.map((plan) => plan.id))
    for (const remote of latest) {
      const local = plans.value.find((item) =>
        (item.clientId && item.clientId === remote.clientId) ||
        (item.serverId && item.serverId === remote.serverId) ||
        item.weekStartDate === remote.weekStartDate
      )
      if (local && (local._sync === 'pending' || local._sync === 'conflict')) {
        local.serverId = local.serverId ?? remote.serverId ?? remote.id
        continue
      }
      if (local) {
        Object.assign(local, remote, {
          id: local.id,
          clientId: local.clientId ?? remote.clientId,
          serverId: remote.serverId ?? remote.id,
          _sync: 'synced'
        })
      } else {
        plans.value.push({ ...remote, _sync: 'synced' })
      }
    }
    const knownPlans = new Set([...plans.value, ...planHistory.value].flatMap((plan) =>
      [plan.id, plan.serverId, plan.clientId].filter((value): value is string => !!value)
    ))
    for (const remote of remotePlans) {
      if (latestIds.has(remote.id)) continue
      const keys = [remote.id, remote.serverId, remote.clientId].filter((value): value is string => !!value)
      if (keys.some((key) => knownPlans.has(key))) continue
      planHistory.value.push({ ...remote, _sync: 'synced' })
      keys.forEach((key) => knownPlans.add(key))
    }
    persistState()
  }

  function configureSyncHandlers() {
    configureSync({
      getUploadBatch,
      applyRemote: applyRemoteSnapshot,
      markProfileSynced,
      markPrivacySynced,
      markSessionSynced,
      markMealSynced,
      markPlanSynced,
      markAnalysisSynced,
      markConflict
    })
  }

  function adoptRemotePlan(clientId: string, remote: Plan) {
    const index = plans.value.findIndex((plan) => (plan.clientId ?? plan.id) === clientId)
    if (index < 0) return
    const local = plans.value[index]
    planHistory.value.push({ ...local, items: local.items.map((item) => ({ ...item })), _sync: 'conflict' })
    plans.value[index] = { ...remote, id: local.id, serverId: remote.id, _sync: 'synced' }
    for (const op of listOutbox()) if (op.clientId === clientId && op.kind.startsWith('plan.')) removeOp(op.id)
    persistState()
    refreshPending()
  }

  function queueProfileSync() {
    if (userProfile.value) enqueueSync('profile.update', userProfile.value.id, { ...userProfile.value })
  }

  function queuePrivacySync() {
    enqueueSync('privacy.update', 'privacy', { ...privacy.value })
  }

  function queueSessionSync(session: TrainingSession) {
    session.clientId = session.clientId ?? session.id
    session.updatedAt = new Date().toISOString()
    session._sync = 'pending'
    enqueueSync('session.create', session.clientId, { ...session })
  }

  function queueAnalysisSync(analysis: MotionAnalysis, kind: 'analysis.create' | 'analysis.update' = 'analysis.create') {
    analysis.clientId = analysis.clientId ?? analysis.id
    analysis.updatedAt = new Date().toISOString()
    analysis._sync = 'pending'
    enqueueSync(kind, analysis.clientId, {
      ...analysis,
      findings: analysis.findings.map((finding) => ({ ...finding })),
      metrics: analysis.metrics.map((metric) => ({ ...metric }))
    })
  }

  function queueMealSync(meal: Meal) {
    meal.clientId = meal.clientId ?? meal.id
    meal.updatedAt = new Date().toISOString()
    meal._sync = 'pending'
    enqueueSync('meal.update', meal.clientId, { ...meal, items: meal.items.map((item) => ({ ...item })) })
  }

  function queueMealCreate(meal: Meal) {
    meal.clientId = meal.clientId ?? meal.id
    meal.updatedAt = new Date().toISOString()
    meal._sync = 'pending'
    enqueueSync('meal.create', meal.clientId, { ...meal, items: meal.items.map((item) => ({ ...item })) })
  }

  function queueMealDelete(meal: Meal) {
    if (!syncState.apiEnabled || !syncState.user) return true
    return enqueueSync('meal.delete', meal.clientId ?? meal.id, {
      ...meal,
      items: meal.items.map((item) => ({ ...item }))
    })
  }

  function queuePlanSync(plan: Plan) {
    plan.clientId = plan.clientId ?? plan.id
    plan.updatedAt = new Date().toISOString()
    plan._sync = 'pending'
    enqueueSync('plan.create', plan.clientId, { ...plan, items: plan.items.map((item) => ({ ...item })) })
  }

  /** 本周（周一为起点）的计划；没有就按档案生成 v1 并落盘 */
  function ensureWeekPlan(reference: Date, queue = true): Plan {
    const start = weekStart(reference)
    const iso = toISODate(start)
    const found = plans.value.find(p => p.weekStartDate === iso)
    if (found) return found
    const items: PlanItem[] = []
    for (let i = 0; i < 7; i++) {
      const d = new Date(start)
      d.setDate(start.getDate() + i)
      items.push(...buildDayPlan(d, userProfile.value, PLAN_VERSION).items)
    }
    const id = newId()
    const end = new Date(start)
    end.setDate(start.getDate() + 6)
    const plan: Plan = {
      id,
      userId: userProfile.value?.id || 'demo-user',
      version: 1,
      createdAt: new Date().toISOString(),
      reason: userProfile.value
        ? `按器材、时间与"需要避开的"条件生成（${PLAN_RULES_VERSION}）`
        : `未建档，使用不过滤的基础一周模板（${PLAN_RULES_VERSION}）`,
      weekStartDate: iso,
      weekEndDate: toISODate(end),
      items: items.map(i => ({ ...i, planId: id })),
      locked: false
    }
    plans.value.push(plan)
    persistState()
    if (queue) queuePlanSync(plan)
    return plan
  }

  function weekPlan(reference: Date): Plan | null {
    const iso = toISODate(weekStart(reference))
    return plans.value.find(p => p.weekStartDate === iso) ?? null
  }

  /** 某天计划生成时被挡掉的条件与年龄门槛，界面要如实列出 */
  function dayPlanNotice(reference: Date) {
    const p = weekPlan(reference)
    const stored = p ? p.items.filter(i => i.date === toISODate(reference)) : []
    const generated = buildDayPlan(reference, userProfile.value)
    return {
      items: stored.length ? stored : generated.items,
      conflicts: generated.conflicts,
      auto: generated.auto,
      gateNote: generated.gateNote,
      stale: !!p && p.source !== 'llm' && p.source !== 'image' && !p.reason.includes(PLAN_RULES_VERSION)
    }
  }

  /** 档案条件变了之后，明确重新生成本周计划（旧版本进历史，不静默替换） */
  function regenerateWeekPlan(reference: Date): Plan | null {
    const old = weekPlan(reference)
    if (old) {
      planHistory.value.push({ ...old, items: old.items.map(i => ({ ...i })) })
      plans.value = plans.value.filter(p => p.id !== old.id)
    }
    const fresh = ensureWeekPlan(reference, false)
    if (old) fresh.version = old.version + 1
    queuePlanSync(fresh)
    persistState()
    showToast({
      type: 'success',
      title: '本周计划已按新条件重生成',
      message: old ? `旧版本 v${old.version} 已存为历史，可回看` : '已生成 v1',
      duration: 3000
    })
    return fresh
  }

  // ——— 大模型生成计划（草稿 → 用户确认 → 才入库） ———
  /** 配置单独存一个 key，不进导出 */
  const llmConfig = ref<LlmConfig>({ baseUrl: '', apiKey: '', model: '' })
  /** 服务端默认模型（保底）：只有状态，没有密钥 */
  const llmDefault = ref<LlmDefaultStatus>({ ...NO_LLM_DEFAULT })
  const planFeedbackText = ref('')
  const planDraftState = ref<PlanDraftState>({
    status: 'idle',
    loadingStage: null,
    questions: [],
    answers: {},
    draft: null,
    error: '',
    warnings: []
  })
  /** 关闭弹窗/重新提问后，旧请求的晚到结果不再把弹窗重新打开 */
  let planRequestId = 0
  // 只为当前草稿保留生成资料，供重试或重新生成使用。
  let lastDraftRequest: { reference: Date; source?: PlanSourceInput; feedback?: string } | undefined

  /** 切换用哪个模型；只改偏好，已填的 base_url / key / 模型名原样保留 */
  function setLlmPreference(preference: 'custom' | 'default') {
    llmConfig.value = saveLlmConfig({ ...llmConfig.value, preference })
  }

  /** 自己的配置优先，没有就用服务端默认 */
  const planLlmReady = computed(() => canUseLlm(llmConfig.value, llmDefault.value))

  async function refreshLlmStatus() {
    llmDefault.value = await fetchLlmStatus()
  }

  function setLlmConfig(cfg: LlmConfig) {
    llmConfig.value = saveLlmConfig(cfg)
  }

  function resetPlanDraft() {
    planRequestId++
    lastDraftRequest = undefined
    planDraftState.value = {
      status: 'idle',
      loadingStage: null,
      questions: [],
      answers: {},
      draft: null,
      error: '',
      warnings: []
    }
  }

  function planWeekDates(reference: Date): string[] {
    return weekDates(weekStart(reference)).map(toISODate)
  }

  function planModelError(requireProfile = true): string {
    if (requireProfile) {
      const profile = userProfile.value
      if (!profile) return '请先填写并保存个人档案。'
      if (profile.age < AUTO_RECOMMEND_MIN_AGE) return '当前档案年龄未达到自动推荐条件，可在计划页手工录入。'
      const restriction = gateReason(profile)
      if (restriction) return restriction
    }
    if (!planLlmReady.value) return '既没有配置自己的模型，服务端也没有配默认模型。可以到设置页填写，或继续使用内置规则计划。'
    return ''
  }

  /** 第一阶段：先让模型看档案，问 1–3 个会改变排课的问题 */
  async function generatePlanQuestions(reference: Date = new Date()) {
    const requestId = ++planRequestId
    lastDraftRequest = undefined
    const guard = planModelError()
    if (guard) {
      planDraftState.value = {
        status: 'error',
        loadingStage: 'questions',
        questions: [],
        answers: {},
        draft: null,
        error: guard,
        warnings: []
      }
      return
    }
    planDraftState.value = {
      status: 'loading',
      loadingStage: 'questions',
      questions: [],
      answers: {},
      draft: null,
      error: '',
      warnings: []
    }
    const dates = planWeekDates(reference)
    const messages = buildPlanQuestionMessages(userProfile.value!, dates)
    const res = await callPlanProxy(llmConfig.value, messages)
    if (requestId !== planRequestId) return
    if (res.error) {
      planDraftState.value = {
        status: 'error',
        loadingStage: 'questions',
        questions: [],
        answers: {},
        draft: null,
        error: res.error,
        warnings: []
      }
      return
    }
    const check = validatePlanQuestions(extractJson(res.text))
    if (check.error) {
      planDraftState.value = {
        status: 'error',
        loadingStage: 'questions',
        questions: [],
        answers: {},
        draft: null,
        error: check.error,
        warnings: check.warnings
      }
      return
    }
    planDraftState.value = {
      status: 'questions',
      loadingStage: null,
      questions: check.questions,
      answers: {},
      draft: null,
      error: '',
      warnings: check.warnings
    }
  }

  /** 用户回答或提供资料后生成可编辑草稿。 */
  async function generatePlanDraft(
    reference: Date = new Date(),
    answers: Record<string, string> = planDraftState.value.answers,
    source?: PlanSourceInput
  ) {
    const requestId = ++planRequestId
    lastDraftRequest = { reference, source }
    const weekDates = planWeekDates(reference)
    const dayDate = source?.scope === 'day' ? toISODate(reference) : undefined
    const dates = dayDate ? [dayDate] : weekDates
    const context = {
      questions: source ? [] : planDraftState.value.questions,
      answers: source ? {} : answers,
      weekDates,
      fromMaterials: !!source
    }
    const guard = source && !source.text.trim() && !source.imageDataUrl
      ? '请填写训练安排或添加一张图片。' : planModelError(!source)
    if (guard) {
      planDraftState.value = {
        status: 'error',
        loadingStage: 'plan',
        ...context,
        draft: null,
        error: guard,
        warnings: []
      }
      return
    }
    planDraftState.value = {
      status: 'loading',
      loadingStage: source?.imageDataUrl ? 'image' : 'plan',
      ...context,
      draft: null,
      error: '',
      warnings: []
    }
    const config = llmConfig.value
    if (source?.imageDataUrl) {
      const reading = await readPlanImage(config, source.imageDataUrl, dates, toISODate(reference), source.text)
      if (requestId !== planRequestId) return
      planDraftState.value = {
        ...context,
        status: reading.draft ? 'ready' : 'error',
        loadingStage: reading.draft ? null : 'image',
        draft: reading.draft ? { ...reading.draft, dayDate } : null,
        imageTranscript: reading.transcript,
        error: reading.error,
        warnings: reading.warnings
      }
      return
    }
    const messages = buildPlanMessages(userProfile.value, dates, context, source)
    const res = await callPlanProxy(config, messages)
    if (requestId !== planRequestId) return
    if (res.error) {
      planDraftState.value = {
        status: 'error',
        loadingStage: 'plan',
        ...context,
        draft: null,
        error: res.error,
        warnings: []
      }
      return
    }
    const raw = extractJson(res.text) as { days?: unknown; reason?: unknown } | null
    const check = validatePlanDraft(raw, dates, res.model || config.model)
    if (!check.draft) {
      const sourceError = source && Array.isArray(raw?.days) && !raw.days.length && typeof raw.reason === 'string'
        ? raw.reason.trim().slice(0, 200) : ''
      planDraftState.value = {
        status: 'error',
        loadingStage: 'plan',
        ...context,
        draft: null,
        error: sourceError || check.error,
        warnings: check.warnings
      }
      return
    }
    const warnings = [...check.warnings]
    const requested = desiredWeeklySessions(context.questions, context.answers)
    if (requested !== null) {
      if (check.draft.days.length < requested) {
        warnings.push(`你希望每周 ${requested} 次，这份草稿目前只有 ${check.draft.days.length} 个训练日。可以点「修改计划」补足，或重新生成。`)
      } else if (check.draft.days.length > requested) {
        warnings.push(`你希望每周 ${requested} 次，这份草稿安排了 ${check.draft.days.length} 个训练日；可以点「修改计划」删减。`)
      }
    }
    planDraftState.value = {
      status: 'ready',
      loadingStage: null,
      ...context,
      draft: { ...check.draft, dayDate },
      error: '',
      warnings
    }
  }

  const staleFeedbackError = '现有计划已经更新。请重新生成调整建议，再确认新版计划。'

  async function generatePlanFeedback(reference: Date, feedback: string) {
    const requestId = ++planRequestId
    const text = feedback.trim().slice(0, 1000)
    lastDraftRequest = { reference, feedback: text }
    const dates = planWeekDates(reference)
    const context = { questions: [], answers: {}, weekDates: dates, draft: null, warnings: [] }
    const fail = (error: string) => {
      planDraftState.value = { ...context, status: 'error', loadingStage: 'feedback', error }
    }
    const plan = weekPlan(reference)
    const profile = userProfile.value
    const guard = !text ? '请先填写训练反馈。' : planModelError(false)
    if (guard) return fail(guard)
    if (!plan) return fail('请先为所选周创建计划，再提交反馈。')
    if (plan.locked) return fail('这份周计划已锁定。')
    if (profile && profile.age < AUTO_RECOMMEND_MIN_AGE) return fail('当前档案年龄未达到自动推荐条件，可在计划页手工录入。')
    const restriction = gateReason(profile)
    if (restriction) return fail(restriction)

    const { id, version } = plan
    planDraftState.value = { ...context, status: 'loading', loadingStage: 'feedback', error: '' }
    const result = await callPlanProxy(llmConfig.value, buildPlanFeedbackMessages(plan, dates, text, profile))
    if (requestId !== planRequestId) return
    if (result.error) return fail(result.error)
    const latest = weekPlan(reference)
    if (!latest || latest.id !== id || latest.version !== version || latest.locked) return fail(staleFeedbackError)
    const adjustment = validatePlanFeedback(extractJson(result.text), latest, dates)
    if (!adjustment) return fail('模型返回了无效的调整，可能涉及受保护项目或范围外的日期。请重试。')
    planDraftState.value = { ...context, status: 'ready', loadingStage: null, adjustment, error: '' }
  }

  function retryPlanDraft() {
    const request = lastDraftRequest
    if (request?.feedback !== undefined) return generatePlanFeedback(request.reference, request.feedback)
    return generatePlanDraft(request?.reference, planDraftState.value.answers, request?.source)
  }

  function acceptPlanFeedback(): Plan | null {
    const { adjustment, status, weekDates } = planDraftState.value
    if (status !== 'ready' || !adjustment?.changes.length || !weekDates?.[0]) return null
    const plan = weekPlan(new Date(`${weekDates[0]}T00:00:00`))
    const changesById = new Map(adjustment.changes.flatMap(change => change.before ? [[change.before.id, change] as const] : []))
    const adjustable = new Set(plan?.items.filter(item => !item.locked && !item.completed).map(item => item.id))
    if (!plan || plan.id !== adjustment.planId || plan.version !== adjustment.baseVersion || plan.locked
      || [...changesById.keys()].some(id => !adjustable.has(id))) {
      planDraftState.value = { ...planDraftState.value, status: 'error', loadingStage: 'feedback', adjustment: undefined, error: staleFeedbackError }
      return null
    }
    const items = plan.items.flatMap(item => {
      const change = changesById.get(item.id)
      if (!change) return [item]
      if (!change.after) return []
      const updated = { ...item, ...change.after }
      if (updated.exerciseName !== item.exerciseName) {
        updated.exerciseId = findExercise(updated.exerciseName)?.id
        updated.alternatives = []
      }
      return [updated]
    })
    for (const { before, after } of adjustment.changes) {
      if (!before && after) {
        items.push({ ...after, id: newId(), planId: plan.id, exerciseId: findExercise(after.exerciseName)?.id, locked: false, completed: false })
      }
    }
    const updated = bumpVersion(plan, items, `根据反馈调整 · ${adjustment.reason}（${PLAN_RULES_VERSION}）`)
    if (planFeedbackText.value.trim() === lastDraftRequest?.feedback) planFeedbackText.value = ''
    resetPlanDraft()
    showToast({ type: 'success', title: '已启用调整后的计划', message: `v${updated.version} · 原计划已保留在版本历史中`, duration: 3500 })
    return updated
  }

  /** 用户确认：单日追加项目，整周启用新安排。 */
  function acceptPlanDraft(draft: PlanDraft, reference: Date = new Date()): Plan | null {
    const dates = planWeekDates(reference)
    const allowed = draft.dayDate ? dates.filter(date => date === draft.dayDate) : dates
    if (draft.days.some(day => !allowed.includes(day.date))) return null
    const old = weekPlan(reference)
    const id = newId()
    const items: PlanItem[] = []
    for (const day of draft.days) {
      for (const it of day.items) {
        items.push({
          id: newId(),
          planId: id,
          date: day.date,
          exerciseName: it.exerciseName,
          type: it.type,
          plannedDuration: it.plannedDuration,
          plannedHoldSeconds: it.plannedHoldSeconds,
          plannedDistance: it.plannedDistance,
          plannedSets: it.plannedSets,
          plannedReps: it.plannedReps,
          note: it.note,
          locked: false,
          completed: false
        })
      }
    }
    if (!items.length) return null
    const carried = draft.dayDate && old ? old.items.map(item => ({ ...item, planId: id })) : []
    if (old) {
      planHistory.value.push({ ...old, items: old.items.map(i => ({ ...i })) })
      plans.value = plans.value.filter(p => p.id !== old.id)
    }
    const plan: Plan = {
      id,
      userId: userProfile.value?.id || 'demo-user',
      version: (old?.version ?? 0) + 1,
      createdAt: new Date().toISOString(),
      reason: `${draft.reason}（模型：${draft.model || '未命名'}，已由你确认 · ${PLAN_RULES_VERSION}）`,
      weekStartDate: dates[0],
      weekEndDate: dates[6],
      items: [...carried, ...items],
      locked: draft.dayDate ? (old?.locked ?? false) : false,
      source: draft.source === 'image' || (draft.dayDate && old?.source === 'image') ? 'image' : 'llm'
    }
    plans.value.push(plan)
    persistState()
    queuePlanSync(plan)
    resetPlanDraft()
    showToast({
      type: 'success',
      title: '计划已录入',
      message: draft.dayDate
        ? `${draft.dayDate} · 已追加 ${items.length} 项，计划更新为 v${plan.version}`
        : `${plan.weekStartDate} 至 ${plan.weekEndDate} · v${plan.version} · ${draft.days.length} 个训练日`,
      duration: 3500
    })
    return plan
  }

  /** 一次修改 = 一个新版本：旧版本进 planHistory，永不就地覆盖 */
  function bumpVersion(plan: Plan, items: PlanItem[], reason: string, queue = true): Plan {
    planHistory.value.push({ ...plan, items: plan.items.map(i => ({ ...i })) })
    plan.items = items
    plan.version += 1
    plan.clientId = `${plan.id}:v${plan.version}`
    plan.reason = reason
    plan.createdAt = new Date().toISOString()
    plan.updatedAt = plan.createdAt
    plan._sync = 'pending'
    persistState()
    if (queue) queuePlanSync(plan)
    return plan
  }

  /** 接受调整建议：锁定项与已完成项保持不变 */
  function acceptAdjustment(planId: string, changes: PlanChange[], reason: string): Plan | null {
    const plan = plans.value.find(p => p.id === planId)
    if (!plan) return null
    const baseVersion = plan.version
    const changedIds = new Set(changes.filter(c => c.type === 'changed').map(c => c.itemId))
    const items = plan.items.map(item => {
      if (!changedIds.has(item.id)) return item
      if (item.locked || item.completed) return item
      const ch = changes.find(c => c.itemId === item.id)!
      return { ...item, ...(ch.newValue ?? {}) }
    })
    const moved = changedIds.size
    const updated = bumpVersion(plan, items, `${reason}（改动 ${moved} 项，锁定项保持不变）`, false)
    if (plan.serverId) {
      enqueueSync('plan.adjustment', plan.clientId ?? plan.id, {
        plan: { ...updated, items: updated.items.map(item => ({ ...item })) },
        baseVersion,
        changes,
        reason
      })
    } else {
      queuePlanSync(updated)
    }
    return updated
  }

  function rejectAdjustment(planId: string) {
    const plan = plans.value.find(p => p.id === planId)
    if (!plan) return
    showToast({ type: 'info', title: '已保持原计划', message: `v${plan.version} 未改动`, duration: 2500 })
  }

  /** 记录一条建议已处理：accepted = 已接受并生成新版本；dismissed = 暂不调整 */
  function resolveAdjustment(key: string, status: 'accepted' | 'dismissed') {
    if (!key) return
    adjustmentResolutions.value = { ...adjustmentResolutions.value, [key]: status }
    persistState()
  }

  function isAdjustmentResolved(key: string): boolean {
    return !!adjustmentResolutions.value[key]
  }

  function toggleItemLock(planId: string, itemId: string) {
    const plan = plans.value.find(p => p.id === planId)
    if (!plan) return
    const items = plan.items.map(i => (i.id === itemId ? { ...i, locked: !i.locked } : i))
    const target = items.find(i => i.id === itemId)
    bumpVersion(plan, items, `${target?.locked ? '锁定' : '解锁'}「${target?.exerciseName ?? itemId}」`)
  }

  function markItemCompleted(planId: string, itemId: string, completed: boolean) {
    const plan = plans.value.find(p => p.id === planId)
    if (!plan) return
    const items = plan.items.map(i => (i.id === itemId ? { ...i, completed } : i))
    const name = items.find(i => i.id === itemId)?.exerciseName ?? itemId
    bumpVersion(plan, items, `标记「${name}」为${completed ? '已完成' : '未完成'}`)
  }

  /** 手工录入：不满足自动推荐条件（如未满 18 岁）时的安排入口 */
  function addManualItem(planId: string, input: { date: string; exerciseName: string; minutes: number; note?: string }) {
    const plan = plans.value.find(p => p.id === planId)
    if (!plan) return null
    const item: PlanItem = {
      id: `${input.date}-${input.exerciseName}-m${Date.now().toString(36)}`,
      planId,
      date: input.date,
      exerciseName: input.exerciseName,
      type: '其他',
      plannedDuration: input.minutes,
      note: input.note ?? '手工录入，不参与自动推荐',
      locked: false,
      completed: false
    }
    bumpVersion(plan, [...plan.items, item], `手工录入「${input.exerciseName}」`)
    return item
  }

  /**
   * Update user profile
   */
  function updateProfile(profile: Partial<UserProfile>) {
    const updatedAt = new Date().toISOString()
    if (userProfile.value) {
      userProfile.value = { ...userProfile.value, ...profile, updatedAt }
    } else {
      userProfile.value = {
        id: newId(),
        age: 25,
        goal: '',
        experience: '',
        availableTimes: [],
        equipment: [],
        restrictions: [],
        ...profile,
        updatedAt
      } as UserProfile
    }
    persistState()
    queueProfileSync()
  }

  /**
   * Show toast notification
   */
  function showToast(toast: Omit<Toast, 'id' | 'dismissible'>) {
    const id = newId()
    const newToast: Toast = {
      id,
      dismissible: true,
      duration: 5000,
      ...toast
    }

    toasts.value.push(newToast)

    if (newToast.duration && newToast.duration > 0) {
      setTimeout(() => {
        dismissToast(id)
      }, newToast.duration)
    }
  }

  /**
   * Dismiss toast
   */
  function dismissToast(id: string) {
    const index = toasts.value.findIndex(t => t.id === id)
    if (index !== -1) {
      toasts.value.splice(index, 1)
    }
  }

  /**
   * Record a finished training session
   */
  function addSession(input: Omit<TrainingSession, 'id' | 'userId' | 'createdAt'>): TrainingSession {
    const session: TrainingSession = {
      ...input,
      id: newId(),
      userId: userProfile.value?.id || 'demo-user',
      createdAt: new Date().toISOString()
    }
    sessions.value.push(session)
    queueSessionSync(session)
    persistState()
    showToast({
      type: 'success',
      title: '训练已记录',
      message: `${session.exerciseName} · ${session.actualReps === undefined ? `${session.actualDuration} 分钟` : `${session.actualReps} 次`} · ${session.completionStatus === 'completed' ? '全部完成' : '部分完成'}`,
      duration: 4000
    })
    return session
  }

  /**
   * Attach the post-session feedback (RPE, discomfort, reason, notes)
   */
  function applyFeedback(sessionId: string, feedback: SessionFeedback) {
    const session = sessions.value.find(s => s.id === sessionId)
    if (!session) return
    session.rpe = feedback.rpe
    session.discomfort = feedback.discomfort
    session.completionReason = feedback.reason
    session.notes = feedback.notes
    if (feedback.duration !== undefined) session.actualDuration = feedback.duration
    if (feedback.distance !== undefined) session.actualDistance = feedback.distance
    session.clientId = session.clientId ?? session.id
    session.updatedAt = new Date().toISOString()
    session._sync = 'pending'
    persistState()
    enqueueSync('session.feedback', session.clientId, {
      session: { ...session },
      feedback: { ...feedback, sessionId: session.id }
    })
    showToast({
      type: 'success',
      title: '训练反馈已保存',
      message: feedback.rpe === null
        ? 'RPE 记为"未记录"，不参与负荷计算'
        : `RPE ${feedback.rpe} · 本次负荷约 ${Math.round((session.actualDuration ?? 0) * feedback.rpe)}`,
      duration: 3000
    })
  }

  /**
   * 由现有条目重建 completeness / analysis；新增、编辑、删条目共用同一套规则。
   * @param excludeMealId 要把当前这餐从"当天已有类别"里排除，否则缺项会被它自己的旧类别掩盖
   */
  function buildMealAnalysis(items: MealItem[], date: string, mealId: string, excludeMealId?: string) {
    const completeness = deriveCompleteness(items)
    const dayCategories = [...new Set(
      meals.value
        .filter(m => m.date === date && m.id !== excludeMealId)
        .flatMap(m => m.items.map(i => i.category))
    )]
    const estimates = privacy.value.showEnergyEstimate
      ? items
        .map(i => estimateEnergy({ foodName: i.foodName, portionSize: i.portionSize, portionUnit: i.portionUnit, unitGrams: unitGrams.value }))
        .filter((e): e is EnergyEstimate => e !== null)
      : []
    const base = completeness === 'unknown' ? null : analyzeMeal(items, dayCategories, estimates.length > 0)
    const analysis = base ? {
      ...base,
      hasNutritionEstimate: estimates.length > 0,
      estimateRefs: estimates.length ? estimates : undefined,
      id: newId(),
      mealId,
      createdAt: new Date().toISOString()
    } : undefined
    return { completeness, analysis }
  }

  /**
   * 把新草稿变成可落库的条目，再交给 buildMealAnalysis 生成结构与完整度
   * @param excludeMealId 编辑时要把当前这餐从"当天已有类别"里排除，否则缺项会被它自己的旧类别掩盖
   */
  function buildMealParts(input: NewMealInput, mealId: string, excludeMealId?: string) {
    const items: MealItem[] = input.items.map(i => ({
      ...i,
      id: newId(),
      mealId,
      foodId: `${i.category}-${i.foodName}`,
      confirmed: true
    }))
    const { completeness, analysis } = buildMealAnalysis(items, input.date, mealId, excludeMealId)
    return { items, completeness, analysis }
  }

  /**
   * Record a meal with its items, then run the structure rules on it
   */
  function addMeal(input: NewMealInput): Meal {
    const mealId = newId()
    const { items, completeness, analysis } = buildMealParts(input, mealId)
    const meal: Meal = {
      id: mealId,
      userId: userProfile.value?.id || 'demo-user',
      date: input.date,
      mealType: input.mealType,
      time: input.time,
      completeness,
      items,
      analyzed: !!analysis,
      analysis,
      createdAt: new Date().toISOString(),
      photoThumb: input.photoThumb,
      photoId: input.photoId
    }
    meals.value.push(meal)
    queueMealCreate(meal)
    persistState()
    showToast({
      type: 'success',
      title: '餐次已记录',
      message: completeness === 'partial' ? '份量没填全，记为"部分记录"' : '结构与类别已按规则标注',
      duration: 3000
    })
    return meal
  }

  /**
   * 编辑已有餐次：保留 id、日期、餐次、创建时间与照片，只重建条目与分析。
   * 同一 id 原地替换，列表按 key 复用，避免整条记录（含照片）被销毁重建。
   */
  function updateMeal(mealId: string, input: { time: string; items: NewMealInput['items'] }): Meal | null {
    const index = meals.value.findIndex(m => m.id === mealId)
    if (index === -1) return null
    const current = meals.value[index]
    const { items, completeness, analysis } = buildMealParts({
      date: current.date,
      mealType: current.mealType,
      time: input.time,
      items: input.items
    }, current.id, current.id)
    const updated: Meal = {
      ...current,
      time: input.time,
      completeness,
      items,
      analyzed: !!analysis,
      analysis
    }
    meals.value[index] = updated
    queueMealSync(updated)
    persistState()
    showToast({
      type: 'success',
      title: '餐次已更新',
      message: completeness === 'partial' ? '份量没填全，仍记为"部分记录"' : '结构与类别已重新标注',
      duration: 3000
    })
    return updated
  }

  /** 逐项确认：只清掉待核对标记，不改动类别、份量与热量 */
  function confirmMealItem(mealId: string, itemId: string): boolean {
    const meal = meals.value.find(m => m.id === mealId)
    const item = meal?.items.find(i => i.id === itemId)
    if (!meal || !item) return false
    if (item.userConfirmed && item.uncertain === false) return false
    item.userConfirmed = true
    item.uncertain = false
    const unknown = meal.analysis?.unknownItems
    if (unknown?.length) {
      const index = unknown.indexOf(item.foodName)
      if (index !== -1) meal.analysis!.unknownItems = unknown.filter((_, i) => i !== index)
    }
    queueMealSync(meal)
    persistState()
    return true
  }

  /** 删除识别错误的条目；至少保留一项，删完会重算完整度与结构 */
  function removeMealItem(mealId: string, itemId: string): boolean {
    const meal = meals.value.find(m => m.id === mealId)
    if (!meal || meal.items.length <= 1) return false
    const remaining = meal.items.filter(i => i.id !== itemId)
    if (remaining.length === meal.items.length) return false
    const { completeness, analysis } = buildMealAnalysis(remaining, meal.date, meal.id, meal.id)
    meal.items = remaining
    meal.completeness = completeness
    meal.analysis = analysis
    meal.analyzed = !!analysis
    queueMealSync(meal)
    persistState()
    return true
  }

  /** 全部确认这一餐；返回新确认的条目数 */
  function confirmMeal(mealId: string): number {
    const meal = meals.value.find(m => m.id === mealId)
    if (!meal) return 0
    let changed = 0
    for (const item of meal.items) {
      if (!item.userConfirmed || item.uncertain) {
        item.userConfirmed = true
        item.uncertain = false
        changed++
      }
    }
    if (!changed) return 0
    if (meal.analysis?.unknownItems?.length) meal.analysis.unknownItems = []
    queueMealSync(meal)
    persistState()
    return changed
  }

  function removeMeal(mealId: string) {
    const meal = meals.value.find(m => m.id === mealId)
    if (meal && !queueMealDelete(meal)) {
      showToast({ type: 'warning', title: '删除未完成', message: syncState.error, duration: 5000 })
      return
    }
    if (meal?.photoId) void deleteMealPhoto(meal.photoId).catch(() => { /* 清不掉原图不影响删除记录 */ })
    meals.value = meals.value.filter(m => m.id !== mealId)
    persistState()
    showToast({ type: 'info', title: '已删除该餐记录', message: '删除后这一天会重新显示为"未记录"', duration: 2500 })
  }

  /** 自动判断的餐次只影响标签与时间线，不改动条目与结构分析 */
  function updateMealType(mealId: string, mealType: MealType) {
    const meal = meals.value.find(m => m.id === mealId)
    if (!meal || meal.mealType === mealType) return false
    meal.mealType = mealType
    queueMealSync(meal)
    persistState()
    return true
  }

  /** 隐私与导出偏好；当前版本不会据此自动删除数据 */
  function updatePrivacy(patch: Partial<PrivacySettings>) {
    privacy.value = { ...privacy.value, ...patch, updatedAt: new Date().toISOString() }
    persistState()
    queuePrivacySync()
  }

  /** 语音播报开关与音色（F19）：选择存进偏好并落盘，刷新后保持 */
  function updateSpeech(patch: Partial<SpeechSettings>) {
    speech.value = { ...speech.value, ...patch }
    persistState()
  }

  /** 记下"这个食物的这个单位等于几克"，只影响本机的后续估算 */
  function rememberUnitGrams(foodName: string, unit: string, grams: number) {
    if (!foodName || !unit || !Number.isFinite(grams) || grams <= 0) return false
    unitGrams.value = { ...unitGrams.value, [unitKey(foodName, unit)]: Math.round(grams) }
    persistState()
    return true
  }

  /** 撤销本机口径，该单位退回演示假设 */
  function forgetUnitGrams(foodName: string, unit: string) {
    const key = unitKey(foodName, unit)
    if (!(key in unitGrams.value)) return false
    const next = { ...unitGrams.value }
    delete next[key]
    unitGrams.value = next
    persistState()
    return true
  }

  /** 收起/展开一张解释类卡片 */
  function toggleCard(id: string) {
    const i = collapsedCards.value.indexOf(id)
    if (i >= 0) collapsedCards.value.splice(i, 1)
    else collapsedCards.value.push(id)
    persistState()
  }

  function isCardCollapsed(id: string) {
    return collapsedCards.value.includes(id)
  }

  function addAnalysis(record: MotionAnalysis) {
    record.clientId = record.clientId ?? record.id
    record._sync = 'pending'
    queueAnalysisSync(record)
    analyses.value = [record, ...analyses.value.filter(item => item.id !== record.id)]
    persistState()
  }

  function removeAnalysis(id: string) {
    const target = analyses.value.find(item => item.id === id)
    analyses.value = analyses.value.filter(item => item.id !== id)
    persistState()
    if (target) {
      enqueueSync('analysis.delete', target.clientId ?? target.id, { ...target })
      const refs = target.findings.map(finding => finding.keyframeRef).filter((ref): ref is string => !!ref)
      void deleteAnalysisKeyframes(refs).catch(() => { /* 清理失败不影响主数据删除 */ })
    }
  }

  function linkAnalysisToSession(id: string, sessionId: string | undefined) {
    const analysis = analyses.value.find(item => item.id === id)
    if (!analysis) return false
    if (sessionId) analysis.sessionId = sessionId
    else delete analysis.sessionId
    queueAnalysisSync(analysis, 'analysis.update')
    persistState()
    return true
  }

  /**
   * Clear all data
   */
  function clearAllData() {
    userProfile.value = null
    sessions.value = []
    meals.value = []
    analyses.value = []
    plans.value = []
    planHistory.value = []
    privacy.value = { cameraEnabled: true, saveVideoLocally: false, dataRetentionDays: 90, exportFormat: 'json', showEnergyEstimate: false, saveFoodPhotoLocally: true }
    speech.value = { enabled: false, voiceURI: '' }
    collapsedCards.value = []
    themePref.value = 'system'
    unitGrams.value = {}
    adjustmentResolutions.value = {}
    planFeedbackText.value = ''
    applyTheme()
    clearStoredState()
    clearSyncMeta()
    clearAllConflicts()
    syncState.lastSyncAt = ''
    refreshPending()
    // 每日 Tips 的「今日不再出现」也是本机偏好；清除数据后应回到进站即弹
    if (typeof localStorage !== 'undefined') localStorage.removeItem(WELLNESS_DISMISS_KEY)
    void clearMealPhotos().catch(() => { /* 照片库清理失败时至少保留了主数据清除结果 */ })
    void clearAnalysisKeyframes().catch(() => { /* 关键帧库清理失败时至少保留了主数据清除结果 */ })
    showToast({
      type: 'success',
      title: '数据已清除',
      message: '档案、训练、餐食、分析记录、照片、计划版本与本机换算口径都已从本机删除',
      duration: 3000
    })
  }

  return {
    // State
    userProfile,
    sessions,
    meals,
    analyses,
    privacy,
    speech,
    toasts,
    initialized,
    collapsedCards,
    themePref,
    plans,
    planHistory,
    unitGrams,
    adjustmentResolutions,
    llmConfig,
    llmDefault,
    planFeedbackText,
    planDraftState,
    planLlmReady,

    // Computed
    hasProfile,

    // Actions
    init,
    persistState,
    updateProfile,
    showToast,
    dismissToast,
    addSession,
    applyFeedback,
    addMeal,
    updateMeal,
    confirmMealItem,
    confirmMeal,
    removeMealItem,
    removeMeal,
    updateMealType,
    updatePrivacy,
    updateSpeech,
    rememberUnitGrams,
    forgetUnitGrams,
    toggleCard,
    isCardCollapsed,
    addAnalysis,
    removeAnalysis,
    linkAnalysisToSession,
    queueAnalysisSync,
    setTheme,
    applyTheme,
    ensureWeekPlan,
    weekPlan,
    dayPlanNotice,
    regenerateWeekPlan,
    setLlmConfig,
    setLlmPreference,
    refreshLlmStatus,
    generatePlanQuestions,
    generatePlanDraft,
    generatePlanFeedback,
    retryPlanDraft,
    acceptPlanDraft,
    acceptPlanFeedback,
    resetPlanDraft,
    acceptAdjustment,
    adoptRemotePlan,
    rejectAdjustment,
    resolveAdjustment,
    isAdjustmentResolved,
    toggleItemLock,
    markItemCompleted,
    addManualItem,
    clearAllData
  }
})
