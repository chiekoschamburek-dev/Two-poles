// 应用内更新：网页随服务器自动生效，但原生壳（通知、权限、安装包）必须换包。
// 这里负责让 App 自己发现「线上有新包」，用户不必靠外部提醒。
import { Capacitor, registerPlugin } from '@capacitor/core'

const isNative = Capacitor.isNativePlatform()

const NativeApp = registerPlugin<{
  appVersion(): Promise<{ versionCode: number; versionName: string }>
  installApk(options: { url: string; fileName?: string }): Promise<void>
}>('SupplementNotificationSettings')

/** 线上安装包清单，由 scripts/write-apk-version.mjs 随构建生成 */
export interface ApkManifest {
  versionCode: number
  versionName: string
  size: number
  sha256: string
  url: string
}

export interface InstalledVersion {
  versionCode: number
  versionName: string
}

export interface UpdateStatus {
  installed: InstalledVersion
  latest: ApkManifest
  /** 线上 versionCode 大于已安装版本 */
  hasUpdate: boolean
}

export const UPDATE_DISMISS_KEY = 'twopoles.v1.updateDismissed'

function manifestUrl(): string {
  return `${import.meta.env.BASE_URL}apk/version.json?t=${Date.now()}`
}

export async function readInstalledVersion(): Promise<InstalledVersion | null> {
  if (!isNative) return null
  try {
    const state = await NativeApp.appVersion()
    return { versionCode: Number(state.versionCode), versionName: String(state.versionName) }
  } catch {
    return null
  }
}

export async function fetchLatestApk(): Promise<ApkManifest | null> {
  try {
    const response = await fetch(manifestUrl(), { cache: 'no-store' })
    if (!response.ok) return null
    const raw = await response.json() as Partial<ApkManifest>
    const versionCode = Number(raw.versionCode)
    if (!Number.isFinite(versionCode) || versionCode <= 0) return null
    return {
      versionCode,
      versionName: typeof raw.versionName === 'string' ? raw.versionName : '',
      size: Number(raw.size) || 0,
      sha256: typeof raw.sha256 === 'string' ? raw.sha256 : '',
      url: typeof raw.url === 'string' && raw.url ? raw.url : `${import.meta.env.BASE_URL}apk/twopoles-debug.apk`
    }
  } catch {
    return null
  }
}

/** 是否已经对某个版本点过「稍后」；同一版本不再自动弹提示 */
export function isUpdateDismissed(versionCode: number): boolean {
  try {
    return localStorage.getItem(UPDATE_DISMISS_KEY) === String(versionCode)
  } catch {
    return false
  }
}

export function dismissUpdate(versionCode: number): void {
  try {
    localStorage.setItem(UPDATE_DISMISS_KEY, String(versionCode))
  } catch {
    // 隐私模式下写不进去，只是下次启动会再提示一次
  }
}

export const UPDATE_NOTICE_KEY = 'twopoles.v1.updateNotified'

function todayKey(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/**
 * 是否该为这个版本弹一次「发现新版本」。
 * 同一版本每天最多提醒一次：错过一次 Toast 不会让这个版本从此再也不提示；
 * 用户明确点过「稍后」（dismissUpdate）才永久静默。
 */
export function shouldNotifyUpdate(versionCode: number): boolean {
  if (isUpdateDismissed(versionCode)) return false
  try {
    const raw = localStorage.getItem(UPDATE_NOTICE_KEY)
    if (!raw) return true
    const last = JSON.parse(raw) as { versionCode?: number; day?: string }
    if (last.versionCode !== versionCode) return true
    return last.day !== todayKey()
  } catch {
    return true
  }
}

export function markUpdateNotified(versionCode: number): void {
  try {
    localStorage.setItem(UPDATE_NOTICE_KEY, JSON.stringify({ versionCode, day: todayKey() }))
  } catch {
    // 同上：写不进去只是下次启动再提示一次
  }
}

export async function checkAppUpdate(): Promise<UpdateStatus | null> {
  if (!isNative) return null
  const [installed, latest] = await Promise.all([readInstalledVersion(), fetchLatestApk()])
  if (!installed || !latest) return null
  return {
    installed,
    latest,
    hasUpdate: latest.versionCode > installed.versionCode
  }
}

export async function downloadAndInstall(latest: ApkManifest): Promise<void> {
  const absolute = new URL(latest.url, window.location.origin).href
  await NativeApp.installApk({ url: absolute, fileName: `twopoles-${latest.versionName || latest.versionCode}.apk` })
}

export function formatSize(bytes: number): string {
  if (!bytes) return '—'
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export { isNative as isNativeApp }