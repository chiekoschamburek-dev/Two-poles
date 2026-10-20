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

/** 首页弹窗读的状态机：idle 不显示，loading/ready/error 都显示 */
export interface PlanDraftState {
  status: 'idle' | 'loading' | 'ready' | 'error'
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

/** 提示词：档案 + 日期 + 动作库 + 输出格式。动作库给定候选，减少模型瞎编动作 */
export function buildPlanMessages(
  profile: UserProfile,
  dates: string[],
  mode: 'public' | 'athlete'
): PlanMessages {
  const lib = activeExercises().map(e => `${e.name}（${e.type}，约 ${e.minutes} 分钟）`)
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

  const system = [
    '你是训练计划助手，为一个本地运动 App 生成一周训练计划。',
    '只输出一个 JSON 对象，不要 Markdown 代码块，不要任何解释文字。',
    'JSON 结构：{"reason":"一句话说明为什么这样排","days":[{"date":"YYYY-MM-DD","items":[{"exerciseName":"动作名","type":"类型","plannedDuration":20,"plannedSets":2,"plannedReps":10,"note":"可选提示"}]}]}',
    `type 只能是这些之一：${TRAINING_TYPES.join('、')}。`,
    '要求：',
    '1. 只安排给定日期里的一部分天，休息日就不要放进 days，不要硬凑满七天。',
    '2. 每天项目不超过 4 个，单日总时长不超过该用户填写的可用时间上限。',
    '3. exerciseName 优先从给定动作库里选；库里的动作不够用时才写别的，但要写清楚。',
    '4. 尊重"需要避开"的条件：例如避开跳跃就不要安排冲击类动作。',
    '5. 不提供医疗、康复、伤病或营养处方，不承诺成绩，不评价身体好坏。',
    '6. 不要输出 BMI、健康结论或"你应该能举多少"这类推断。'
  ].join('\n')

  const user = [
    `档案：${JSON.stringify(body, null, 2)}`,
    '',
    `可选日期（共 ${dates.length} 天）：${dates.map(d => `${d} ${weekdayOf(d)}`).join('、')}`,
    '',
    `动作库：${lib.join('；')}`
  ].join('\n')

  return { system, user }
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
}

/**
 * 通过本地代理调用模型。浏览器直连第三方 API 多数会被 CORS 拦掉，
 * 所以统一走同源的 /api/llm/*，由 vite 中间件或静态服务器转发。
 */
export async function callPlanProxy(cfg: LlmConfig, messages: PlanMessages, signal?: AbortSignal): Promise<ProxyResult> {
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
        messages: [
          { role: 'system', content: messages.system },
          { role: 'user', content: messages.user }
        ],
        temperature: 0.4
      }),
      signal
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      const detail = typeof data?.error === 'string' ? data.error : `HTTP ${res.status}`
      return { text: '', error: `模型接口返回错误：${detail}` }
    }
    if (typeof data?.text !== 'string' || !data.text.trim()) return { text: '', error: '模型返回了空内容。' }
    return { text: data.text, error: '' }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes('Failed to fetch')) {
      return { text: '', error: '连不上本地代理：请用 npm run dev / npm run preview 打开，而不是直接双击 dist/index.html。' }
    }
    return { text: '', error: `调用失败：${msg}` }
  }
}

/** 连通性测试：发一句最短的话，只看能不能拿到回复 */
export async function testLlmConfig(cfg: LlmConfig): Promise<{ ok: boolean; message: string }> {
  const res = await callPlanProxy(cfg, { system: '你是一个连通性测试。', user: '只回复两个字：可用' })
  if (res.error) return { ok: false, message: res.error }
  return { ok: true, message: `连接正常，模型回复：${res.text.trim().slice(0, 40)}` }
}
