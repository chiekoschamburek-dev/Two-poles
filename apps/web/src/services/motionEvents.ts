// 统一事件流：实时跟练订阅它做即时反馈，离线分析收集它做二次分析与报告。
// 纯函数接缝：不碰 DOM、不依赖 Vue，selfcheck 可直接断言。
//
// 因果性约定：realtime 只用过去与当前帧；offline 允许全序列平滑与回看。
// analyzeRep 会搜整个 rep 找最低点，看似非因果——但 rep-complete 时该 rep 已结束，
// 其所有帧都是过去/当前，所以实时按 rep 缓冲后跑同一个 analyzeRep，摘要与离线逐位相同。
import type { ExercisePhase } from '@/types/domain'
import type { RepMachineSnapshot, RepInterval, RepRule } from '@/composables/repMachine'
import { createRepMachine } from '@/composables/repMachine'
import type { MotionFrame, RepAnalysis, MotionPoint } from '@/services/motionAnalysis'
import type { JointName } from '@/services/motionConfig'

export type MotionEvent =
  | { type: 'rep-complete'; ts: number; index: number; interval: RepInterval; summary: RepAnalysis | null; mode: 'realtime' | 'offline' }
  | { type: 'phase-change'; ts: number; from: ExercisePhase; to: ExercisePhase; joint: JointName; angle: number | null }
  | { type: 'amplitude-change'; ts: number; joint: JointName; angle: number; smoothed: number; zone: 'start' | 'between' | 'end' }
  | { type: 'keypoints-lost'; ts: number; visibility: number; reason: 'occluded' | 'gap' | 'side-switch' }
  | { type: 'keypoints-restored'; ts: number; visibility: number }
  | { type: 'gate'; ts: number; text: string | null }
  | { type: 'calibration'; ts: number; neutral: number }
  | { type: 'set-boundary'; ts: number; setIndex: number; edge: 'start' | 'end' }

/** amplitude-change 节流：只在跨区或角度移动超过这个度数时才发，不每帧发 */
export const AMPLITUDE_MIN_DELTA_DEG = 2

export interface RepThresholds {
  neutral: number
  low: number
  high: number
  increasing: boolean
}

/** 与 repMachine 内部同一套三区口径；状态机不导出阈值时由调用方按 rule 算 */
export function thresholdsFor(rule: RepRule, calibratedNeutral: number | null = null): RepThresholds {
  const neutral = calibratedNeutral ?? rule.neutral
  const increasing = rule.bottom > neutral
  const midpoint = (neutral + rule.bottom) / 2
  return {
    neutral,
    increasing,
    low: midpoint + (increasing ? rule.hysteresis : -rule.hysteresis),
    high: midpoint + (increasing ? -rule.hysteresis : rule.hysteresis)
  }
}

export function zoneFor(angle: number, thresholds: RepThresholds): 'start' | 'between' | 'end' {
  return thresholds.increasing
    ? (angle >= thresholds.low ? 'end' : angle <= thresholds.high ? 'start' : 'between')
    : (angle <= thresholds.low ? 'end' : angle >= thresholds.high ? 'start' : 'between')
}

export interface SnapshotContext {
  ts: number
  joint: JointName
  angle: number | null
  /** 尾部 3 帧平滑后的角度，与状态机吃进去的是同一个值 */
  smoothed?: number | null
  visibility: number
  mode: 'realtime' | 'offline'
  thresholds?: RepThresholds
  /** rep 完成时由调用方用缓冲帧算出的摘要；实时与离线共用 analyzeRep */
  summary?: RepAnalysis | null
  lostReason?: 'occluded' | 'gap' | 'side-switch'
}

/**
 * 实时：diff 两次状态机快照。lastRep 本来就由共享状态机产出，
 * 此前被 useRepCounter.apply 丢弃，这里把它接出来。
 */
export function eventsFromSnapshot(
  previous: RepMachineSnapshot | null,
  next: RepMachineSnapshot,
  context: SnapshotContext,
  previousZone: 'start' | 'between' | 'end' | null = null
): MotionEvent[] {
  const events: MotionEvent[] = []
  const { ts, joint, angle, visibility, mode } = context

  if (next.counted && next.lastRep) {
    events.push({
      type: 'rep-complete', ts, index: next.count, interval: next.lastRep,
      summary: context.summary ?? null, mode
    })
  }
  if (previous && previous.phase !== next.phase) {
    events.push({ type: 'phase-change', ts, from: previous.phase, to: next.phase, joint, angle })
  }

  const smoothed = context.smoothed ?? angle
  if (context.thresholds && smoothed !== null) {
    const zone = zoneFor(smoothed, context.thresholds)
    if (zone !== previousZone) {
      events.push({ type: 'amplitude-change', ts, joint, angle: angle ?? smoothed, smoothed, zone })
    }
  }

  const wasOccluded = previous?.phase === 'occluded'
  const isOccluded = next.phase === 'occluded'
  if (!wasOccluded && isOccluded) {
    events.push({ type: 'keypoints-lost', ts, visibility, reason: context.lostReason ?? 'occluded' })
  } else if (wasOccluded && !isOccluded) {
    events.push({ type: 'keypoints-restored', ts, visibility })
  }
  if (!previous || previous.gate !== next.gate) {
    events.push({ type: 'gate', ts, text: next.gate })
  }
  if (previous && previous.calibratedNeutral !== next.calibratedNeutral && next.calibratedNeutral !== null) {
    events.push({ type: 'calibration', ts, neutral: next.calibratedNeutral })
  }
  return events
}

