// 大模型接入：配置存取、提示词、响应解析与校验。
// 只负责"把档案变成一份可审核的计划草稿"，不负责落库——落库由 store 在用户确认后做。
import type { TrainingType, UserProfile } from '@/types/domain'
import { activeExercises } from '@/services/exercises'

/** 用哪个模型：custom = 自己的接口，default = 服务端内置（只是偏好，不删除已填的配置） */
export type LlmPreference = 'custom' | 'default'

export interface LlmConfig {
  /** OpenAI 兼容的 base_url，例如 https://api.deepseek.com/v1 */
  baseUrl: string
  apiKey: string
  model: string
  /** 缺省时按"填了就用自定义，没填就用内置"推断，兼容旧数据 */
  preference?: LlmPreference
}

const STORAGE_KEY = 'twopoles_llm'

export const EMPTY_LLM_CONFIG: LlmConfig = { baseUrl: '', apiKey: '', model: '' }

/** 配置单独存一个 key：导出 JSON 时不会把密钥带到导出的档案里 */
export function loadLlmConfig(): LlmConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...EMPTY_LLM_CONFIG }
    const data = JSON.parse(raw)
    return {
      baseUrl: typeof data.baseUrl === 'string' ? data.baseUrl : '',
      apiKey: typeof data.apiKey === 'string' ? data.apiKey : '',
      model: typeof data.model === 'string' ? data.model : '',
      preference: data.preference === 'custom' || data.preference === 'default' ? data.preference : undefined
    }
  } catch {
    return { ...EMPTY_LLM_CONFIG }
  }
}

export function saveLlmConfig(cfg: LlmConfig): LlmConfig {
  const clean: LlmConfig = {
    baseUrl: cfg.baseUrl.trim().replace(/\/+$/, ''),
    apiKey: cfg.apiKey.trim(),
    model: cfg.model.trim(),
    preference: cfg.preference
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(clean))
  } catch {
    /* 隐私模式写不进去时也不阻塞使用 */
  }
  return clean
}

export function isLlmReady(cfg: LlmConfig | null | undefined): boolean {
  return !!cfg && !!cfg.baseUrl && !!cfg.model
}

export const TRAINING_TYPES: TrainingType[] = ['跑步', '动态热身', '坐站训练', '站姿弯举', '舒缓整理', '其他']

/**
 * 这次请求该用内置模型还是自己的配置。
 * 关键：切到内置只改"用哪个"，**不清空**已填的 base_url / key / 模型名。
 */
export function usingDefault(cfg: LlmConfig | null | undefined): boolean {
  if (!cfg) return true
  if (cfg.preference === 'default') return true
  if (cfg.preference === 'custom') return !isLlmReady(cfg)
  // 旧数据没有 preference：填了就视为想用自己的
  return !isLlmReady(cfg)
}

/** 服务端默认模型的状态：只有"有没有"和"叫什么"，不含任何密钥 */
export interface LlmDefaultStatus {
  available: boolean
  model: string | null
}

export const NO_LLM_DEFAULT: LlmDefaultStatus = { available: false, model: null }

/** 自己的配置优先，没配就用服务端默认 */
export function canUseLlm(cfg: LlmConfig | null | undefined, fallback: LlmDefaultStatus): boolean {
  if (usingDefault(cfg)) return fallback.available
  return isLlmReady(cfg) || fallback.available
}

/**
 * 问本机代理有没有配默认模型。
 * 拿不到就当没有：这条请求失败不应该影响页面其它部分。
 */
export async function fetchLlmStatus(): Promise<LlmDefaultStatus> {
  try {
    const res = await fetch('/api/llm/status', { headers: { 'Cache-Control': 'no-store' } })
    if (!res.ok) return { ...NO_LLM_DEFAULT }
    const data = await res.json()
    return {
      available: data?.available === true,
      model: typeof data?.model === 'string' ? data.model : null
    }
  } catch {
    return { ...NO_LLM_DEFAULT }
  }
}

export interface PlanDraftItem {
  exerciseName: string
  type: TrainingType
  plannedDuration: number
  plannedSets?: number
  plannedReps?: number
  note?: string
  /** 动作库里没有这个名字——不阻止录入，但界面上要标出来 */
  notInLibrary?: boolean
}

export interface PlanDraftDay {
  date: string
  items: PlanDraftItem[]
}

export interface PlanDraft {
  reason: string
  days: PlanDraftDay[]
  model: string
}

