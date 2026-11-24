import { ref } from 'vue'
import { Capacitor, registerPlugin } from '@capacitor/core'
import { LocalNotifications, type Channel, type LocalNotificationSchema } from '@capacitor/local-notifications'
import { newId } from '@/utils/id'

const isNative = Capacitor.isNativePlatform()
const isAndroid = Capacitor.getPlatform() === 'android'
/**
 * 通道 ID 带 v2 前缀：Android 只在通道第一次创建时接受 importance，
 * 之后 createNotificationChannel 不会更新它。旧版安装留下的通道若被降级过，
 * 复用同一个 ID 无论传多少次 HIGH 都不会有横幅，只能换新 ID 重建。
 */
const SUPPLEMENT_CHANNEL = 'supplement-reminders-v2'
const SCHEDULE_VERSION = 3
const ANDROID_HIGH_IMPORTANCE = 4
const SupplementNotificationSettings = registerPlugin<{
  open(options: { channel: boolean }): Promise<void>
  status(): Promise<{
    channelId: string
    notificationsEnabled: boolean
    importance: number
    batteryUnrestricted: boolean
    sdk: number
  }>
  requestBatteryExemption(): Promise<void>
}>('SupplementNotificationSettings')

/** 通知链路的真实状态；任一环不满足都不会有横幅，界面据此逐项提示 */
export interface SupplementNotificationDiagnostics {
  notificationsEnabled: boolean
  /** >=4 才会横幅；0 = 用户关闭了该通道；-1 = 通道尚未创建 */
  importance: number
  batteryUnrestricted: boolean
  checkedAt: number | null
}

const diagnostics = ref<SupplementNotificationDiagnostics | null>(null)

async function refreshNotificationDiagnostics(): Promise<SupplementNotificationDiagnostics | null> {
  if (!isAndroid) return null
  try {
    const state = await SupplementNotificationSettings.status()
    diagnostics.value = {
      notificationsEnabled: state.notificationsEnabled,
      importance: state.importance,
      batteryUnrestricted: state.batteryUnrestricted,
      checkedAt: Date.now()
    }
    return diagnostics.value
  } catch {
    // 旧版 APK 没有这个插件方法：保留上一次结果，不把「读不到」当成「已关闭」
    return diagnostics.value
  }
}

async function requestBatteryExemption(): Promise<void> {
  try {
    await SupplementNotificationSettings.requestBatteryExemption()
  } finally {
    void refreshNotificationDiagnostics()
  }
}

async function ensureChannel(): Promise<Channel | undefined> {
  if (!isAndroid) return
  try {
    await LocalNotifications.createChannel({
      id: SUPPLEMENT_CHANNEL,
      name: '补剂提醒',
      description: '每日补剂到点提醒',
      importance: ANDROID_HIGH_IMPORTANCE,
      visibility: 1,
      vibration: true
    })
  } catch (error) {
    // Android 7 使用应用级通知权限，没有通知渠道。
    if ((error as { code?: string }).code === 'UNAVAILABLE') return
    throw error
  }
  const { channels } = await LocalNotifications.listChannels()
  const channel = channels.find(item => item.id === SUPPLEMENT_CHANNEL)
  if (!channel) throw new Error('未能创建补剂提醒通知类别')
  return channel
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

async function refreshNativePermission(): Promise<SupplementPermission> {
  const state = await LocalNotifications.checkPermissions()
  if (state.display === 'granted') {
    const { value } = await LocalNotifications.areEnabled()
    permission.value = value ? 'granted' : 'denied'
  } else {
    permission.value = state.display === 'denied' ? 'denied' : 'default'
  }
  return permission.value
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
  return (Math.abs(hash) & 0x7fffffff) || 1
}

/** 预约结果的可视化状态：补剂页直接展示，让「约没约上」可验证 */
const scheduleStatus = ref<{ count: number; exact: boolean | null; channelImportance: number | null; error: string | null }>({
  count: 0,
  exact: null,
  channelImportance: null,
  error: null
})

/**
 * 通知文案：只提醒、不评判，也不假设「吃没吃」——App 无从得知。
 * 正文按「日期 + 提醒 + 时间」轮换，同一句不会天天重复。
 */
const BODIES_WITH_DOSAGE = [
  (dosage: string) => `${dosage}，到点啦。`,
  (dosage: string) => `今天 ${dosage}，别忘了。`,
  (dosage: string) => `${dosage} · 顺手吃一下。`
]

const BODIES_PLAIN = [
  () => '到点啦，顺手吃一下。',
  () => '时间到了，别忘了。',
  () => '到点了，吃完接着忙。'
]

function stableHash(input: string): number {
  let hash = 0
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0
  }
  return Math.abs(hash)
}

