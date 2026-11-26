// 分析区间规划：先全片粗扫，再决定"这段视频值得精扫哪些时间"。
// 替代 V1 的"用前 10 秒给整片下结论"。
//
// 关键安全阀：活跃区间只是"候选"，不是"结论"。
// 覆盖率不足（缓慢示范、长静止、检测漏能）时回退全片，
// 宁可多算几秒，也不能因为区间切早了把一次完整动作切掉。

import type { MotionFrame } from '@/services/motionAnalysis'
import type { AnalyzedRange } from '@/services/motion-engine/core/types'
import { detectActiveWindows, unionRange } from '@/services/motion-engine/temporal/activeWindow'
import type { MotionEnergyFrame } from '@/services/motion-engine/temporal/activeWindow'

export const ACTIVE_WINDOW_RULES = {
  /** 活跃窗口总时长占全片低于该比例时，回退全片分析 */
  minCoverage: 0.35,
  /** 精确采样时区间两侧留白（毫秒）；动作结束后的站定往往低能量，留白要够 */
  padMs: 1000,
  /**
   * 活跃区间之外的"安静段"如果仍存在明显姿势变化，说明不是走位/准备，
   * 而是慢速动作（缓慢下放、静态保持的调整），必须并入分析区间。
   * 阈值取姿态角/髋高的极差，避免把真正的静止当成动作。
   */
  quietGapMinMs: 1000,
  quietGapKneeRangeDeg: 15,
  quietGapHipRangeDeg: 12,
  quietGapHipHeightRange: 0.18,
  quietGapTrunkRangeDeg: 10
} as const

/** 一个安静段里是否仍有明显姿势变化（有就说明不能裁掉） */
function quietGapHasMovement(frames: MotionFrame[], startMs: number, endMs: number): boolean {
  const rows = frames.filter(frame => frame.timeMs >= startMs && frame.timeMs <= endMs && frame.visibility >= 0.5)
  if (rows.length < 3) return false
  const range = (read: (frame: MotionFrame) => number | null): number => {
    const values = rows.map(read).filter((value): value is number => value !== null && Number.isFinite(value))
    return values.length >= 3 ? Math.max(...values) - Math.min(...values) : 0
  }
  const knee = (frame: MotionFrame) => {
    const { hip, knee: kneePoint, ankle } = frame.points
    const side = (kneePoint.left && kneePoint.right)
      ? (kneePoint.left.visibility >= kneePoint.right.visibility ? 'left' : 'right') as 'left' | 'right'
      : 'left'
    const a = hip[side]
    const v = kneePoint[side]
    const b = ankle[side]
    if (!a || !v || !b) return null
    const ux = a.x - v.x
    const uy = a.y - v.y
    const wx = b.x - v.x
    const wy = b.y - v.y
    const magnitude = Math.hypot(ux, uy) * Math.hypot(wx, wy)
    if (!magnitude) return null
    return Math.acos(Math.max(-1, Math.min(1, (ux * wx + uy * wy) / magnitude))) * 180 / Math.PI
  }
  const hip = (frame: MotionFrame) => {
    const side = (frame.points.knee.left && frame.points.knee.right)
      ? (frame.points.knee.left.visibility >= frame.points.knee.right.visibility ? 'left' : 'right') as 'left' | 'right'
      : 'left'
    const shoulder = frame.points.shoulder[side]
    const hipPoint = frame.points.hip[side]
    const kneePoint = frame.points.knee[side]
    if (!shoulder || !hipPoint || !kneePoint) return null
    const ux = shoulder.x - hipPoint.x
    const uy = shoulder.y - hipPoint.y
    const wx = kneePoint.x - hipPoint.x
    const wy = kneePoint.y - hipPoint.y
    const magnitude = Math.hypot(ux, uy) * Math.hypot(wx, wy)
    if (!magnitude) return null
    return Math.acos(Math.max(-1, Math.min(1, (ux * wx + uy * wy) / magnitude))) * 180 / Math.PI
  }
  const hipHeight = (frame: MotionFrame) => {
    const hipMid = frame.points.hip.left && frame.points.hip.right
      ? (frame.points.hip.left.y + frame.points.hip.right.y) / 2 : null
    const ankleMid = frame.points.ankle.left && frame.points.ankle.right
      ? (frame.points.ankle.left.y + frame.points.ankle.right.y) / 2 : null
    const shoulderMid = frame.points.shoulder.left && frame.points.shoulder.right
      ? (frame.points.shoulder.left.y + frame.points.shoulder.right.y) / 2 : null
    if (hipMid === null || ankleMid === null || shoulderMid === null) return null
    const torso = Math.abs(hipMid - shoulderMid)
    return torso > 0.02 ? (ankleMid - hipMid) / torso : null
  }
  const trunk = (frame: MotionFrame) => {
    const side = (frame.points.knee.left && frame.points.knee.right)
      ? (frame.points.knee.left.visibility >= frame.points.knee.right.visibility ? 'left' : 'right') as 'left' | 'right'
      : 'left'
    const shoulder = frame.points.shoulder[side]
    const hipPoint = frame.points.hip[side]
    if (!shoulder || !hipPoint) return null
    return Math.atan2(Math.abs(shoulder.x - hipPoint.x), Math.max(0, hipPoint.y - shoulder.y)) * 180 / Math.PI
  }
  return range(knee) >= ACTIVE_WINDOW_RULES.quietGapKneeRangeDeg
    || range(hip) >= ACTIVE_WINDOW_RULES.quietGapHipRangeDeg
    || range(hipHeight) >= ACTIVE_WINDOW_RULES.quietGapHipHeightRange
    || range(trunk) >= ACTIVE_WINDOW_RULES.quietGapTrunkRangeDeg
}