export interface PlanQuestion {
  id: string
  question: string
  /** 为什么问这个；显示在问题下方，帮用户判断怎么答 */
  why?: string
  options: string[]
  allowCustom?: boolean
}

/** 模型没给出可用问题时，至少确认每周训练次数；这也直接决定 days 的数量 */
export const DEFAULT_FREQUENCY_QUESTION: PlanQuestion = {
  id: 'weekly-frequency',
  question: '每周希望安排几次训练？',
  why: '决定训练日数量与恢复安排，避免默认只排三天',
  options: ['3 次', '4 次', '5 次', '6 次'],
  allowCustom: true
}

/** 弹窗读的状态机：questions 是“先问再生成”，ready/error 都显示 */
export interface PlanDraftState {
  status: 'idle' | 'loading' | 'questions' | 'ready' | 'error'
  /** loading 时区分是在准备问题还是在生成计划 */
  loadingStage: 'questions' | 'plan' | null
  questions: PlanQuestion[]
  answers: Record<string, string>
  draft: PlanDraft | null
  error: string
  warnings: string[]
}

export interface PlanMessages {
  system: string
  user: string
}

const WEEKDAY = ['日', '一', '二', '三', '四', '五', '六']

function weekdayOf(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const w = new Date(y, (m ?? 1) - 1, d ?? 1).getDay()
  return `周${WEEKDAY[w] ?? '?'}`
}

function profileSnapshot(profile: UserProfile, mode: 'public' | 'athlete'): Record<string, unknown> {
  const body: Record<string, unknown> = {
    模式: mode === 'athlete' ? '运动员模式' : '大众模式',
    年龄: profile.age,
    主要目标: profile.goal,
    运动经验: profile.experience,
    每次可用时间: profile.availableTimes,
    可用器材: profile.equipment,
    常训练场地: profile.availableVenues ?? [],
    需要避开: profile.restrictions,
    身高_cm: profile.height ?? null,
    体重_kg: profile.weight ?? null
  }
  if (mode === 'athlete') {
    body['专项'] = profile.discipline ?? null
    body['周期阶段'] = profile.cyclePhase ?? null
    body['周期'] = profile.cycleStartDate && profile.cycleEndDate
      ? `${profile.cycleStartDate} → ${profile.cycleEndDate}`
      : null
    body['阶段重点'] = profile.cycleFocus ?? null
    body['比赛目标'] = profile.goalType === 'competition'
      ? { 赛事: profile.targetEvent ?? null, 日期: profile.targetEventDate ?? null, 目标成绩: profile.targetResult ?? null }
      : null
    body['PB'] = (profile.personalBests ?? []).map(p => `${p.event} ${p.result}`)
    body['极限重量'] = (profile.gymRecords ?? []).map(r => `${r.lift} ${r.weight}kg${r.reps ? ` × ${r.reps}` : ''}（${r.kind === '1rm' ? '1RM' : '训练最高'}）`)
  }
  return body
}

export interface PlanAnswerContext {
  questions: PlanQuestion[]
  answers: Record<string, string>
}

function answerLines(context?: PlanAnswerContext): string[] {
  if (!context) return []
  return context.questions
    .map(q => ({ question: q.question, answer: context.answers[q.id]?.trim() ?? '' }))
    .filter(x => x.answer)
    .map(x => `${x.question} → ${x.answer}`)
}

/** 先问再生成：只输出补充问题，不生成计划 */
export function buildPlanQuestionMessages(
  profile: UserProfile,
  mode: 'public' | 'athlete',
  dates: string[]
): PlanMessages {
  const body = profileSnapshot(profile, mode)
  const system = [
    '你是训练计划助手。现在先不要生成训练计划，只判断现有档案里还缺哪些会显著改变排课的信息，并向用户提问。',
    '只输出一个 JSON 对象，不要 Markdown 代码块，不要任何解释文字。',
    'JSON 结构：{"questions":[{"id":"weekly-frequency","question":"每周希望安排几次训练？","why":"决定训练日数量与恢复安排","options":["3 次","4 次","5 次","6 次"]}]}',
    '要求：',
    '1. 最多 3 个问题；每个问题给 2–5 个短选项；只问档案里没有、且会影响训练日数量、单次安排或恢复的信息。',
    '2. 必须包含一个每周训练次数的问题（如果档案和当前上下文没有给出次数）。不要默认只排三天。',
    '3. 可以问：每周几次、偏好哪几天、每次能练多久、是否需要更多恢复、最想练/最不想练什么。不要重复档案里已有的年龄、目标、经验、器材、场地、回避条件。',
    '4. 不问医疗诊断、伤病治疗、药物、体重评价或竞技成绩承诺；不要求用户提供敏感健康数据。',
    '5. 如果档案已经足够，返回 {"questions":[]}，不要为了问而问。'
  ].join('\n')

  const user = [
    `档案：${JSON.stringify(body, null, 2)}`,
    '',
    `本周可选日期（共 ${dates.length} 天）：${dates.map(d => `${d} ${weekdayOf(d)}`).join('、')}`,
    '',
    '请只输出补充问题 JSON。'
  ].join('\n')

  return { system, user }
}

