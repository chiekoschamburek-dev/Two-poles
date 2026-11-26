// 「今日饮食反馈」：规则引擎检测 + 模型润色 + Toast/卡片呈现。
//
// 三条时间口径：
// 1) 记/改/删今天的餐食都会重算反馈；Toast 只在保存或修改后弹，且每条规则每天最多弹一次。
// 2) 晚间总结默认 21:30（可配置）：页面开着过点 15 秒内触发；错过整晚，当天内下次打开补弹一次，隔天作废。
// 3) 点「今日不再提醒」只关今天的 Toast，卡片本身仍随时可看、实时更新。
//
// 表达分两层：规则文案永远先出（engine = 'rules'），模型在超时内返回才替换（engine = 'llm'）；
// 任何失败都静默保持规则文案，不打扰使用。
import { ref, watch } from 'vue'
import { useAppStore } from '@/stores/app'
import {
  dayIntakeFacts,
  dietFindings,
  DIET_RULE_TITLES,
  limitImmediate,
  type DayIntakeFacts,
  type DietFinding,
  type DietRuleId
} from '@/services/dietFeedbackRules'
import {
  buildDietPhraseMessages,
  callLlmChat,
  canUseLlm,
  extractJson,
  validateDietPhrases
} from '@/services/llm'
import { toISODate } from '@/utils/time'

const SETTINGS_KEY = 'twopoles.v1.dietFeedback'
const FIRED_KEY = 'twopoles.v1.dietFeedbackFired'
const DISMISS_KEY = 'twopoles.v1.dietFeedbackDismissed'
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
const PHRASE_TIMEOUT_MS = 15_000

export type DietEngine = 'rules' | 'llm'

/** 卡片与 Toast 展示的一条：advice 可能被模型替换过 */
export interface DietFeedbackItem extends DietFinding {
  advice: string
  engine: DietEngine
}

export interface DietFeedbackSettings {
  enabled: boolean
  /** 晚间总结时间，HH:mm */
  summaryTime: string
}

const DEFAULT_SETTINGS: DietFeedbackSettings = { enabled: true, summaryTime: '21:30' }

const settings = ref<DietFeedbackSettings>({ ...DEFAULT_SETTINGS })
const items = ref<DietFeedbackItem[]>([])
/** 当前命中规则 id 签名；卡片空态判断用 */
const facts = ref<DayIntakeFacts | null>(null)

/** 规则 id → 润色文案；日期或结论集变化前一直有效 */
let phrases = new Map<DietRuleId, string>()
let phrasesSignature = ''

let initialized = false
let store: ReturnType<typeof useAppStore> | null = null
let stopWatch: (() => void) | null = null
let tickTimer: number | undefined
let tickDay = ''
let phrasing = false
let phraseAbort: AbortController | null = null

const fired = new Set<string>()
let firedDate = ''

function readSettings(): DietFeedbackSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    const data = JSON.parse(raw) as Record<string, unknown>
    return {
      enabled: data.enabled !== false,
      summaryTime: typeof data.summaryTime === 'string' && TIME_RE.test(data.summaryTime)
        ? data.summaryTime.slice(0, 5)
        : DEFAULT_SETTINGS.summaryTime
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

function persistSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings.value))
  } catch {
    // 写不进去时设置只在本次会话有效
  }
}

function dateKey(date: Date): string {
  return toISODate(date)
}

function hydrateFired() {
  const today = dateKey(new Date())
  if (firedDate === today) return
  firedDate = today
  fired.clear()
  phrases = new Map()
  phrasesSignature = ''
  try {
    const raw = localStorage.getItem(FIRED_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw) as { date?: unknown; keys?: unknown }
    if (parsed.date !== today || !Array.isArray(parsed.keys)) return
    for (const key of parsed.keys) {
      if (typeof key === 'string') fired.add(key)
    }
  } catch {
    // ignore
  }
}

