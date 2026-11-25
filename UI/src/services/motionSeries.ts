// 动作序列只存本机 IndexedDB，不同步、不进导出。
// 逐字沿用 analysisKeyframes.ts 的惯例：无 indexedDB 时每个函数早返回/返回 null，绝不抛。
// 视频与摄像头画面始终不落盘；这里存的是派生几何数据（角度、关键点坐标），仍需用户显式同意。
import type { RepAnalysis, MotionFrame } from '@/services/motionAnalysis'
import type { MotionEvent } from '@/services/motionEvents'
import type { AnalysisAction, AnalysisView, MotionKinematics } from '@/types/domain'

const DB_NAME = 'twopoles_motion_series'
const STORE_NAME = 'series'
const DB_VERSION = 1

/** 保留最近 30 条或 90 天，保存时剪枝 */
export const SERIES_RETENTION_COUNT = 30
export const SERIES_RETENTION_DAYS = 90

export interface AngleSample {
  timeMs: number
  visibility: number
  kneeAngle: number | null
  hipAngle: number | null
  trunkAngle: number | null
  /** 上肢动作的肘角；下肢动作通常为 null */
  elbowAngle?: number | null
  /** 逐关节可见度；离线分析目前只给帧级可见度，缺失时不编造 0 */
  kneeVisibility?: number
  hipVisibility?: number
}

export interface MotionSeriesRecord {
  key: string
  savedAt: string
  fps: number
  action: AnalysisAction
  view: AnalysisView
  ruleVersion: string
  usableRatio: number
  calibratedNeutral?: number | null
  angles: AngleSample[]
  /** 仅 12 关节并集，坐标保留 4 位小数；便于日后修几何 bug 后无需视频重算 */
  landmarks: { timeMs: number; points: { x: number; y: number; v: number }[] }[]
  /** 运动学派生序列；旧记录没有该字段，详情页按无曲线处理 */
  kinematics?: MotionKinematics
  reps: RepAnalysis[]
  events: MotionEvent[]
}

function hasIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined'
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('无法打开本机动作数据库'))
  })
}

function run<T>(db: IDBDatabase, mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode)
    const request = fn(tx.objectStore(STORE_NAME))
    let value: T
    request.onsuccess = () => { value = request.result }
    request.onerror = () => reject(request.error)
    tx.oncomplete = () => resolve(value)
    tx.onabort = () => reject(tx.error)
  })
}

function isRecord(value: unknown): value is MotionSeriesRecord {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return typeof row.key === 'string' && Array.isArray(row.angles) && Array.isArray(row.landmarks)
}

const round4 = (value: number) => Math.round(value * 1e4) / 1e4

/** 从 MotionFrame 序列构造存储记录；只取 12 关节并集，不存全部 33 点 */
export function buildSeriesRecord(input: {
  key: string
  savedAt: string
  fps: number
  action: AnalysisAction
  view: AnalysisView
  ruleVersion: string
  usableRatio: number
  calibratedNeutral?: number | null
  frames: MotionFrame[]
  angles: AngleSample[]
  reps: RepAnalysis[]
  events: MotionEvent[]
  kinematics?: MotionKinematics
}): MotionSeriesRecord {
  const order = [
    ['shoulder', 'left'], ['shoulder', 'right'],
    ['elbow', 'left'], ['elbow', 'right'],
    ['wrist', 'left'], ['wrist', 'right'],
    ['hip', 'left'], ['hip', 'right'],
    ['knee', 'left'], ['knee', 'right'],
    ['ankle', 'left'], ['ankle', 'right'],
    ['heel', 'left'], ['heel', 'right'],
    ['toe', 'left'], ['toe', 'right']
  ] as const
  return {
    key: input.key,
    savedAt: input.savedAt,
    fps: input.fps,
    action: input.action,
    view: input.view,
    ruleVersion: input.ruleVersion,
    usableRatio: round4(input.usableRatio),
    calibratedNeutral: input.calibratedNeutral ?? null,
    angles: input.angles,
    landmarks: input.frames.map(frame => ({
      timeMs: frame.timeMs,
      points: order.map(([joint, side]) => {
        const group = frame.points[joint]
        const point = group ? group[side] : null
        return point
          ? { x: round4(point.x), y: round4(point.y), v: round4(point.visibility) }
          : { x: 0, y: 0, v: 0 }
      })
    })),
    reps: input.reps,
    events: input.events,
    ...(input.kinematics ? { kinematics: input.kinematics } : {})
  }
}

export async function saveMotionSeries(record: MotionSeriesRecord): Promise<boolean> {
  if (!hasIndexedDb()) return false
  const db = await openDb()
  try {
    await run(db, 'readwrite', store => store.put(record, record.key))
    await pruneMotionSeries(db)
    return true
  } finally {
    db.close()
  }
}

export async function getMotionSeries(key: string): Promise<MotionSeriesRecord | null> {
  if (!hasIndexedDb()) return null
  const db = await openDb()
  try {
    const value = await run(db, 'readonly', store => store.get(key))
    return isRecord(value) ? value : null
  } finally {
    db.close()
  }
}

export async function listMotionSeriesKeys(): Promise<string[]> {
  if (!hasIndexedDb()) return []
  const db = await openDb()
  try {
    const keys = await run(db, 'readonly', store => store.getAllKeys())
    return keys.filter((key): key is string => typeof key === 'string')
  } finally {
    db.close()
  }
}

/** 剪枝在同一个连接里做，避免每次操作都重开库 */
async function pruneMotionSeries(db: IDBDatabase): Promise<void> {
  const records = await run(db, 'readonly', store => store.getAll())
  const rows = records.filter(isRecord)
  if (rows.length <= SERIES_RETENTION_COUNT) {
    const cutoff = Date.now() - SERIES_RETENTION_DAYS * 86400_000
    const stale = rows.filter(row => Date.parse(row.savedAt) < cutoff).map(row => row.key)
    if (stale.length) await run(db, 'readwrite', store => {
      for (const key of stale) store.delete(key)
      return store.count()
    })
    return
  }
  const sorted = [...rows].sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt))
  const drop = new Set(sorted.slice(SERIES_RETENTION_COUNT).map(row => row.key))
  const cutoff = Date.now() - SERIES_RETENTION_DAYS * 86400_000
  for (const row of sorted) if (Date.parse(row.savedAt) < cutoff) drop.add(row.key)
  await run(db, 'readwrite', store => {
    for (const key of drop) store.delete(key)
    return store.count()
  })
}

export async function deleteMotionSeries(keys: string[]): Promise<void> {
  if (!hasIndexedDb() || !keys.length) return
  const db = await openDb()
  try {
    await run(db, 'readwrite', store => {
      for (const key of keys) store.delete(key)
      return store.count()
    })
  } finally {
    db.close()
  }
}

export async function clearMotionSeries(): Promise<void> {
  if (!hasIndexedDb()) return
  const db = await openDb()
  try {
    await run(db, 'readwrite', store => store.clear())
  } finally {
    db.close()
  }
}