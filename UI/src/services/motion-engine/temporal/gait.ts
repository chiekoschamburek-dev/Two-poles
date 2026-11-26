// 步态事件估计：步态周期的"周期计数"与"触地事件"分开算。
//
// 早期实现用原始踝 y 的局部极小当触地、再用 floor(触地数/2) 当周期数；在真实素材上
// 人体远离/靠近镜头会让两踝 y 同步整体漂移，触地数被系统性低估（同一条视频从 20 次
// 触地变成 11 次），步频跟着失真。V2 改为：
// 1) 用「踝相对髋的归一化抬升」消除人物远近/尺度变化；
// 2) 步幅周期用左右腿差值的自相关估计（r 足够强时优先），触地事件只用于接触时间等指标；
// 3) 两者都不够可信时明确返回 null/0，由上层降级，而不是硬凑一个数。

import type { MotionFrame } from '@/services/motionAnalysis'
import { buildMotionFeatureSeries } from '@/services/motion-engine/features/series'
import { findPeaks } from '@/services/motion-engine/temporal/peaks'
import { pearson } from '@/services/motion-engine/temporal/correlation'

export interface GaitStrike {
  timeMs: number
  side: 'left' | 'right'
}

export interface GaitEventEstimate {
  strikes: GaitStrike[]
  /** 完整步态周期数（左右各触地一次算一个周期） */
  cycles: number
  cadence: number | null
  periodSec: number | null
  /** periodicity = 自相关；strikes = 触地数折半；none = 证据不足 */
  method: 'periodicity' | 'strikes' | 'none'
  /** 周期估计的自相关强度，便于上层判断可信度 */
  periodicityR: number | null
}

export const GAIT_EVENT_THRESHOLDS = {
  /** 自相关峰低于该值视为周期证据不足 */
  minPeriodicityR: 0.3,
  /** 步幅周期搜索范围（秒）：0.5–1.6 对应步频 75–240 步/分 */
  minPeriodSec: 0.5,
  maxPeriodSec: 1.6,
  /** 触地检测：归一化抬升的最小显著度（躯干长） */
  strikeMinProminence: 0.06,
  strikeMinDistanceMs: 250
} as const

const finite = (value: number | null | undefined): value is number => typeof value === 'number' && Number.isFinite(value)

/** 归一化踝抬升：(髋高 − 踝高)/躯干长。抬升越小越接近触地。 */
function ankleLiftSeries(frames: MotionFrame[], fps: number): { left: (number | null)[]; right: (number | null)[]; durationSec: number } {
  const features = buildMotionFeatureSeries(frames, fps)
  const lift = (side: 'left' | 'right') => features.frames.map(frame => {
    const ankle = side === 'left' ? frame.ankleYLeft : frame.ankleYRight
    if (!finite(ankle) || !finite(frame.hipMidY) || !finite(frame.torsoLength) || frame.torsoLength < 0.02) return null
    return (frame.hipMidY - ankle) / frame.torsoLength
  })
  return {
    left: lift('left'),
    right: lift('right'),
    durationSec: features.durationSec
  }
}

function detectStrikes(lift: (number | null)[], times: number[], side: 'left' | 'right'): GaitStrike[] {
  const valid = lift.filter((value): value is number => value !== null)
  if (valid.length < 8) return []
  const range = Math.max(...valid) - Math.min(...valid)
  if (range < 0.02) return []
  const minima = findPeaks(lift, times, {
    direction: 'min',
    minProminence: Math.max(GAIT_EVENT_THRESHOLDS.strikeMinProminence, range * 0.2),
    minDistanceMs: GAIT_EVENT_THRESHOLDS.strikeMinDistanceMs
  })
  return minima.map(peak => ({ timeMs: peak.timeMs, side }))
}

/** 自相关估计步幅周期；返回 null 表示证据不足 */
function stridePeriod(liftLeft: (number | null)[], liftRight: (number | null)[], fps: number): { periodSec: number; r: number } | null {
  const diff = liftLeft.map((value, index) => {
    const right = liftRight[index]
    return value === null || right === null ? null : value - right
  })
  const valid = diff.filter((value): value is number => value !== null)
  if (valid.length < fps * 2) return null
  const mean = valid.reduce((sum, value) => sum + value, 0) / valid.length
  const centered = diff.map(value => value === null ? null : value - mean)
  const minLag = Math.max(2, Math.round(GAIT_EVENT_THRESHOLDS.minPeriodSec * fps))
  const maxLag = Math.max(minLag + 2, Math.round(GAIT_EVENT_THRESHOLDS.maxPeriodSec * fps))
  let best: { lag: number; r: number } | null = null
  const curve: { lag: number; r: number }[] = []
  for (let lag = minLag; lag <= maxLag; lag++) {
    const r = pearson(centered.slice(lag), centered.slice(0, centered.length - lag))
    if (r !== null) curve.push({ lag, r })
  }
  if (!curve.length) return null
  const maxR = Math.max(...curve.map(point => point.r))
  const threshold = Math.max(GAIT_EVENT_THRESHOLDS.minPeriodicityR, maxR * 0.6)
  // 取"最早出现的强局部峰"：倍频/三倍频往往比基频更相关，但物理周期是基频
  for (let index = 1; index < curve.length - 1; index++) {
    const current = curve[index]
    if (current.r < threshold) continue
    if (current.r >= curve[index - 1].r && current.r >= curve[index + 1].r) {
      best = { lag: current.lag, r: current.r }
      break
    }
  }
  if (!best) return null
  return { periodSec: best.lag / fps, r: best.r }
}

/**
 * 估计步态事件与周期数。
 * 周期数优先取自相关周期（左右腿差信号一次完整交替 = 一个 stride），
 * 触地事件数量只作为回退与接触时间指标的输入。
 */
export function estimateGaitEvents(frames: MotionFrame[], fps: number): GaitEventEstimate {
  if (frames.length < 10) {
    return { strikes: [], cycles: 0, cadence: null, periodSec: null, method: 'none', periodicityR: null }
  }
  const times = frames.map(frame => frame.timeMs)
  const { left, right, durationSec } = ankleLiftSeries(frames, fps)
  const strikes = [
    ...detectStrikes(left, times, 'left'),
    ...detectStrikes(right, times, 'right')
  ].sort((a, b) => a.timeMs - b.timeMs)

  const period = stridePeriod(left, right, fps)
  if (period && durationSec > 0) {
    const cycles = Math.max(0, Math.floor(durationSec / period.periodSec))
    if (cycles >= 1) {
      return {
        strikes,
        cycles,
        cadence: Math.round((cycles * 2) / (durationSec / 60)),
        periodSec: Math.round(period.periodSec * 1000) / 1000,
        method: 'periodicity',
        periodicityR: Math.round(period.r * 1000) / 1000
      }
    }
  }
  const cycles = Math.floor(strikes.length / 2)
  return {
    strikes,
    cycles,
    cadence: durationSec > 0 && strikes.length ? Math.round((strikes.length * 2) / (durationSec / 60)) : null,
    periodSec: null,
    method: strikes.length ? 'strikes' : 'none',
    periodicityR: period ? Math.round(period.r * 1000) / 1000 : null
  }
}