function persistFired() {
  try {
    localStorage.setItem(FIRED_KEY, JSON.stringify({ date: firedDate, keys: [...fired] }))
  } catch {
    // ignore
  }
}

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === dateKey(new Date())
  } catch {
    return false
  }
}

/** @returns 是否真的写进了 localStorage；写不进去时如实说明只关本次 */
function dismissToday(): boolean {
  let persisted = false
  try {
    localStorage.setItem(DISMISS_KEY, dateKey(new Date()))
    persisted = true
  } catch {
    // 写不进去就只在本次会话里生效，不假装已经记住
  }
  return persisted
}

function hhmm(now: Date): string {
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
}

/** 模型不可用/失败都静默：引擎标记留在 rules，文案不动 */
async function phraseFindings(list: DietFinding[], factsValue: DayIntakeFacts, summary: boolean) {
  if (!store || !list.length) return
  const signature = `${firedDate}:${summary ? 's' : 'i'}:${list.map(f => f.id).join(',')}`
  if (signature === phrasesSignature || phrasing) return
  if (!canUseLlm(store.llmConfig, store.llmDefault)) return
  phrasing = true
  // 失败也标记本次结论集已尝试过：否则 15 秒的 tick 会对同一个错误反复发请求
  phrasesSignature = signature
  phraseAbort = new AbortController()
  const timeout = setTimeout(() => phraseAbort?.abort(), PHRASE_TIMEOUT_MS)
  try {
    const messages = buildDietPhraseMessages(list, factsValue, summary)
    const result = await callLlmChat(store.llmConfig, [
      { role: 'system', content: messages.system },
      { role: 'user', content: messages.user }
    ], { signal: phraseAbort.signal })
    if (result.error) return
    const { phrases: fresh } = validateDietPhrases(extractJson(result.text), list)
    for (const [id, advice] of Object.entries(fresh)) {
      phrases.set(id as DietRuleId, advice)
    }
    applyPhrases()
  } catch {
    // 超时/网络失败都保持规则文案
  } finally {
    clearTimeout(timeout)
    phraseAbort = null
    phrasing = false
  }
}

function applyPhrases() {
  if (!phrases.size) return
  items.value = items.value.map(item => {
    const phrased = phrases.get(item.id)
    return phrased && phrased !== item.advice
      ? { ...item, advice: phrased, engine: 'llm' as const }
      : item
  })
}

function presentItems(list: DietFinding[]): DietFeedbackItem[] {
  return list.map(item => {
    const phrased = phrases.get(item.id)
    return phrased ? { ...item, advice: phrased, engine: 'llm' as const } : { ...item, engine: 'rules' as const }
  })
}

/**
 * 重算今天的反馈。
 * @param notify 保存/修改后为 true：新触发的规则弹 Toast（每条每天最多一次）；
 *               初始化与历史数据装载为 false，只更新卡片。
 */
function recompute(notify: boolean) {
  if (!store) return
  hydrateFired()
  const now = new Date()
  const today = dateKey(now)
  const factsValue = dayIntakeFacts(store.meals, today)
  facts.value = factsValue
  const list = settings.value.enabled
    ? dietFindings(factsValue, hhmm(now))
    : []
  items.value = presentItems(list)

  if (notify && settings.value.enabled && !readDismissed()) {
    const fresh = limitImmediate(list.filter(f => !fired.has(f.id)))
    for (const finding of fresh) {
      fired.add(finding.id)
      const display = presentItems([finding])[0]
      store.showToast({
        type: 'info',
        title: `饮食反馈 · ${finding.title}`,
        message: display.advice,
        duration: 10000
      })
    }
    if (fresh.length) persistFired()
  }

  // 结论集变化才重新润色：同一天内反复编辑不反复请求
  void phraseFindings(list, factsValue, false)
}

