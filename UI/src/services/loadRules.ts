// 负荷序列与强度分布：运动员模式首页的取数层。
//
// 三条口径写死在这里，UI 只负责显示，不在组件里各算一遍：
// 1) 没发生 ≠ 未记录：没有训练记录的一天记作"休息"，负荷为 0，参与平均；
//    有记录但缺 RPE 的一天记作"缺失"，从窗口里剔除，不按 0 补齐（沿用 weekRules 的判断）。
// 2) 应用开始使用之前的日子是"未知"，既不是 0 也不是缺失——否则新用户第一天就会被算成重度减量。
// 3) ACWR = 近 7 天平均负荷 / 近 28 天平均负荷，样本不足时返回 null，不给一个假数字。
import type { TrainingSession } from '@/types/domain'
import { toISODate } from '@/utils/time'
import { loadOf } from './weekRules'

export type LoadDayState = 'load' | 'rest' | 'missing' | 'unknown'

export interface LoadPoint {
  date: string
  state: LoadDayState
  /** 该日负荷合计（AU）；missing / unknown 为 null */
  load: number | null
}

export interface LoadSeries {
  points: LoadPoint[]
  /** 近 28 天平均负荷（AU/天） */
  ctl: number | null
  /** 近 7 天平均负荷（AU/天） */
  atl: number | null
  /** 急慢性负荷比；样本不足时为 null */
  acwr: number | null
  /** 参与计算的天数（load + rest） */
  coveredDays: number
  /** 还差几天才够算 ACWR；够用时为 0 */
  daysNeeded: number
  /** 窗口内的未知天数（早于首条记录） */
  unknownDays: number
  /** 窗口内因缺 RPE 被剔除的天数 */
  missingDays: number
  /** 近 7 天负荷合计（滚动，不是自然周） */
  acuteLoad: number | null
  /** 近 28 天负荷合计 */
  chronicLoad: number | null
}

export interface LoadOptions {
  /** 统计窗口天数，默认 28 */
  window?: number
  /** 急性窗口，默认 7 */
  acute?: number
  /** 算 ACWR 至少要覆盖多少天，默认 14 */
  minDays?: number
}

const DEFAULT_WINDOW = 28
const DEFAULT_ACUTE = 7
const DEFAULT_MIN_DAYS = 14

/** 把 yyyy-mm-dd 往前推 n 天（按本地日历，跨月/跨年交给 Date 处理） */
function shiftISO(iso: string, deltaDays: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const x = new Date(y, (m ?? 1) - 1, d ?? 1)
  x.setDate(x.getDate() + deltaDays)
  return toISODate(x)
}

const mean = (nums: number[]): number | null =>
  nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null
const r1 = (v: number | null): number | null => (v === null ? null : Math.round(v * 10) / 10)
const r2 = (v: number | null): number | null => (v === null ? null : Math.round(v * 100) / 100)

/**
 * 按天聚合负荷。窗口按参考日往前推（含参考日），返回升序。
 */
