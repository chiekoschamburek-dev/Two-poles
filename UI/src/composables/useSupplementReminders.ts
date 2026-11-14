import { ref } from 'vue'
import { Capacitor } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'
import { newId } from '@/utils/id'

/** 原生 App（Capacitor）里提醒交给系统本地通知：App 被杀也由系统闹钟弹出；
 * 浏览器里维持原有的页面定时器 + Service Worker 通知。 */
const isNative = Capacitor.isNativePlatform()
/** 高重要度渠道才会横幅弹出 + 锁屏显示；默认渠道只默默进通知中心 */
const SUPPLEMENT_CHANNEL = 'supplement-reminders'

let channelReady = false
async function ensureChannel(): Promise<void> {
  if (!isNative || channelReady) return
  try {
    await LocalNotifications.createChannel({
      id: SUPPLEMENT_CHANNEL,
      name: '补剂提醒',
      description: '每日补剂到点提醒',
      // 插件把 Importance/Visibility 定义为纯类型别名，运行时用 Android 数值：
      // importance 4 = HIGH（横幅弹出），visibility 1 = PUBLIC（锁屏可见）
      importance: 4,
      visibility: 1
    })
    channelReady = true
  } catch {
    // 渠道创建失败时回落默认渠道，通知仍会进通知中心
  }
}

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
  if (isNative) return 'default' // 真实权限由 refreshNativePermission 异步刷新
  if (typeof Notification === 'undefined') return 'unsupported'
  return Notification.permission
}

async function refreshNativePermission(): Promise<void> {
  if (!isNative) return
  try {
    const state = await LocalNotifications.checkPermissions()
    permission.value = state.display === 'granted' ? 'granted' : state.display === 'denied' ? 'denied' : 'default'
  } catch {
    permission.value = 'default'
  }
}

function refreshPermission() {
  // 原生端权限以 refreshNativePermission / requestSupplementPermission 的结果为准，
  // 不能用浏览器 API 刷回 default（webview 里 Notification 是 undefined）
  if (isNative) return
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
  void syncNativeSchedule()
}

/** 由提醒 id + 时间推导稳定的 int32 通知 id：同一条提醒同一时间可整点覆盖更新 */
function nativeNotificationId(reminderId: string, time: string): number {
  const key = `${reminderId}:${time}`
  let hash = 0
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0
  }
  // 0 在部分安卓系统里有特殊语义，避开
  return Math.abs(hash) || 1
}

/** 预约结果的可视化状态：补剂页直接展示，让「约没约上」可验证 */
const scheduleStatus = ref<{ count: number; exact: boolean; error: string | null }>({
  count: 0,
  exact: false,
  error: null
})

/** 把当前提醒表整表预约成系统每日重复通知；任何增删改后都整表重建。
 * 精确闹钟在安卓 14+ 默认收回，被拒时降级为不精确闹钟（仍会在 App 被杀后触发，只是可能延迟几分钟）。 */
async function syncNativeSchedule(): Promise<void> {
  if (!isNative) return
  try {
    const pending = await LocalNotifications.getPending()
    if (pending.notifications.length) {
      await LocalNotifications.cancel({
        notifications: pending.notifications.map(item => ({ id: item.id }))
      })
    }
    const notifications = reminders.value
      .filter(reminder => reminder.enabled)
      .flatMap(reminder => reminder.times.map(time => ({
        id: nativeNotificationId(reminder.id, time),
        title: `补剂提醒 · ${reminder.name}`,
        body: `${time} 到点${reminder.dosage ? ` · ${reminder.dosage}` : ''}。`,
        channelId: SUPPLEMENT_CHANNEL,
        schedule: {
          on: { hour: Number(time.slice(0, 2)), minute: Number(time.slice(3, 5)) },
          repeats: true,
          allowWhileIdle: true,
          exact: true
        }
      })))
    let exact = false
    if (notifications.length) {
      try {
        await LocalNotifications.schedule({ notifications })
        exact = true
      } catch {
        // 精确闹钟被系统拒绝（安卓 14+ 默认收回）：降级为不精确闹钟再约一次
        await LocalNotifications.schedule({
          notifications: notifications.map(item => ({ ...item, schedule: { ...item.schedule, exact: false } }))
        })
      }
    }
    const after = await LocalNotifications.getPending()
    scheduleStatus.value = {
      count: after.notifications.length,
      exact,
      error: after.notifications.length < notifications.length ? '部分提醒未被系统接受，请重试一次' : null
    }
  } catch (err) {
    scheduleStatus.value = {
      count: 0,
      exact: false,
      error: err instanceof Error ? err.message : String(err)
    }
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
  if (isNative) {
    try {
      const state = await LocalNotifications.requestPermissions()
      permission.value = state.display === 'granted' ? 'granted' : state.display === 'denied' ? 'denied' : 'default'
    } catch {
      permission.value = 'default'
    }
    if (permission.value === 'granted') void syncNativeSchedule()
    return permission.value
  }
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
  // 原生 App：发一条立即可见的系统通知（测试提醒用），日常提醒仍由整表预约的每日闹钟承担
  if (isNative) {
    try {
      await ensureChannel()
      await LocalNotifications.schedule({
        notifications: [{
          id: nativeNotificationId(`test:${Date.now()}`, 'now'),
          title,
          body,
          channelId: SUPPLEMENT_CHANNEL
        }]
      })
      return true
    } catch {
      return false
    }
  }
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
  void refreshNativePermission()
  void syncNativeSchedule()
  if (isNative) {
    // 点系统通知跳到补剂页；同一进程只注册一次（schedulerRunning 守卫）
    void LocalNotifications.addListener('localNotificationActionPerformed', () => {
      window.location.assign(`${import.meta.env.BASE_URL}supplements`)
    })
  }
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
    scheduleStatus,
    syncNativeSchedule,
    addReminder,
    updateReminder,
    toggleReminder,
    removeReminder,
    requestSupplementPermission,
    sendSupplementNotification,
    nextReminderLabel
  }
}

export { startSupplementScheduler, isNative as isNativeSupplements }