export interface QuestionValidation {
  questions: PlanQuestion[]
  error: string
  warnings: string[]
}

const FREQUENCY_QUESTION_RE = /每周|一周|频率|几次|训练次数|训练日数量/

export function validatePlanQuestions(raw: unknown): QuestionValidation {
  const warnings: string[] = []
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { questions: [], error: '模型没有返回可用的补充问题。', warnings }
  }
  const obj = raw as Record<string, unknown>
  const rawQuestions = Array.isArray(obj.questions) ? obj.questions : []
  const seen = new Set<string>()
  const questions: PlanQuestion[] = []
  for (const entry of rawQuestions.slice(0, 4)) {
    if (!entry || typeof entry !== 'object') continue
    const row = entry as Record<string, unknown>
    const question = typeof row.question === 'string' ? row.question.trim().slice(0, 120) : ''
    if (!question) continue
    const rawId = typeof row.id === 'string' ? row.id.trim().slice(0, 40) : ''
    let id = rawId || `q-${questions.length + 1}`
    while (seen.has(id)) id = `${id}-${questions.length + 1}`
    seen.add(id)
    const options = Array.isArray(row.options)
      ? [...new Set(row.options.filter((o): o is string => typeof o === 'string').map(o => o.trim().slice(0, 30)).filter(Boolean))].slice(0, 5)
      : []
    const why = typeof row.why === 'string' && row.why.trim() ? row.why.trim().slice(0, 100) : undefined
    questions.push({ id, question, why, options, allowCustom: true })
    if (questions.length >= 3) break
  }
  if (!questions.length) {
    warnings.push('模型没有给出额外问题，先确认每周训练次数。')
    return { questions: [DEFAULT_FREQUENCY_QUESTION], error: '', warnings }
  }
  if (!questions.some(q => FREQUENCY_QUESTION_RE.test(q.question) || q.id.includes('frequency'))) {
    if (questions.length >= 3) questions.pop()
    questions.push(DEFAULT_FREQUENCY_QUESTION)
    warnings.push('模型没有问到每周训练次数，已补上这一问。')
  }
  return { questions, error: '', warnings }
}

/** 从问题/回答里提取用户希望的一周训练次数（1–7），解析不到返回 null */
export function desiredWeeklySessions(
  questions: PlanQuestion[],
  answers: Record<string, string>
): number | null {
  const frequency = questions.find(q => FREQUENCY_QUESTION_RE.test(q.question) || q.id.includes('frequency'))
  const texts = frequency
    ? [answers[frequency.id] ?? '']
    : Object.values(answers)
  for (const text of texts) {
    const m = /([1-7])\s*(?:次|天)?/.exec(text)
    if (m) {
      const n = Number(m[1])
      if (n >= 1 && n <= 7) return n
    }
  }
  return null
}

