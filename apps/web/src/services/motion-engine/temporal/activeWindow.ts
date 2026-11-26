// 活跃区间检测：替代"用视频前 10 秒给整段下结论"。
// 先用低帧率粗扫全片，找出人真正在做动作的时间段（去掉走近、摆设备、站着说话），
// 后续精扫/分类/计数只在有效区间内进行。
//
// 能量口径刻意与"人体整体位移"解耦：只看关节角变化和肢体相对躯干的运动，
// 这样人在画面里走路/镜头轻微晃动不会把静息段误判成训练段；
// 但静态保持（平板）本身能量低，检测不到窗口时由调用方回退到全片，不能因此判"没动作"。

import type { MotionFrame } from '@/services/motionAnalysis'
import type { AnalyzedRange } from '@/services/motion-engine/core/types'

export interface MotionEnergyFrame {
  timeMs: number
  /** 归一化运动能量：每秒的角度变化 + 相对躯干的肢体位移，已按躯干长缩放 */
  energy: number
  visibility: number
}

export interface ActiveWindowOptions {
  /** 平滑窗口（帧数），取奇数；默认按 0.3 秒折算 */
  smoothFrames?: number
  /** 绝对下限：低于它的能量一律视为噪声（防止静止视频把 0.1° 抖动当动作） */
  minEnergy?: number
  /** 两段活跃之间的间隔小于该值就合并 */
  mergeGapMs?: number
  /** 太短的活跃段不要（多半是瞬间抖动/遮罩） */
  minWindowMs?: number
  /** 区间两侧留白：动作起止往往略早/晚于能量阈值 */
  padMs?: number
}

export interface ActiveWindowResult {
  /** 合并后的活跃区间；空数组表示"全片都低能量" */
  windows: AnalyzedRange[]
  /** 逐帧能量（与输入 frames 等长） */
  energy: MotionEnergyFrame[]
  /** 判定用的能量阈值；null 表示样本不足 */
  threshold: number | null
  /** 是否检测到可用的活跃区间 */
  found: boolean
}

function percentile(values: number[], p: number): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]
}

/** 取关节角变化率（度/秒）：比原始角度更能反映"正在动" */
function angleRate(previous: MotionFrame, current: MotionFrame, joint: 'knee' | 'hip' | 'elbow'): number | null {
  const read = (frame: MotionFrame): number | null => {
    const points = joint === 'knee'
      ? [frame.points.hip.left, frame.points.knee.left, frame.points.ankle.left]
      : joint === 'hip'
        ? [frame.points.shoulder.left, frame.points.hip.left, frame.points.knee.left]
        : [frame.points.shoulder.left, frame.points.elbow?.left ?? null, frame.points.wrist?.left ?? null]
    if (points.some(point => !point)) return null
    const [a, b, c] = points as { x: number; y: number }[]
    const ux = a.x - b.x
    const uy = a.y - b.y
    const vx = c.x - b.x
    const vy = c.y - b.y
    const magnitude = Math.hypot(ux, uy) * Math.hypot(vx, vy)
    if (!magnitude) return null
    return Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / magnitude))) * 180 / Math.PI
  }
  const before = read(previous)
  const after = read(current)
  if (before === null || after === null) return null
  const dt = Math.max(1, current.timeMs - previous.timeMs) / 1000
  return Math.abs(after - before) / dt
}

/** 相对躯干的肢体位移速度：归一化坐标/秒，除以躯干长后与身高/机位距离无关 */
function limbSpeed(previous: MotionFrame, current: MotionFrame): number | null {
  const torso = (frame: MotionFrame): number | null => {
    const shoulder = frame.points.shoulder.left && frame.points.shoulder.right
      ? { x: (frame.points.shoulder.left.x + frame.points.shoulder.right.x) / 2, y: (frame.points.shoulder.left.y + frame.points.shoulder.right.y) / 2 }
      : null
    const hip = frame.points.hip.left && frame.points.hip.right
      ? { x: (frame.points.hip.left.x + frame.points.hip.right.x) / 2, y: (frame.points.hip.left.y + frame.points.hip.right.y) / 2 }
      : null
    if (!shoulder || !hip) return null
    const length = Math.hypot(shoulder.x - hip.x, shoulder.y - hip.y)
    return length > 0.02 ? length : null
  }
  const scale = torso(current) ?? torso(previous)
  if (!scale) return null
  const dt = Math.max(1, current.timeMs - previous.timeMs) / 1000
  let total = 0
  let count = 0
  for (const joint of ['ankle', 'wrist', 'knee'] as const) {
    for (const side of ['left', 'right'] as const) {
      const before = (previous.points[joint] as { left: { x: number; y: number } | null; right: { x: number; y: number } | null } | undefined)?.[side] ?? null
      const after = (current.points[joint] as { left: { x: number; y: number } | null; right: { x: number; y: number } | null } | undefined)?.[side] ?? null
      if (!before || !after) continue
      total += Math.hypot(after.x - before.x, after.y - before.y) / scale
      count++
    }
  }
  return count ? Math.min(8, total / count / dt) : null
}

function smooth(values: number[], windowFrames: number): number[] {
  const size = Math.max(1, windowFrames | 1)
  if (size <= 1) return values
  const half = Math.floor(size / 2)
  return values.map((_, index) => {
    const lo = Math.max(0, index - half)
    const hi = Math.min(values.length - 1, index + half)
    const slice = values.slice(lo, hi + 1)
    return slice.reduce((sum, value) => sum + value, 0) / slice.length
  })
}