export function buildSupplementNotification(
  reminder: Pick<SupplementReminder, 'id' | 'name' | 'dosage'>,
  time: string,
  date = new Date()
): { title: string; body: string } {
  const seed = `${dateKey(date)}:${reminder.id}:${time}`
  const dosage = reminder.dosage.trim()
  const pool = dosage ? BODIES_WITH_DOSAGE : BODIES_PLAIN
  const build = pool[stableHash(seed) % pool.length]
  return {
    title: `该吃 ${reminder.name} 了`,
    body: dosage ? build(dosage) : (build as () => string)()
  }
}

/** 旧版本用标题前缀认领自己的通知；新版改用 extra 标记，文案怎么改都不影响识别 */
function isSupplementNotification(item: LocalNotificationSchema): boolean {
  if (!item.schedule?.on) return false
  if (item.extra?.supplementReminderId) return true
  if (item.extra?.supplementScheduleVersion) return true
  return typeof item.title === 'string' && item.title.startsWith('补剂提醒')
}

let nativeScheduleQueue = Promise.resolve()

function syncNativeSchedule(force = false): Promise<void> {
  if (!isNative) return Promise.resolve()
  nativeScheduleQueue = nativeScheduleQueue.then(() => reconcileNativeSchedule(force))
  return nativeScheduleQueue
}

async function reconcileNativeSchedule(force: boolean): Promise<void> {
  let exact: boolean | null = null
  let channelImportance: number | null = null
  try {
    const granted = await refreshNativePermission() === 'granted'
    const enabled = reminders.value.filter(reminder => reminder.enabled)
    const desiredIds = new Set(enabled.flatMap(reminder => reminder.times.map(time => nativeNotificationId(reminder.id, time))))
    const { notifications: pending } = await LocalNotifications.getAll({ state: 'SCHEDULED' })
    const existing = new Map(pending.filter(isSupplementNotification).map(item => [item.id, item]))
    const removed = [...existing.keys()].filter(id => !desiredIds.has(id))
    if (removed.length) await LocalNotifications.cancel({ notifications: removed.map(id => ({ id })) })

    if (!granted) {
      scheduleStatus.value = { count: 0, exact, channelImportance, error: null }
      return
    }

    exact = isAndroid ? (await LocalNotifications.checkExactNotificationSetting()).exact_alarm === 'granted' : null
    const channel = await ensureChannel()
    channelImportance = channel?.importance ?? null
    if (channelImportance === 0) throw new Error('请在通知设置中开启「补剂提醒」类别')
    const today = new Date()
    const desired: LocalNotificationSchema[] = enabled.flatMap(reminder => reminder.times.map(time => {
      const copy = buildSupplementNotification(reminder, time, today)
      return {
        id: nativeNotificationId(reminder.id, time),
        title: copy.title,
        body: copy.body,
        channelId: isAndroid ? SUPPLEMENT_CHANNEL : undefined,
        isExactNotification: exact === true,
        extra: { supplementScheduleVersion: SCHEDULE_VERSION, supplementReminderId: reminder.id },
        schedule: {
          on: { hour: Number(time.slice(0, 2)), minute: Number(time.slice(3, 5)), second: 0 },
          allowWhileIdle: true
        }
      } satisfies LocalNotificationSchema
    }))
    const changed = desired.filter(item => {
      const previous = existing.get(item.id)
      return force || !previous || previous.title !== item.title || previous.body !== item.body ||
        previous.isExactNotification !== item.isExactNotification || previous.extra?.supplementScheduleVersion !== SCHEDULE_VERSION
    })
    const result = changed.length ? await LocalNotifications.schedule({ notifications: changed }) : null
    const count = desired.length - changed.length + (result?.notifications.length ?? 0)
    scheduleStatus.value = {
      count,
      exact: result?.warning ? false : exact,
      channelImportance,
      error: count < desired.length ? '部分提醒未被系统接受，请重建系统提醒' : null
    }
  } catch (err) {
    scheduleStatus.value = {
      count: 0,
      exact,
      channelImportance,
      error: err instanceof Error ? err.message : String(err)
    }
  } finally {
    void refreshNotificationDiagnostics()
  }
}

