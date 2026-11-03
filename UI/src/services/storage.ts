import type {
  AdjustmentResolutions,
  Meal,
  Mode,
  Plan,
  PrivacySettings,
  SpeechSettings,
  ThemePreference,
  TrainingSession,
  UserProfile
} from '@/types/domain'

export interface StoredState {
  mode?: Mode
  profile?: UserProfile | null
  sessions?: TrainingSession[]
  meals?: Meal[]
  privacy?: PrivacySettings
  speech?: SpeechSettings
  collapsed?: string[]
  theme?: ThemePreference
  plans?: Plan[]
  planHistory?: Plan[]
  modeLog?: { from: Mode; to: Mode; at: string; openPlanCount: number }[]
  unitGrams?: Record<string, number>
  adjustmentResolutions?: AdjustmentResolutions
}

export interface SyncMeta {
  lastSyncAt: string
  userId: string
}

const LEGACY_KEY = 'twopoles_state'
const KEYS = {
  meta: 'twopoles.v1.meta',
  profile: 'twopoles.v1.profile',
  sessions: 'twopoles.v1.sessions',
  meals: 'twopoles.v1.meals',
  privacy: 'twopoles.v1.privacy',
  speech: 'twopoles.v1.speech',
  plans: 'twopoles.v1.plans',
  planHistory: 'twopoles.v1.planHistory',
  modeLog: 'twopoles.v1.modeLog',
  unitGrams: 'twopoles.v1.unitGrams',
  adjustmentResolutions: 'twopoles.v1.adjustmentResolutions',
  syncMeta: 'twopoles.v1.syncMeta',
  outbox: 'twopoles.v1.outbox',
  conflicts: 'twopoles.v1.conflicts'
} as const

