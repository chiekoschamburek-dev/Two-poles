import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { FoodCategory, Meal, MealItem, MealType, Mode, Plan, PlanChange, UserProfile, Toast, TrainingSession, SessionFeedback, PrivacySettings, PlanItem, ThemePreference, ModelEnergyEstimate } from '@/types/domain'
import { newId } from '@/utils/id'
import { analyzeMeal, deriveCompleteness } from '@/services/mealRules'
import { estimateEnergy, unitKey } from '@/services/foodComposition'
import type { EnergyEstimate } from '@/services/foodComposition'
import { clearMealPhotos, deleteMealPhoto } from '@/services/mealPhotos'
import { buildDayPlan, PLAN_RULES_VERSION, PLAN_VERSION } from '@/services/planRules'
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
  saveLlmConfig,
  validatePlanDraft,
  validatePlanQuestions
} from '@/services/llm'
import type { LlmConfig, LlmDefaultStatus, PlanDraft, PlanDraftState } from '@/services/llm'
import { weekStart } from '@/services/weekRules'
import { toISODate } from '@/utils/time'

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
    modelEnergy?: ModelEnergyEstimate
  }[]
  /** 仅本机保存的压缩缩略图；不传则只保存识别结果 */
  photoThumb?: string
  /** 本机原图在 IndexedDB 里的 key */
  photoId?: string
}