/** 提示词：档案 + 日期 + 动作库 + 输出格式；answers 来自生成前的补充问题 */
export function buildPlanMessages(
  profile: UserProfile,
  dates: string[],
  mode: 'public' | 'athlete',
  context?: PlanAnswerContext
): PlanMessages {
  const lib = activeExercises().map(e => `${e.name}（${e.type}，约 ${e.minutes} 分钟）`)
  const body = profileSnapshot(profile, mode)
  const answers = answerLines(context)

  const system = [
    '你是训练计划助手，为一个本地运动 App 生成一周训练计划。',
    '只输出一个 JSON 对象，不要 Markdown 代码块，不要任何解释文字。',
    'JSON 结构：{"reason":"一句话说明为什么这样排","days":[{"date":"YYYY-MM-DD","items":[{"exerciseName":"动作名","type":"类型","plannedDuration":20,"plannedSets":2,"plannedReps":10,"note":"可选提示"}]}]}',
    `type 只能是这些之一：${TRAINING_TYPES.join('、')}。`,
    '要求：',
    '1. 只把训练日放进 days，休息日不要放，也不要硬凑满七天。',
    '2. 必须遵守用户补充回答里的每周训练次数：回答 N 次，就安排 N 个训练日（最多 6 个，至少保留 1 个休息日）。如果回答里没有次数，大众模式默认安排 4–5 个训练日，运动员模式安排 5–6 个；不要默认只排三天。',
    '3. 如果用户回答与"每次可用时间"冲突，优先满足训练次数，缩短单次项目数量或时长，并在 reason 里说明这个取舍。',
    '4. 每天项目不超过 4 个，单日总时长不超过该用户填写的可用时间上限。',
    '5. exerciseName 优先从给定动作库里选；库里的动作不够用时才写别的，但要写清楚。',
    '6. 尊重"需要避开"的条件：例如避开跳跃就不要安排冲击类动作；有伤病、孕期或未成年限制时，不强行加量。',
    '7. 不提供医疗、康复、伤病或营养处方，不承诺成绩，不评价身体好坏。',
    '8. 不要输出 BMI、健康结论或"你应该能举多少"这类推断。'
  ].join('\n')

  const userLines = [
    `档案：${JSON.stringify(body, null, 2)}`,
    ''
  ]
  if (answers.length) {
    userLines.push('用户补充回答（优先于默认模板）：', ...answers.map(a => `- ${a}`), '')
  }
  userLines.push(
    `可选日期（共 ${dates.length} 天）：${dates.map(d => `${d} ${weekdayOf(d)}`).join('、')}`,
    '',
    `动作库：${lib.join('；')}`
  )
  return { system, user: userLines.join('\n') }
}

/** 模型有时会把 JSON 包在代码块或解释里，这里只取最外层对象 */
export function extractJson(text: string): unknown | null {
  if (!text) return null
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)
  const candidates = [fenced?.[1], text]
  for (const c of candidates) {
    if (!c) continue
    const start = c.indexOf('{')
    const end = c.lastIndexOf('}')
    if (start === -1 || end <= start) continue
    try {
      return JSON.parse(c.slice(start, end + 1))
    } catch {
      /* 试下一个候选 */
    }
  }
  return null
}

const asInt = (v: unknown, min: number, max: number, fallback: number): number => {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

export interface DraftValidation {
  draft: PlanDraft | null
  error: string
  warnings: string[]
}

/**
 * 校验模型输出：日期必须落在给定范围内、类型必须合法、时长夹在合理区间。
 * 不认识的动作不丢弃，但打上 notInLibrary 并在警告里列出来——最后由用户决定。
 */
export function validatePlanDraft(raw: unknown, dates: string[], model = ''): DraftValidation {
  const warnings: string[] = []
  if (!raw || typeof raw !== 'object') return { draft: null, error: '模型返回的内容不是 JSON 对象。', warnings }
  const obj = raw as Record<string, unknown>
  const rawDays = Array.isArray(obj.days) ? obj.days : []
  if (!rawDays.length) return { draft: null, error: '模型没有给出任何训练日。', warnings }

  const lib = new Map(activeExercises().map(e => [e.name, e]))
  const allowed = new Set(dates)
  const seen = new Set<string>()
  const days: PlanDraftDay[] = []

  for (const d of rawDays) {
    if (!d || typeof d !== 'object') continue
    const day = d as Record<string, unknown>
    const date = typeof day.date === 'string' ? day.date.slice(0, 10) : ''
    if (!allowed.has(date)) {
      warnings.push(`忽略了范围外的日期 ${date || '（空）'}`)
      continue
    }
    if (seen.has(date)) {
      warnings.push(`同一天出现多次，只保留第一份：${date}`)
      continue
    }
    const rawItems = Array.isArray(day.items) ? day.items : []
    const items: PlanDraftItem[] = []
    for (const it of rawItems.slice(0, 6)) {
      if (!it || typeof it !== 'object') continue
      const row = it as Record<string, unknown>
      const name = typeof row.exerciseName === 'string' ? row.exerciseName.trim() : ''
      if (!name) continue
      const hit = lib.get(name)
      const typeRaw = typeof row.type === 'string' ? row.type : ''
      const type = (hit?.type ?? (TRAINING_TYPES.includes(typeRaw as TrainingType) ? (typeRaw as TrainingType) : '其他')) as TrainingType
      if (!hit) warnings.push(`动作库未收录：${name}`)
      const item: PlanDraftItem = {
        exerciseName: name,
        type,
        plannedDuration: asInt(row.plannedDuration, 1, 180, hit?.minutes ?? 10),
        notInLibrary: !hit
      }
      if (row.plannedSets !== undefined) item.plannedSets = asInt(row.plannedSets, 1, 20, hit?.sets ?? 1)
      else if (hit?.sets) item.plannedSets = hit.sets
      if (row.plannedReps !== undefined) item.plannedReps = asInt(row.plannedReps, 1, 200, hit?.reps ?? 0)
      else if (hit?.reps) item.plannedReps = hit.reps
      const note = typeof row.note === 'string' ? row.note.trim() : ''
      if (note) item.note = note.slice(0, 80)
      items.push(item)
    }
    if (!items.length) {
      warnings.push(`${date} 没有可用项目，已跳过`)
      continue
    }
    if (rawItems.length > 6) warnings.push(`${date} 项目超过 6 个，只保留前 6 个`)
    seen.add(date)
    days.push({ date, items })
  }

  if (!days.length) return { draft: null, error: '模型给出的日期都不在本次范围内。', warnings }
  days.sort((a, b) => a.date.localeCompare(b.date))
  const reason = typeof obj.reason === 'string' && obj.reason.trim() ? obj.reason.trim().slice(0, 200) : '模型生成的一周安排'
  return { draft: { reason, days, model }, error: '', warnings }
}

export interface ProxyResult {
  text: string
  error: string
  /** 上游实际返回的模型名；代理没给时退回配置里的模型名 */
  model?: string
}

export type LlmContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | LlmContentPart[]
}

