import { ref } from 'vue'
import { newId } from '@/utils/id'

export interface SupplementReminder {
  id: string
  name: string
  /** 剂量或备注，例如「1 粒」「5 g」 */
  dosage: string
  /** 每日提醒时间，HH:mm，已排序去重 */
  times: string[]
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export type SupplementPermission = NotificationPermission | 'unsupported'

export interface SupplementReminderPayload {
  title: string
  message: string
  reminder: SupplementReminder
  time: string
}

type ReminderDelivery = (payload: SupplementReminderPayload) => void

const STORAGE_KEY = 'twopoles.v1.supplements'
const FIRED_KEY = 'twopoles.v1.supplementFired'
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

const reminders = ref<SupplementReminder[]>([])
const permission = ref<SupplementPermission>(readPermission())
const hydrated = ref(false)

let swPromise: Promise<ServiceWorkerRegistration | null> | null = null
let schedulerTimer: number | undefined
let schedulerRunning = false
let schedulerDelivery: ReminderDelivery | null = null
let visibilityHandler: (() => void) | null = null
let lastCheck = 0
let firedDate = ''
const fired = new Set<string>()

function readPermission(): SupplementPermission {
  if (typeof Notification === 'undefined') return 'unsupported'
  return Notification.permission
}

function refreshPermission() {
  permission.value = readPermission()
}

function normalizeTimes(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  const times = input
    .filter((time): time is string => typeof time === 'string' && TIME_RE.test(time))
    .map(time => time.slice(0, 5))
  return [...new Set(times)].sort()
}

function normalizeReminder(raw: unknown): SupplementReminder | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  const name = typeof value.name === 'string' ? value.name.trim().slice(0, 30) : ''
  const times = normalizeTimes(value.times)
  if (!name || !times.length) return null
  return {
    id: typeof value.id === 'string' && value.id ? value.id : newId(),
    name,
    dosage: typeof value.dosage === 'string' ? value.dosage.trim().slice(0, 40) : '',
    times,
    enabled: value.enabled !== false,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : new Date().toISOString(),
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date().toISOString()
  }
}

function hydrate() {
  if (hydrated.value) return
  hydrated.value = true
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return
    reminders.value = parsed
      .map(normalizeReminder)
      .filter((reminder): reminder is SupplementReminder => !!reminder)
  } catch {
    // 本地数据损坏时以空列表启动，不阻塞页面
  }
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(reminders.value))
  } catch {
    // 本机存储不可用时提醒只在本次会话有效
  }
}

function sortTimes(times: string[]): string[] {
  return [...times].sort()
}

function addReminder(input: { name: string; dosage?: string; times: string[] }): SupplementReminder | null {
  hydrate()
  const name = input.name.trim().slice(0, 30)
  const times = sortTimes(normalizeTimes(input.times))
  if (!name || !times.length) return null
  const now = new Date().toISOString()
  const reminder: SupplementReminder = {
    id: newId(),
    name,
    dosage: (input.dosage ?? '').trim().slice(0, 40),
    times,
    enabled: true,
    createdAt: now,
    updatedAt: now
  }
  reminders.value = [reminder, ...reminders.value]
  persist()
  return reminder
}

function updateReminder(id: string, input: { name: string; dosage?: string; times: string[] }): SupplementReminder | null {
  hydrate()
  const current = reminders.value.find(reminder => reminder.id === id)
  if (!current) return null
  const name = input.name.trim().slice(0, 30)
  const times = sortTimes(normalizeTimes(input.times))
  if (!name || !times.length) return null
  const updated: SupplementReminder = {
    ...current,
    name,
    dosage: (input.dosage ?? '').trim().slice(0, 40),
    times,
    updatedAt: new Date().toISOString()
  }
  reminders.value = reminders.value.map(reminder => reminder.id === id ? updated : reminder)
  persist()
  return updated
}

function toggleReminder(id: string) {
  hydrate()
  reminders.value = reminders.value.map(reminder => reminder.id === id
    ? { ...reminder, enabled: !reminder.enabled, updatedAt: new Date().toISOString() }
    : reminder)
  persist()
}

function removeReminder(id: string) {
  hydrate()
  reminders.value = reminders.value.filter(reminder => reminder.id !== id)
  persist()
}

function dateKey(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function dueAt(date: Date, time: string): number {
  const [hours, minutes] = time.split(':').map(Number)
  const due = new Date(date)
  due.setHours(hours, minutes, 0, 0)
  return due.getTime()
}

function hydrateFired() {
  const today = dateKey(new Date())
  if (firedDate === today) return
  firedDate = today
  fired.clear()
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

async function ensureServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator) || !window.isSecureContext) return null
  // 生产环境的 SW 由 main.ts 启动时注册（同一 sw.js，重复 register 幂等）；
  // dev 不注册——SW 现在带运行时缓存，会把 Vite 的无哈希模块按缓存优先返回，污染开发服务器
  if (!import.meta.env.PROD) return null
  if (!swPromise) {
    swPromise = navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .then(registration => registration)
      .catch(() => {
        swPromise = null
        return null
      })
  }
  return swPromise
}