export const useAppStore = defineStore('app', () => {
  // === State ===
  const currentMode = ref<Mode>('public')
  const userProfile = ref<UserProfile | null>(null)
  const sessions = ref<TrainingSession[]>([])
  const meals = ref<Meal[]>([])
  const privacy = ref<PrivacySettings>({
    cameraEnabled: true,
    saveVideoLocally: false,
    dataRetentionDays: 90,
    exportFormat: 'json',
    showEnergyEstimate: false,
    saveFoodPhotoLocally: true
  })
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
  /** 存储写满只提示一次，避免每次操作都弹同一个错误 */
  let quotaWarned = false

  // === Computed ===
  const isPublicMode = computed(() => currentMode.value === 'public')
  const isAthleteMode = computed(() => currentMode.value === 'athlete')
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
    const stored = localStorage.getItem('twopoles_state')
    if (stored) {
      try {
        const data = JSON.parse(stored)
        currentMode.value = data.mode || 'public'
        // 旧档案没有 PB / 极限数组：在这里补齐，页面就不用到处写 `?? []`
        userProfile.value = normalizeProfile(data.profile || null)
        sessions.value = Array.isArray(data.sessions) ? data.sessions : []
        meals.value = Array.isArray(data.meals) ? data.meals : []
        if (data.privacy) privacy.value = { ...privacy.value, ...data.privacy }
        if (Array.isArray(data.collapsed)) collapsedCards.value = data.collapsed
        if (data.theme === 'light' || data.theme === 'dark' || data.theme === 'system') themePref.value = data.theme
        applyTheme()
        if (Array.isArray(data.plans)) plans.value = data.plans
        if (Array.isArray(data.planHistory)) planHistory.value = data.planHistory
        if (Array.isArray(data.modeLog)) modeLog.value = data.modeLog
        if (data.unitGrams && typeof data.unitGrams === 'object') {
          const clean: Record<string, number> = {}
          // 上限只防手滑（1 碗 = 5 kg），不是营养判断
          for (const [k, v] of Object.entries(data.unitGrams)) if (typeof v === 'number' && v > 0 && v <= 5000) clean[k] = v
          unitGrams.value = clean
        }
      } catch (error) {
        console.error('Failed to load state from localStorage:', error)
      }
    }
    initialized.value = true
  }

  /**
   * Save state to localStorage
   */
  function persistState() {
    const state = {
      mode: currentMode.value,
      profile: userProfile.value,
      sessions: sessions.value,
      meals: meals.value,
      privacy: privacy.value,
      collapsed: collapsedCards.value,
      theme: themePref.value,
      plans: plans.value,
      planHistory: planHistory.value,
      modeLog: modeLog.value,
      unitGrams: unitGrams.value
    }
    try {
      localStorage.setItem('twopoles_state', JSON.stringify(state))
      quotaWarned = false
    } catch (error) {
      console.error('Failed to persist state to localStorage:', error)
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
    }
  }

  /**
   * 模式切换：先给出差异与未完成计划，用户确认后才落地（文档 F02 / §3.3 / §6.1 / §7）。
   * 切换只改变后续操作的界面配置，不改写任何已有计划——旧模式的计划保持可见。
   */
  const pendingSwitch = ref<Mode | null>(null)
  /** 切换历史快照：谁在什么时候从哪个模式切到哪个模式、当时有几份未完成计划 */
  const modeLog = ref<{ from: Mode; to: Mode; at: string; openPlanCount: number }[]>([])

  const openPlans = computed(() =>
    plans.value.filter(p => p.items.some(i => !i.completed))
  )

  const switchPreview = computed(() => {
    const target = pendingSwitch.value
    if (!target) return null
    const from = currentMode.value
    const carry = openPlans.value.filter(p => p.mode === from)
    return {
      from,
      to: target,
      fromLabel: from === 'public' ? '大众模式' : '运动员模式',
      toLabel: target === 'public' ? '大众模式' : '运动员模式',
      differences: target === 'athlete'
        ? ['首页改为四周周期与计划实际对照', '训练记录增加距离与训练类型', '饮食页增加训练日与用餐时间线', '负荷按 session-RPE × 分钟计，缺 RPE 不计入']
        : ['首页改为今日安排与开始跟练', '计划改为按器材与时长过滤的一周模板', '饮食只显示类别与记录完整度，不显示训练时间线'],
      keeps: ['已有的训练与餐食记录不会被删除或改写', `已存在的 ${plans.value.length} 份计划保留原模式与规则版本`],
      openPlanCount: carry.length,
      openPlanNote: carry.length
        ? `有 ${carry.length} 份${from === 'public' ? '大众' : '运动员'}模式下未完成的计划：切换后仍然可见，不会自动变成新模式的安排；需要时你在计划页明确复制或调整。`
        : '当前没有未完成的计划。'
    }
  })

  function requestModeSwitch(target: Mode) {
    if (target === currentMode.value) return null
    pendingSwitch.value = target
    return switchPreview.value
  }

  function cancelModeSwitch() {
    pendingSwitch.value = null
  }

  function confirmModeSwitch() {
    const target = pendingSwitch.value
    if (!target) return
    const from = currentMode.value
    currentMode.value = target
    if (userProfile.value) {
      userProfile.value.mode = target
      userProfile.value.modeChangedAt = new Date().toISOString()
    }
    modeLog.value.push({ from, to: target, at: new Date().toISOString(), openPlanCount: openPlans.value.length })
    pendingSwitch.value = null
    persistState()
    showToast({
      type: 'success',
      title: `已切换到${target === 'public' ? '大众' : '运动员'}模式`,
      message: `已记录 ${modeLog.value.length} 次切换；原有记录与计划版本未改动`,
      duration: 3500
    })
  }

  /** 建档流程里用户已逐步选择并在末页复核，直接落地模式，不再弹一次确认 */
  function commitMode(target: Mode) {
    if (target === currentMode.value) return
    const from = currentMode.value
    currentMode.value = target
    if (userProfile.value) {
      userProfile.value.mode = target
      userProfile.value.modeChangedAt = new Date().toISOString()
    }
    modeLog.value.push({ from, to: target, at: new Date().toISOString(), openPlanCount: openPlans.value.length })
    persistState()
  }

  /** 明确把某份旧计划复制成新模式的草稿（不做即不生成，防止静默覆盖） */
  function copyPlanToMode(planId: string, target: Mode): Plan | null {
    const src = plans.value.find(p => p.id === planId)
    if (!src || src.mode === target) return null
    const copy: Plan = {
      ...src,
      id: newId(),
      version: 1,
      mode: target,
      createdAt: new Date().toISOString(),
      reason: `由「${src.mode === 'public' ? '大众' : '运动员'}模式」v${src.version} 复制而来`,
      items: src.items.map(i => ({ ...i, id: `${i.date}-${i.exerciseName}-c`, planId: '', completed: false }))
    }
    copy.items.forEach(i => { i.planId = copy.id })
    plans.value.push(copy)
    persistState()
    showToast({ type: 'success', title: '已复制为新模式的计划', message: '原计划保持不变', duration: 3000 })
    return copy
  }

  /** 本周（周一为起点）在当前模式下的计划；没有就按档案生成 v1 并落盘 */
  function ensureWeekPlan(reference: Date): Plan {
    const start = weekStart(reference)
    const iso = toISODate(start)
    const found = plans.value.find(p => p.weekStartDate === iso && p.mode === currentMode.value)
    if (found) return found
    const items: PlanItem[] = []
    for (let i = 0; i < 7; i++) {
      const d = new Date(start)
      d.setDate(start.getDate() + i)
      items.push(...buildDayPlan(d, userProfile.value, currentMode.value, PLAN_VERSION).items)
    }
    const id = newId()
    const end = new Date(start)
    end.setDate(start.getDate() + 6)
    const plan: Plan = {
      id,
      userId: userProfile.value?.id || 'demo-user',
      version: 1,
      createdAt: new Date().toISOString(),
      mode: currentMode.value,
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
    return plan
  }

  function weekPlan(reference: Date): Plan | null {
    const iso = toISODate(weekStart(reference))
    return plans.value.find(p => p.weekStartDate === iso && p.mode === currentMode.value) ?? null
  }

  /** 某天计划生成时被挡掉的条件与年龄门槛，界面要如实列出 */
  function dayPlanNotice(reference: Date) {
    const p = weekPlan(reference)
    const stored = p ? p.items.filter(i => i.date === toISODate(reference)) : []
    const generated = buildDayPlan(reference, userProfile.value, currentMode.value)
    return {
      items: stored.length ? stored : generated.items,
      conflicts: generated.conflicts,
      auto: generated.auto,
      gateNote: generated.gateNote,
      stale: !!p && p.source !== 'llm' && !p.reason.includes(PLAN_RULES_VERSION)
    }
  }

  /** 档案条件变了之后，明确重新生成本周计划（旧版本进历史，不静默替换） */
  function regenerateWeekPlan(reference: Date): Plan | null {
    const old = weekPlan(reference)
    if (old) {
      planHistory.value.push({ ...old, items: old.items.map(i => ({ ...i })) })
      plans.value = plans.value.filter(p => p.id !== old.id)
    }
    const fresh = ensureWeekPlan(reference)
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
    const start = weekStart(reference)
    const dates: string[] = []
    for (let i = 0; i < 7; i++) {
      const d = new Date(start)
      d.setDate(start.getDate() + i)
      dates.push(toISODate(d))
    }
    return dates
  }

  function planModelError(): string {
    if (!userProfile.value) return '还没有建档，先填档案再生成。'
    if (!planLlmReady.value) return '既没有配置自己的模型，服务端也没有配默认模型。可以到设置页填写，或继续使用内置规则计划。'
    return ''
  }

  /** 第一阶段：先让模型看档案，问 1–3 个会改变排课的问题 */
  async function generatePlanQuestions(reference: Date = new Date()) {
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
    const requestId = ++planRequestId
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
    const messages = buildPlanQuestionMessages(userProfile.value!, currentMode.value, dates)
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

  /** 第二阶段：用户回答后生成草稿；只写进 planDraftState，不碰 plans */
  async function generatePlanDraft(reference: Date = new Date(), answers: Record<string, string> = planDraftState.value.answers) {
    const guard = planModelError()
    if (guard) {
      planDraftState.value = {
        status: 'error',
        loadingStage: 'plan',
        questions: planDraftState.value.questions,
        answers,
        draft: null,
        error: guard,
        warnings: []
      }
      return
    }
    const questions = planDraftState.value.questions
    const requestId = ++planRequestId
    planDraftState.value = {
      status: 'loading',
      loadingStage: 'plan',
      questions,
      answers,
      draft: null,
      error: '',
      warnings: []
    }
    const dates = planWeekDates(reference)
    const messages = buildPlanMessages(userProfile.value!, dates, currentMode.value, { questions, answers })
    const res = await callPlanProxy(llmConfig.value, messages)
    if (requestId !== planRequestId) return
    if (res.error) {
      planDraftState.value = {
        status: 'error',
        loadingStage: 'plan',
        questions,
        answers,
        draft: null,
        error: res.error,
        warnings: []
      }
      return
    }
    const check = validatePlanDraft(extractJson(res.text), dates, llmConfig.value.model)
    if (!check.draft) {
      planDraftState.value = {
        status: 'error',
        loadingStage: 'plan',
        questions,
        answers,
        draft: null,
        error: check.error,
        warnings: check.warnings
      }
      return
    }
    const warnings = [...check.warnings]
    const requested = desiredWeeklySessions(questions, answers)
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
      questions,
      answers,
      draft: check.draft,
      error: '',
      warnings
    }
  }

  /** 用户确认：草稿成为本周计划；旧版本进历史，不就地覆盖 */
  function acceptPlanDraft(draft: PlanDraft, reference: Date = new Date()): Plan | null {
    const start = weekStart(reference)
    const end = new Date(start)
    end.setDate(start.getDate() + 6)
    const old = weekPlan(reference)
    if (old) {
      planHistory.value.push({ ...old, items: old.items.map(i => ({ ...i })) })
      plans.value = plans.value.filter(p => p.id !== old.id)
    }
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
          plannedSets: it.plannedSets,
          plannedReps: it.plannedReps,
          note: it.note,
          locked: false,
          completed: false
        })
      }
    }
    if (!items.length) return null
    const plan: Plan = {
      id,
      userId: userProfile.value?.id || 'demo-user',
      version: (old?.version ?? 0) + 1,
      createdAt: new Date().toISOString(),
      mode: currentMode.value,
      reason: `${draft.reason}（模型：${draft.model || '未命名'}，已由你确认 · ${PLAN_RULES_VERSION}）`,
      weekStartDate: toISODate(start),
      weekEndDate: toISODate(end),
      items,
      locked: false,
      source: 'llm'
    }
    plans.value.push(plan)
    persistState()
    resetPlanDraft()
    showToast({
      type: 'success',
      title: '计划已录入',
      message: `v${plan.version} · ${draft.days.length} 个训练日，可在计划页继续调整`,
      duration: 3500
    })
    return plan
  }

  /** 一次修改 = 一个新版本：旧版本进 planHistory，永不就地覆盖 */
  function bumpVersion(plan: Plan, items: PlanItem[], reason: string): Plan {    planHistory.value.push({ ...plan, items: plan.items.map(i => ({ ...i })) })
    plan.items = items
    plan.version += 1
    plan.reason = reason
    plan.createdAt = new Date().toISOString()
    persistState()
    return plan
  }

  /** 接受调整建议：锁定项与已完成项保持不变 */
  function acceptAdjustment(planId: string, changes: PlanChange[], reason: string): Plan | null {
    const plan = plans.value.find(p => p.id === planId)
    if (!plan) return null
    const changedIds = new Set(changes.filter(c => c.type === 'changed').map(c => c.itemId))
    const items = plan.items.map(item => {
      if (!changedIds.has(item.id)) return item
      const ch = changes.find(c => c.itemId === item.id)!
      return { ...item, ...(ch.newValue ?? {}) }
    })
    const moved = changedIds.size
    return bumpVersion(plan, items, `${reason}（改动 ${moved} 项，锁定项保持不变）`)
  }

  function rejectAdjustment(planId: string) {
    const plan = plans.value.find(p => p.id === planId)
    if (!plan) return
    showToast({ type: 'info', title: '已保持原计划', message: `v${plan.version} 未改动`, duration: 2500 })
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

  /** 手工录入：未满 18 岁与运动员模式的唯一安排入口 */
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
    if (userProfile.value) {
      userProfile.value = { ...userProfile.value, ...profile }
    } else {
      userProfile.value = {
        id: newId(),
        mode: currentMode.value,
        modeChangedAt: new Date().toISOString(),
        age: 25,
        goal: '',
        experience: '',
        availableTimes: [],
        equipment: [],
        restrictions: [],
        ...profile
      } as UserProfile
    }
    persistState()
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
    persistState()
    showToast({
      type: 'success',
      title: '训练已记录',
      message: `${session.exerciseName} · ${session.actualReps ?? 0} 次 · ${session.completionStatus === 'completed' ? '全部完成' : '部分完成'}`,
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
    persistState()
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
   * Record a meal with its items, then run the structure rules on it
   */
  function addMeal(input: NewMealInput): Meal {
    const mealId = newId()
    const items: MealItem[] = input.items.map(i => ({
      ...i,
      id: newId(),
      mealId,
      foodId: `${i.category}-${i.foodName}`,
      confirmed: true
    }))
    const completeness = deriveCompleteness(items)
    const dayCategories = [...new Set(
      meals.value.filter(m => m.date === input.date).flatMap(m => m.items.map(i => i.category))
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
    persistState()
    showToast({
      type: 'success',
      title: '餐次已记录',
      message: completeness === 'partial' ? '份量没填全，记为"部分记录"' : '结构与类别已按规则标注',
      duration: 3000
    })
    return meal
  }

  function removeMeal(mealId: string) {
    const meal = meals.value.find(m => m.id === mealId)
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
    persistState()
    return true
  }

  /** 隐私与导出偏好；当前版本不会据此自动删除数据 */
  function updatePrivacy(patch: Partial<PrivacySettings>) {
    privacy.value = { ...privacy.value, ...patch }
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

  /**
   * Clear all data
   */
  function clearAllData() {
    currentMode.value = 'public'
    userProfile.value = null
    sessions.value = []
    meals.value = []
    plans.value = []
    planHistory.value = []
    modeLog.value = []
    pendingSwitch.value = null
    privacy.value = { cameraEnabled: true, saveVideoLocally: false, dataRetentionDays: 90, exportFormat: 'json', showEnergyEstimate: false, saveFoodPhotoLocally: true }
    collapsedCards.value = []
    themePref.value = 'system'
    unitGrams.value = {}
    applyTheme()
    localStorage.removeItem('twopoles_state')
    void clearMealPhotos().catch(() => { /* 照片库清理失败时至少保留了主数据清除结果 */ })
    showToast({
      type: 'success',
      title: '数据已清除',
      message: '档案、训练、餐食、照片、计划版本、切换记录与本机换算口径都已从本机删除',
      duration: 3000
    })
  }

  return {
    // State
    currentMode,
    userProfile,
    sessions,
    meals,
    privacy,
    toasts,
    initialized,
    collapsedCards,
    themePref,
    plans,
    planHistory,
    modeLog,
    pendingSwitch,
    unitGrams,
    llmConfig,
    llmDefault,
    planDraftState,
    planLlmReady,

    // Computed
    isPublicMode,
    isAthleteMode,
    hasProfile,
    openPlans,
    switchPreview,

    // Actions
    init,
    persistState,
    requestModeSwitch,
    confirmModeSwitch,
    cancelModeSwitch,
    commitMode,
    copyPlanToMode,
    updateProfile,
    showToast,
    dismissToast,
    addSession,
    applyFeedback,
    addMeal,
    removeMeal,
    updateMealType,
    updatePrivacy,
    rememberUnitGrams,
    forgetUnitGrams,
    toggleCard,
    isCardCollapsed,
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
    acceptPlanDraft,
    resetPlanDraft,
    acceptAdjustment,
    rejectAdjustment,
    toggleItemLock,
    markItemCompleted,
    addManualItem,
    clearAllData
  }
})