export interface LlmCallOptions {
  temperature?: number
  signal?: AbortSignal
}

/**
 * 通过同源代理调用模型。浏览器直连第三方 API 多数会被 CORS 拦掉，
 * 所以统一走 /api/llm/*：本地由 vite.config.ts 的中间件转发，
 * 线上由阿里云 ESA 函数入口（UI/server/llm.js，esa.jsonc 的 entry）转发。
 * 文本计划与照片识别共用这一条调用路径和同一份模型配置。
 */
export async function callLlmChat(
  cfg: LlmConfig,
  messages: LlmMessage[],
  options: LlmCallOptions = {}
): Promise<ProxyResult> {
  // 偏好为内置（或自己没填）时交给服务端默认模型；两者都没有时由代理返回明确错误
  const useDefault = usingDefault(cfg)
  try {
    const res = await fetch('/api/llm/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        useDefault,
        baseUrl: cfg.baseUrl,
        apiKey: cfg.apiKey,
        model: cfg.model,
        messages,
        temperature: options.temperature ?? 0.4
      }),
      signal: options.signal
    })
    const data = await res.json().catch(() => ({}))
    const model = typeof data?.model === 'string' && data.model.trim() ? data.model.trim() : cfg.model
    if (!res.ok) {
      const detail = typeof data?.error === 'string' ? data.error : `HTTP ${res.status}`
      return { text: '', error: `模型接口返回错误：${detail}`, model }
    }
    // ESA 函数会先发一个空格再流式写入 JSON；上游错误也会以 200 + {error} 的形式回来
    if (typeof data?.error === 'string' && data.error.trim()) {
      return { text: '', error: `模型接口返回错误：${data.error}`, model }
    }
    if (typeof data?.text !== 'string' || !data.text.trim()) {
      return {
        text: '',
        error: '模型代理没有返回内容：本地请用 npm run dev / npm run preview；线上请确认 /api/llm/chat 已由 ESA 函数入口处理，而不是被 SPA 回退成 index.html。',
        model
      }
    }
    return { text: data.text, error: '', model }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes('Failed to fetch')) {
      return {
        text: '',
        error: '连不上本地代理：本地请用 npm run dev / npm run preview；若已部署到 ESA，请确认函数入口（entry）和函数变量 LLM_DEFAULT_* 已配置并重新部署。'
      }
    }
    return { text: '', error: `调用失败：${msg}` }
  }
}

export async function callPlanProxy(cfg: LlmConfig, messages: PlanMessages, signal?: AbortSignal): Promise<ProxyResult> {
  return callLlmChat(cfg, [
    { role: 'system', content: messages.system },
    { role: 'user', content: messages.user }
  ], { signal })
}

/** 连通性测试：发一句最短的话，只看能不能拿到回复 */
export async function testLlmConfig(cfg: LlmConfig): Promise<{ ok: boolean; message: string }> {
  const res = await callPlanProxy(cfg, { system: '你是一个连通性测试。', user: '只回复两个字：可用' })
  if (res.error) return { ok: false, message: res.error }
  return { ok: true, message: `连接正常，模型回复：${res.text.trim().slice(0, 40)}` }
}