/**
 * 从粗扫帧估计逐帧运动能量并切出活跃区间。
 * 返回的区间已经合并、留白、裁到 [0, duration]；没有可用区间时 found=false。
 */
export function detectActiveWindows(frames: MotionFrame[], fps: number, options: ActiveWindowOptions = {}): ActiveWindowResult {
  const minEnergy = options.minEnergy ?? 6
  const mergeGapMs = options.mergeGapMs ?? 500
  const minWindowMs = options.minWindowMs ?? 900
  const padMs = options.padMs ?? 500

  const raw: number[] = frames.map(() => 0)
  for (let index = 1; index < frames.length; index++) {
    const previous = frames[index - 1]
    const current = frames[index]
    const rates = [
      angleRate(previous, current, 'knee'),
      angleRate(previous, current, 'hip'),
      angleRate(previous, current, 'elbow')
    ].filter((value): value is number => value !== null)
    const speed = limbSpeed(previous, current)
    // 角度项单位 °/s，经验上 30°/s 已相当于一次明显下蹲的中间段；除以 3 与位移项量级对齐
    const anglePart = rates.length ? rates.reduce((sum, value) => sum + value, 0) / rates.length / 3 : 0
    raw[index] = anglePart + (speed ?? 0) * 2
  }
  raw[0] = raw[1] ?? 0

  const smoothed = smooth(raw, options.smoothFrames ?? (Math.max(3, Math.round(fps * 0.3)) | 1))
  const energy: MotionEnergyFrame[] = frames.map((frame, index) => ({
    timeMs: frame.timeMs,
    energy: Math.round(Math.min(400, smoothed[index]) * 100) / 100,
    visibility: frame.visibility
  }))
  const valid = energy.filter(frame => frame.visibility >= 0.5).map(frame => frame.energy)
  const quiet = percentile(valid, 0.2)
  const peak = percentile(valid, 0.95)
  if (quiet === null || peak === null) {
    return { windows: [], energy, threshold: null, found: false }
  }
  // 阈值 = 安静段 + 动态范围的一段；真实素材上比 median+3MAD 稳：
  // 整片都在动的视频（跑步）不会因为"中位数本身就高"而永远没有活跃帧。
  const threshold = Math.max(minEnergy, quiet + 0.35 * Math.max(0, peak - quiet))

  const durationMs = frames.length > 1 ? frames[frames.length - 1].timeMs : 0
  const windows: AnalyzedRange[] = []
  let start: number | null = null
  let lastActiveMs = 0
  for (let index = 0; index < frames.length; index++) {
    const frame = energy[index]
    const active = frame.visibility >= 0.5 && frame.energy >= threshold
    if (active) {
      if (start === null) start = frame.timeMs
      lastActiveMs = frame.timeMs
    } else if (start !== null && frame.timeMs - lastActiveMs > mergeGapMs) {
      windows.push({ startMs: start, endMs: lastActiveMs, source: 'active-window' })
      start = null
    }
  }
  if (start !== null) windows.push({ startMs: start, endMs: lastActiveMs, source: 'active-window' })

  const padded = windows
    .map(window => ({
      startMs: Math.max(0, window.startMs - padMs),
      endMs: Math.min(durationMs, window.endMs + padMs),
      source: window.source
    }))
    .filter(window => window.endMs - window.startMs >= minWindowMs)
    .sort((a, b) => a.startMs - b.startMs)

  // 留白后可能重叠，再合并一次
  const merged: AnalyzedRange[] = []
  for (const window of padded) {
    const previous = merged[merged.length - 1]
    if (previous && window.startMs <= previous.endMs + mergeGapMs) {
      previous.endMs = Math.max(previous.endMs, window.endMs)
      continue
    }
    merged.push({ ...window })
  }

  return { windows: merged, energy, threshold: Math.round(threshold * 100) / 100, found: merged.length > 0 }
}

/** 全片总的活跃区间：多个窗口取并集范围（用于"分析区间"展示） */
export function unionRange(windows: AnalyzedRange[], durationMs: number): AnalyzedRange | null {
  if (!windows.length) return null
  return {
    startMs: Math.max(0, Math.min(...windows.map(window => window.startMs))),
    endMs: Math.max(0, Math.min(durationMs, Math.max(...windows.map(window => window.endMs)))),
    source: 'active-window'
  }
}

/**
 * 在给定范围内挑"运动量最大的一段"：跑姿只分析最活跃的 20 秒，
 * 不再默认截前 20 秒（视频可能前 10 秒是走路/摆位）。
 */
export function mostActiveSpan(
  energy: MotionEnergyFrame[],
  range: { startMs: number; endMs: number },
  targetMs: number
): AnalyzedRange | null {
  const rows = energy.filter(frame => frame.timeMs >= range.startMs && frame.timeMs <= range.endMs)
  if (!rows.length) return null
  const span = Math.min(targetMs, Math.max(0, range.endMs - range.startMs))
  if (span <= 0) return null
  let bestStart = range.startMs
  let bestSum = -1
  // 两指针滑动窗口，按时间而不是帧数，兼容不同帧率
  let left = 0
  let sum = 0
  for (let right = 0; right < rows.length; right++) {
    sum += rows[right].energy
    while (rows[right].timeMs - rows[left].timeMs > span && left < right) {
      sum -= rows[left].energy
      left++
    }
    if (sum > bestSum) {
      bestSum = sum
      bestStart = rows[left].timeMs
    }
  }
  const startMs = Math.max(range.startMs, Math.min(bestStart, range.endMs - span))
  return { startMs, endMs: Math.min(range.endMs, startMs + span), source: 'gait-window' }
}