export function buildLoadSeries(
  sessions: TrainingSession[],
  reference: Date = new Date(),
  opts: LoadOptions = {}
): LoadSeries {
  const windowDays = opts.window ?? DEFAULT_WINDOW
  const acuteDays = opts.acute ?? DEFAULT_ACUTE
  const minDays = opts.minDays ?? DEFAULT_MIN_DAYS
  const today = toISODate(reference)

  const byDate = new Map<string, TrainingSession[]>()
  for (const s of sessions) {
    const list = byDate.get(s.date)
    if (list) list.push(s)
    else byDate.set(s.date, [s])
  }

  // 首条记录之前的日子是"未知"，不是 0
  const recordDates = [...byDate.keys()].sort()
  const firstRecord = recordDates[0] ?? null

  const points: LoadPoint[] = []
  for (let i = windowDays - 1; i >= 0; i--) {
    const date = shiftISO(today, -i)
    const ofDay = byDate.get(date)
    if (!ofDay) {
      // 没有记录：首条记录之后算"休息"，之前算"未知"
      const state: LoadDayState = firstRecord && date >= firstRecord ? 'rest' : 'unknown'
      points.push({ date, state, load: state === 'rest' ? 0 : null })
      continue
    }
    const loads = ofDay.map(loadOf)
    // 当天只要有一条缺 RPE 或时长，整天都算缺失，不按 0 补齐
    if (loads.some(l => l === null)) {
      points.push({ date, state: 'missing', load: null })
    } else {
      points.push({ date, state: 'load', load: loads.reduce<number>((sum, l) => sum + (l ?? 0), 0) })
    }
  }

  const known = points.filter(p => p.state === 'load' || p.state === 'rest')
  const acutePoints = points.slice(-acuteDays).filter(p => p.state === 'load' || p.state === 'rest')
  const loadedPoints = points.filter(p => p.state === 'load')

  // 均值先算原始值，比值用原始值算完再取整——先取整再相除会把 1.49 舍成 1.5，落错档
  const ctlRaw = mean(known.map(p => p.load ?? 0))
  const atlRaw = mean(acutePoints.map(p => p.load ?? 0))
  const coveredDays = known.length
  // 只有近 7 天也覆盖到足够天数时才算 ACWR，否则分子分母不是同一个样本
  const canCompute = ctlRaw !== null && ctlRaw > 0 && coveredDays >= minDays && acutePoints.length >= Math.min(acuteDays, minDays)

  return {
    points,
    ctl: r1(ctlRaw),
    atl: r1(atlRaw),
    acwr: canCompute ? r2(atlRaw! / ctlRaw!) : null,
    coveredDays,
    daysNeeded: Math.max(0, minDays - coveredDays),
    unknownDays: points.filter(p => p.state === 'unknown').length,
    missingDays: points.filter(p => p.state === 'missing').length,
    acuteLoad: acutePoints.length
      ? Math.round(acutePoints.reduce((sum, p) => sum + (p.load ?? 0), 0))
      : null,
    chronicLoad: loadedPoints.length
      ? Math.round(loadedPoints.reduce((sum, p) => sum + (p.load ?? 0), 0))
      : null
  }
}

/** ACWR 落在哪一档：诊断带沿用常见做法（<0.8 减量过多 / 0.8–1.3 安全 / >1.3 偏急） */
export type LoadZone = 'low' | 'optimal' | 'high' | 'veryHigh' | 'unknown'

export function loadZone(acwr: number | null): LoadZone {
  if (acwr === null || !Number.isFinite(acwr)) return 'unknown'
  if (acwr < 0.8) return 'low'
  if (acwr <= 1.3) return 'optimal'
  if (acwr <= 1.5) return 'high'
  return 'veryHigh'
}

export const LOAD_ZONE_TEXT: Record<LoadZone, string> = {
  low: '偏低 · 还有加量空间',
  optimal: '安全区间 · 按计划推进',
  high: '偏高 · 注意恢复',
  veryHigh: '明显过快 · 建议减量',
  unknown: '样本不足'
}

export interface IntensitySplit {
  /** 低强度时长（分钟） */
  lowMinutes: number
  /** 高强度时长（分钟） */
  highMinutes: number
  /** 未记 RPE 因而无法归类的时长 */
  unknownMinutes: number
  /** 低强度占"可归类时长"的比例 0..1；没有可归类时长时为 null */
  lowShare: number | null
  highShare: number | null
  /** 判定高强度所用的 RPE 下限 */
  threshold: number
}

/**
 * 强度分布：按 RPE 把训练时长分成低/高强度两段。
 * 用时长而不是次数——80/20 那套说的是时间占比，次数会把 15 分钟和 90 分钟算成一样。
 */
export function intensitySplit(
  sessions: TrainingSession[],
  opts: { threshold?: number; since?: string } = {}
): IntensitySplit {
  const threshold = opts.threshold ?? 7
  const rows = opts.since ? sessions.filter(s => s.date >= opts.since!) : sessions
  let low = 0
  let high = 0
  let unknown = 0
  for (const s of rows) {
    const minutes = s.actualDuration ?? 0
    if (!minutes) continue
    if (s.rpe === null) unknown += minutes
    else if (s.rpe >= threshold) high += minutes
    else low += minutes
  }
  const classified = low + high
  return {
    lowMinutes: low,
    highMinutes: high,
    unknownMinutes: unknown,
    lowShare: classified ? low / classified : null,
    highShare: classified ? high / classified : null,
    threshold
  }
}