function tick() {
  if (!store) return
  const now = new Date()
  const today = dateKey(now)
  if (tickDay !== today) {
    tickDay = today
    phrases = new Map()
    phrasesSignature = ''
  }
  recompute(false)
  hydrateFired()

  // 晚间总结：过了设定时间且今天还没发过就发一次（补发口径天然成立：隔天 time 未到不触发）
  if (!settings.value.enabled || readDismissed()) return
  if (fired.has('summary')) return
  if (hhmm(now) < settings.value.summaryTime) return
  const factsValue = dayIntakeFacts(store.meals, today)
  const list = dietFindings(factsValue, hhmm(now), { summary: true })
  fired.add('summary')
  persistFired()
  if (!list.length) return
  void phraseFindings(list, factsValue, true)
  const titles = list.map(f => DIET_RULE_TITLES[f.id]).join('；')
  store.showToast({
    type: 'info',
    title: '今日饮食总结',
    message: `${titles}。展开看具体建议`,
    duration: 10000
  })
  if (document.visibilityState !== 'visible' || !document.hasFocus()) {
    void sendDietNotification('今日饮食总结', titles)
  }
}

/** 复用补剂那条系统通知路径：权限没给过就静默跳过，不在这条流程里再要权限 */
async function sendDietNotification(title: string, body: string): Promise<boolean> {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return false
  const options: NotificationOptions = {
    body,
    tag: 'diet-summary',
    icon: `${import.meta.env.BASE_URL}favicon.svg`,
    data: { url: `${import.meta.env.BASE_URL}meals` }
  }
  try {
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator && window.isSecureContext) {
      const registration = await navigator.serviceWorker.ready.catch(() => null)
      if (registration) {
        await registration.showNotification(title, options)
        return true
      }
    }
    new Notification(title, options)
    return true
  } catch {
    return false
  }
}

function mealsSignature(): string {
  if (!store) return ''
  return store.meals
    .map(m => [
      m.id,
      m.date,
      m.mealType,
      m.completeness,
      m.items.map(i => `${i.foodName}:${i.category}:${i.portionSize ?? ''}`).join(',')
    ].join('|'))
    .join('\n')
}

/** 由 AppShell 在 store.init() 之后调用；只初始化一次 */
function initDietFeedback() {
  if (initialized) return
  initialized = true
  store = useAppStore()
  settings.value = readSettings()
  hydrateFired()
  tickDay = dateKey(new Date())
  // 首次装载不弹 Toast：即时反馈只跟「保存/修改」走，总结有自己的补发口径
  recompute(false)

  // 今天的餐食任何增改删（含逐条确认/删条目）都会改这个签名；历史日期的改动重算结果不变，无副作用
  stopWatch = watch(mealsSignature, () => {
    recompute(true)
  })

  tickTimer = window.setInterval(tick, 15_000)
  document.addEventListener('visibilitychange', onVisibility)
}

function onVisibility() {
  if (document.visibilityState === 'visible') tick()
}

function stopDietFeedback() {
  if (tickTimer !== undefined) {
    window.clearInterval(tickTimer)
    tickTimer = undefined
  }
  document.removeEventListener('visibilitychange', onVisibility)
  stopWatch?.()
  stopWatch = null
  initialized = false
  store = null
}

function updateSettings(patch: Partial<DietFeedbackSettings>) {
  if (patch.summaryTime !== undefined) {
    const time = patch.summaryTime.trim()
    patch = { ...patch, summaryTime: TIME_RE.test(time) ? time.slice(0, 5) : settings.value.summaryTime }
  }
  settings.value = { ...settings.value, ...patch }
  persistSettings()
  recompute(false)
}

export function useDietFeedback() {
  return {
    settings,
    items,
    facts,
    initDietFeedback,
    dismissToday,
    updateSettings,
    /** 给「今日不再提醒」用：点了之后今天的 Toast 是否真的不再出现 */
    readDismissed
  }
}

export { initDietFeedback, dismissToday as dismissDietToday, stopDietFeedback }