async function requestSupplementPermission(): Promise<SupplementPermission> {
  if (typeof Notification === 'undefined') {
    permission.value = 'unsupported'
    return permission.value
  }
  if (Notification.permission === 'granted') {
    permission.value = 'granted'
    void ensureServiceWorker()
    return permission.value
  }
  if (Notification.permission === 'denied') {
    permission.value = 'denied'
    return permission.value
  }
  try {
    permission.value = await Notification.requestPermission()
  } catch {
    permission.value = Notification.permission
  }
  if (permission.value === 'granted') void ensureServiceWorker()
  return permission.value
}

async function sendSupplementNotification(title: string, body: string, tag = 'supplement'): Promise<boolean> {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
    refreshPermission()
    return false
  }
  permission.value = 'granted'
  const options: NotificationOptions = {
    body,
    tag,
    icon: `${import.meta.env.BASE_URL}favicon.svg`,
    data: { url: `${import.meta.env.BASE_URL}supplements` }
  }
  try {
    const registration = await ensureServiceWorker()
    if (registration) {
      const ready = await navigator.serviceWorker.ready.catch(() => null)
      if (ready) {
        await ready.showNotification(title, options)
        return true
      }
    }
    const notification = new Notification(title, options)
    notification.onclick = () => {
      window.focus()
      notification.close()
    }
    return true
  } catch {
    try {
      new Notification(title, options)
      return true
    } catch {
      return false
    }
  }
}

function tick() {
  hydrate()
  refreshPermission()
  hydrateFired()
  const now = new Date()
  const nowMs = now.getTime()
  if (!lastCheck) lastCheck = nowMs

  for (const reminder of reminders.value) {
    if (!reminder.enabled) continue
    for (const time of reminder.times) {
      const due = dueAt(now, time)
      if (due <= lastCheck || due > nowMs) continue
      const key = `${reminder.id}:${firedDate}:${time}`
      if (fired.has(key)) continue
      fired.add(key)
      persistFired()
      const title = `补剂提醒 · ${reminder.name}`
      const message = `${time} 到点${reminder.dosage ? ` · ${reminder.dosage}` : ''}。`
      schedulerDelivery?.({ title, message, reminder, time })
      if (document.visibilityState !== 'visible' || !document.hasFocus()) {
        void sendSupplementNotification(title, message, `supplement-${reminder.id}-${time}`)
      }
    }
  }
  lastCheck = nowMs
}

/** AppShell 只启动一次；页面在后台时靠 interval 追平错过的分钟 */
function startSupplementScheduler(onReminder: ReminderDelivery): () => void {
  hydrate()
  refreshPermission()
  if (schedulerRunning) {
    schedulerDelivery = onReminder
    return () => stopSupplementScheduler()
  }
  schedulerRunning = true
  schedulerDelivery = onReminder
  lastCheck = Date.now()
  hydrateFired()
  void ensureServiceWorker()
  schedulerTimer = window.setInterval(tick, 15_000)
  visibilityHandler = () => {
    if (document.visibilityState === 'visible') tick()
  }
  document.addEventListener('visibilitychange', visibilityHandler)
  return () => stopSupplementScheduler()
}

function stopSupplementScheduler() {
  if (schedulerTimer !== undefined) {
    window.clearInterval(schedulerTimer)
    schedulerTimer = undefined
  }
  if (visibilityHandler) {
    document.removeEventListener('visibilitychange', visibilityHandler)
    visibilityHandler = null
  }
  schedulerRunning = false
  schedulerDelivery = null
  lastCheck = 0
}

function nextReminderLabel(reminder: SupplementReminder, reference = new Date()): string {
  if (!reminder.enabled) return '已暂停'
  if (!reminder.times.length) return '未设置时间'
  const now = reference.getTime()
  const nextToday = reminder.times
    .map(time => ({ time, at: dueAt(reference, time) }))
    .find(item => item.at > now)
  if (nextToday) return `今天 ${nextToday.time}`
  return `明天 ${reminder.times[0]}`
}

export function useSupplementReminders() {
  hydrate()
  refreshPermission()
  return {
    reminders,
    permission,
    addReminder,
    updateReminder,
    toggleReminder,
    removeReminder,
    requestSupplementPermission,
    sendSupplementNotification,
    nextReminderLabel
  }
}

export { startSupplementScheduler }