function tripleFor(frame: MotionFrame, joint: JointName, side: 'left' | 'right'): [MotionPoint, MotionPoint, MotionPoint] | null {
  const hip = frame.points.hip[side]
  const knee = frame.points.knee[side]
  const ankle = frame.points.ankle[side]
  const shoulder = frame.points.shoulder[side]
  const elbow = frame.points.elbow?.[side]
  const wrist = frame.points.wrist?.[side]
  if (joint === 'hip') return shoulder && hip && knee ? [shoulder, hip, knee] : null
  if (joint === 'elbow') return shoulder && elbow && wrist ? [shoulder, elbow, wrist] : null
  return hip && knee && ankle ? [hip, knee, ankle] : null
}

/** 逐帧驱动关节角与三点可见度最小值，与 segmentReps 同口径 */
export function jointSample(frame: MotionFrame, joint: JointName): { angle: number | null; visibility: number } {
  const sides = frame.points[joint]
  if (!sides) return { angle: null, visibility: 0 }
  const side = sides.right && sides.left
    ? (sides.right.visibility > sides.left.visibility ? 'right' : 'left')
    : (sides.right ? 'right' : 'left')
  const triple = tripleFor(frame, joint, side)
  if (!triple) return { angle: null, visibility: 0 }
  const [a, v, b] = triple
  const u = { x: a.x - v.x, y: a.y - v.y }
  const w = { x: b.x - v.x, y: b.y - v.y }
  const magnitude = Math.hypot(u.x, u.y) * Math.hypot(w.x, w.y)
  if (!magnitude) return { angle: null, visibility: 0 }
  const cos = Math.min(1, Math.max(-1, (u.x * w.x + u.y * w.y) / magnitude))
  return {
    angle: Math.round((Math.acos(cos) * 180) / Math.PI),
    visibility: Math.min(a.visibility, v.visibility, b.visibility)
  }
}

export interface OfflineEventResult {
  events: MotionEvent[]
  intervals: RepInterval[]
  count: number
}

/**
 * 离线：把整段序列重喂同一个状态机，逐 interval 产出 rep-complete。
 * analyzeRep 由调用方传入（避免循环依赖），实时侧用同一个函数保证摘要一致。
 */
export function eventsFromFrames(
  frames: MotionFrame[],
  rule: RepRule,
  joint: JointName,
  analyzeRep?: (frames: MotionFrame[], interval: RepInterval, index: number) => RepAnalysis
): OfflineEventResult {
  const machine = createRepMachine(rule)
  const thresholds = thresholdsFor(rule)
  const events: MotionEvent[] = []
  const intervals: RepInterval[] = []
  const window: number[] = []
  let previous: RepMachineSnapshot | null = null
  let previousZone: 'start' | 'between' | 'end' | null = null
  for (const frame of frames) {
    const sample = jointSample(frame, joint)
    const snapshot = machine.feed(sample.angle, sample.visibility, frame.timeMs)
    let smoothed: number | null = null
    if (sample.angle !== null && sample.visibility >= rule.minVisibility) {
      window.push(sample.angle)
      if (window.length > 3) window.shift()
      smoothed = window.reduce((sum, value) => sum + value, 0) / window.length
    } else {
      window.length = 0
    }
    const summary = snapshot.counted && snapshot.lastRep
      ? (analyzeRep ? analyzeRep(frames, snapshot.lastRep, intervals.length + 1) : null)
      : null
    if (snapshot.counted && snapshot.lastRep) intervals.push(snapshot.lastRep)
    events.push(...eventsFromSnapshot(previous, snapshot, {
      ts: frame.timeMs, joint, angle: sample.angle, smoothed, visibility: sample.visibility,
      mode: 'offline', thresholds, summary
    }, previousZone))
    if (smoothed !== null) previousZone = zoneFor(smoothed, thresholds)
    previous = snapshot
  }
  return { events, intervals, count: machine.snapshot().count }
}

/** 实时环形缓冲：上限 900 帧 ≈ 60s@15fps，另加活动 rep 缓冲 */
export const REALTIME_BUFFER_CAP = 900

export interface FrameBuffer {
  push(frame: MotionFrame): void
  all(): MotionFrame[]
  since(startMs: number): MotionFrame[]
  clear(): void
}

export function createFrameBuffer(cap = REALTIME_BUFFER_CAP): FrameBuffer {
  const frames: MotionFrame[] = []
  return {
    push(frame) {
      frames.push(frame)
      if (frames.length > cap) frames.shift()
    },
    all: () => frames,
    since: startMs => frames.filter(frame => frame.timeMs >= startMs),
    clear() { frames.length = 0 }
  }
}