async function enableExactSupplementReminders(): Promise<void> {
  await LocalNotifications.changeExactNotificationSetting()
  await syncNativeSchedule()
}

function openSupplementNotificationSettings(): Promise<void> {
  return SupplementNotificationSettings.open({ channel: permission.value === 'granted' })
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
      await LocalNotifications.requestPermissions()
      await refreshNativePermission()
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

async function scheduleSupplementTest(title: string, body: string, delayMs = 12_000): Promise<number> {
  if (await refreshNativePermission() !== 'granted') throw new Error('请先允许「两仪」发送通知。')
  const channel = await ensureChannel()
  const importance = channel?.importance ?? -1
  if (importance === 0) throw new Error('「补剂提醒」类别被关闭了，请在通知设置里打开。')
  const exact = isAndroid
    ? (await LocalNotifications.checkExactNotificationSetting()).exact_alarm === 'granted'
    : false
  const at = new Date(Date.now() + delayMs)
  const id = -nativeNotificationId('test', String(at.getTime()))
  // 这里刻意不传 isExactMandatory：没有「闹钟和提醒」权限时，
  // mandatory 会让整个预约被系统拒绝，连粗略提醒都拿不到。
  const result = await LocalNotifications.schedule({
    notifications: [{
      id,
      title,
      body,
      channelId: isAndroid ? SUPPLEMENT_CHANNEL : undefined,
      isExactNotification: exact,
      schedule: { at, allowWhileIdle: true }
    }]
  })
  void refreshNotificationDiagnostics()
  if (!result.notifications.some(notification => notification.id === id)) {
    throw new Error('系统未接受测试预约，请检查通知权限。')
  }
  // 把这次测试实际用的档位写回状态：exact=false 时页面立刻出现「开启准时提醒」，
  // 用户不用去翻每日提醒的预约结果才知道为什么后台没弹。
  scheduleStatus.value = { ...scheduleStatus.value, exact }
  return at.getTime()
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
      // 原生端系统通知由 syncNativeSchedule 预约的系统闹钟负责，页面只做页内提示，
      // 避免系统闹钟与页面定时器在同一分钟各发一条
      if (!isNative && (document.visibilityState !== 'visible' || !document.hasFocus())) {
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
  void syncNativeSchedule()
  if (isNative) {
    // 点系统通知跳到补剂页；同一进程只注册一次（schedulerRunning 守卫）
    void LocalNotifications.addListener('localNotificationActionPerformed', event => {
      // 点通知直接落在对应的那条补剂上，而不是让用户再翻一遍列表
      const extra = event.notification?.extra as { supplementReminderId?: string } | undefined
      const id = extra?.supplementReminderId
      const base = `${import.meta.env.BASE_URL}supplements`
      window.location.assign(id ? `${base}?focus=${encodeURIComponent(id)}` : base)
    }).catch(() => undefined)
  }
  schedulerTimer = window.setInterval(tick, 15_000)
  visibilityHandler = () => {
    if (document.visibilityState === 'visible') {
      tick()
      void syncNativeSchedule()
    }
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
    diagnostics,
    refreshNotificationDiagnostics,
    requestBatteryExemption,
    syncNativeSchedule,
    enableExactSupplementReminders,
    openSupplementNotificationSettings,
    addReminder,
    updateReminder,
    toggleReminder,
    removeReminder,
    requestSupplementPermission,
    scheduleSupplementTest,
    sendSupplementNotification,
    nextReminderLabel
  }
}

export { startSupplementScheduler, isNative as isNativeSupplements, isAndroid as isAndroidSupplements, ANDROID_HIGH_IMPORTANCE }