export interface AnalysisWindowPlan {
  /** 精扫范围（要么是活跃区间并集，要么回退全片） */
  range: AnalyzedRange
  /** 检测到的活跃窗口（用于展示"分析区间"与调试） */
  windows: AnalyzedRange[]
  /** 活跃窗口总时长 / 全片时长 */
  coverage: number
  /** 回退原因；null 表示按活跃区间精扫 */
  fallback: null | 'no-active-window' | 'low-coverage'
  /** 逐帧能量，供步态窗口选择复用，避免重算 */
  energy: MotionEnergyFrame[]
  threshold: number | null
}

/**
 * 从粗扫帧规划分析区间。
 * @param frames 粗扫帧（建议 5fps，全片覆盖）
 * @param fps 粗扫实际帧率
 * @param durationMs 视频总时长
 */
export function planAnalysisWindow(
  frames: MotionFrame[],
  fps: number,
  durationMs: number,
  options: { minCoverage?: number } = {}
): AnalysisWindowPlan {
  const duration = Math.max(0, durationMs || (frames.length ? frames[frames.length - 1].timeMs : 0))
  const active = detectActiveWindows(frames, fps)
  const whole: AnalyzedRange = { startMs: 0, endMs: duration, source: 'whole-clip' }
  if (!active.found) {
    return { range: whole, windows: [], coverage: 0, fallback: 'no-active-window', energy: active.energy, threshold: active.threshold }
  }
  const coverage = duration > 0
    ? active.windows.reduce((sum, window) => sum + (window.endMs - window.startMs), 0) / duration
    : 0
  const minCoverage = options.minCoverage ?? ACTIVE_WINDOW_RULES.minCoverage
  if (coverage < minCoverage) {
    return { range: whole, windows: active.windows, coverage, fallback: 'low-coverage', energy: active.energy, threshold: active.threshold }
  }
  const union = unionRange(active.windows, duration)
  if (!union) {
    return { range: whole, windows: active.windows, coverage, fallback: 'no-active-window', energy: active.energy, threshold: active.threshold }
  }
  // 活跃区间两侧的"安静段"如果仍有明显姿势变化，说明是慢速动作而不是走位/准备，必须并入
  const pad = ACTIVE_WINDOW_RULES.padMs
  let startMs = Math.max(0, union.startMs - pad)
  let endMs = Math.min(duration, union.endMs + pad)
  const prefixGapEnd = Math.max(0, union.startMs - pad)
  if (prefixGapEnd >= ACTIVE_WINDOW_RULES.quietGapMinMs && quietGapHasMovement(frames, 0, prefixGapEnd)) {
    startMs = 0
  }
  const suffixGapStart = Math.min(duration, union.endMs + pad)
  if (duration - suffixGapStart >= ACTIVE_WINDOW_RULES.quietGapMinMs && quietGapHasMovement(frames, suffixGapStart, duration)) {
    endMs = duration
  }
  return {
    range: { startMs, endMs, source: 'active-window' },
    windows: active.windows,
    coverage,
    fallback: null,
    energy: active.energy,
    threshold: active.threshold
  }
}

/** 精扫时间点：按帧率生成规则网格，并合并粗扫时间点（让粗扫帧直接命中缓存） */
export function fineGridTimes(startMs: number, endMs: number, fps: number, include: number[] = []): number[] {
  const step = 1000 / Math.max(1, fps)
  const times = new Set<number>()
  const start = Math.max(0, startMs)
  const end = Math.max(start, endMs)
  // 网格对齐到 (k + 0.5) 个帧间隔，避免 t=0 这个多半还没解码完成的时间点
  let k = Math.max(0, Math.ceil(start / step - 0.5))
  for (; ; k++) {
    const time = (k + 0.5) * step
    if (time > end + 1e-6) break
    if (time >= start - 1e-6) times.add(Math.round(time))
  }
  for (const time of include) {
    if (time >= start - 1e-6 && time <= end + 1e-6) times.add(Math.round(time))
  }
  return [...times].sort((a, b) => a - b)
}

/** 粗扫时间点：全片 5fps；与 15fps 精扫网格对齐（每第 3 个精扫点） */
export function coarseGridTimes(durationMs: number, fps = 5): number[] {
  return fineGridTimes(0, durationMs, fps)
}