export const STORAGE_KEYS = KEYS
export const SYNC_META_KEY = KEYS.syncMeta
export const OUTBOX_KEY = KEYS.outbox
export const CONFLICT_KEY = KEYS.conflicts

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function readJson<T>(key: string, fallback: T): T {
  const store = storage()
  if (!store) return fallback
  try {
    const raw = store.getItem(key)
    if (raw === null) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown): boolean {
  const store = storage()
  if (!store) return false
  try {
    store.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

function removeKey(key: string) {
  try {
    storage()?.removeItem(key)
  } catch {
    /* 存储不可用时没有可清理的内容 */
  }
}

/** 把旧版单 key 状态拆到分类 key；任一分类写入失败时保留旧 key 作为兜底 */
function migrateLegacy(): StoredState | null {
  const store = storage()
  if (!store) return null
  let raw: string | null = null
  try {
    raw = store.getItem(LEGACY_KEY)
  } catch {
    return null
  }
  if (!raw) return null
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return null
  }
  const state: StoredState = {
    mode: parsed.mode === 'athlete' ? 'athlete' : 'public',
    profile: (parsed.profile as UserProfile | null | undefined) ?? null,
    sessions: Array.isArray(parsed.sessions) ? parsed.sessions as TrainingSession[] : [],
    meals: Array.isArray(parsed.meals) ? parsed.meals as Meal[] : [],
    privacy: parsed.privacy as PrivacySettings | undefined,
    speech: parsed.speech as SpeechSettings | undefined,
    collapsed: Array.isArray(parsed.collapsed) ? parsed.collapsed as string[] : [],
    theme: (parsed.theme === 'light' || parsed.theme === 'dark' || parsed.theme === 'system') ? parsed.theme : 'system',
    plans: Array.isArray(parsed.plans) ? parsed.plans as Plan[] : [],
    planHistory: Array.isArray(parsed.planHistory) ? parsed.planHistory as Plan[] : [],
    modeLog: Array.isArray(parsed.modeLog) ? parsed.modeLog as StoredState['modeLog'] : [],
    unitGrams: (parsed.unitGrams && typeof parsed.unitGrams === 'object') ? parsed.unitGrams as Record<string, number> : {},
    adjustmentResolutions: (parsed.adjustmentResolutions && typeof parsed.adjustmentResolutions === 'object')
      ? parsed.adjustmentResolutions as AdjustmentResolutions
      : {}
  }
  const failed = saveStoredState(state, { removeLegacy: false })
  if (failed.length) return state
  removeKey(LEGACY_KEY)
  return state
}

export function loadStoredState(): StoredState {
  const store = storage()
  if (!store) return {}
  // 旧 key 只在全部分类写入成功后移除；存在它就说明迁移尚未完成。
  // 不能用“已有任意分类 key”判断完成，否则配额失败后的重启会漏读旧记录。
  const migrated = migrateLegacy()
  if (migrated) return migrated
  const meta = readJson<Record<string, unknown>>(KEYS.meta, {})
  return {
    mode: meta.mode === 'athlete' ? 'athlete' : 'public',
    collapsed: Array.isArray(meta.collapsed) ? meta.collapsed as string[] : [],
    theme: (meta.theme === 'light' || meta.theme === 'dark' || meta.theme === 'system') ? meta.theme : 'system',
    profile: readJson<UserProfile | null>(KEYS.profile, null),
    sessions: readJson<TrainingSession[]>(KEYS.sessions, []),
    meals: readJson<Meal[]>(KEYS.meals, []),
    privacy: readJson<PrivacySettings | null>(KEYS.privacy, null) ?? undefined,
    speech: readJson<SpeechSettings | null>(KEYS.speech, null) ?? undefined,
    plans: readJson<Plan[]>(KEYS.plans, []),
    planHistory: readJson<Plan[]>(KEYS.planHistory, []),
    modeLog: readJson<StoredState['modeLog']>(KEYS.modeLog, []),
    unitGrams: readJson<Record<string, number>>(KEYS.unitGrams, {}),
    adjustmentResolutions: readJson<AdjustmentResolutions>(KEYS.adjustmentResolutions, {})
  }
}

export function saveStoredState(state: StoredState, options: { removeLegacy?: boolean } = {}): string[] {
  const failed: string[] = []
  const meta = {
    mode: state.mode ?? 'public',
    collapsed: state.collapsed ?? [],
    theme: state.theme ?? 'system'
  }
  const writes: [string, unknown][] = [
    [KEYS.meta, meta],
    [KEYS.profile, state.profile ?? null],
    [KEYS.sessions, state.sessions ?? []],
    [KEYS.meals, state.meals ?? []],
    [KEYS.privacy, state.privacy ?? null],
    [KEYS.speech, state.speech ?? { enabled: false, voiceURI: '' }],
    [KEYS.plans, state.plans ?? []],
    [KEYS.planHistory, state.planHistory ?? []],
    [KEYS.modeLog, state.modeLog ?? []],
    [KEYS.unitGrams, state.unitGrams ?? {}],
    [KEYS.adjustmentResolutions, state.adjustmentResolutions ?? {}]
  ]
  for (const [key, value] of writes) {
    if (!writeJson(key, value)) failed.push(key)
  }
  if (!failed.length && options.removeLegacy !== false) removeKey(LEGACY_KEY)
  return failed
}

export function clearStoredState() {
  for (const key of Object.values(KEYS)) removeKey(key)
  removeKey(LEGACY_KEY)
}

export function readSyncMeta(): SyncMeta | null {
  const value = readJson<SyncMeta | null>(KEYS.syncMeta, null)
  if (!value || typeof value.lastSyncAt !== 'string' || typeof value.userId !== 'string') return null
  return value
}

export function writeSyncMeta(meta: SyncMeta): boolean {
  return writeJson(KEYS.syncMeta, meta)
}

export function clearSyncMeta() {
  removeKey(KEYS.syncMeta)
}

export function readOutbox<T>(): T[] {
  return readJson<T[]>(KEYS.outbox, [])
}

export function writeOutbox<T>(items: T[]): boolean {
  return writeJson(KEYS.outbox, items)
}

export function clearOutbox() {
  removeKey(KEYS.outbox)
}

export function readSyncConflicts<T>(): T[] {
  return readJson<T[]>(KEYS.conflicts, [])
}

export function writeSyncConflicts<T>(items: T[]): boolean {
  return writeJson(KEYS.conflicts, items)
}

export function storedStateSizeKb(): number {
  const store = storage()
  if (!store) return 0
  let total = 0
  for (const key of [LEGACY_KEY, ...Object.values(KEYS)]) {
    try {
      total += (store.getItem(key)?.length ?? 0) * 2
    } catch {
      /* 忽略不可读的 key */
    }
  }
  return Math.max(1, Math.round(total / 1024))
}
