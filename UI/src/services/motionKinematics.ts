// 运动学引擎：从现有逐帧关键点/关节角派生速度与加速度。
// 纯函数接缝：不碰 DOM、不依赖 Vue，selfcheck 可直接断言。
//
// 口径边界：
// - 角度沿用现有 2D 归一化关键点，保证与既有规则/角度曲线是同一套口径；
// - 线速度只按躯干长度归一化，单位「躯干长/秒」，不谎报 m/s；
// - MediaPipe 世界坐标以髋中点为原点、不含整体平移，本次不用于绝对速度。
import type {
  AnalysisAction,
  MotionAnalysisMetric,
  MotionKinematics,
  MotionKinematicsJoint,
  MotionKinematicsLinear,
  MotionKinematicsRep,
  MotionKinematicsSample
} from '@/types/domain'
import type { MotionFrame, MotionPoint, RepAnalysis } from '@/services/motionAnalysis'
import { angleAtExact, trunkAngleAt } from '@/composables/poseMath'
import { configForAction } from '@/services/motionConfig'

export const MOTION_KINEMATICS_VERSION = 'motion-kinematics-v1'
export const KINEMATICS_METRIC_PREFIX = 'kin-'

export const KINEMATICS_CONFIG = {
  /** 0.5 秒窗口在 15fps 约 9 帧、30fps 约 17 帧；足够压住关键点抖动，又不至于抹平一次深蹲的峰 */
  windowSec: 0.5,
  order: 2,
  minPoints: 5,
  minVisibility: 0.5,
  maxGapFrames: 2.5,
  gapFloorMs: 80
} as const

export interface DerivativeOptions {
  windowSec: number
  order: 2
  minPoints: number
  maxGapMs: number
}

export interface DerivativeSample {
  timeMs: number
  value: number | null
  /** 一阶导数，单位 = 输入值单位 / 秒 */
  velocity: number | null
  /** 二阶导数，单位 = 输入值单位 / 秒²；边界与短段为 null */
  acceleration: number | null
}

type JointName = 'knee' | 'hip' | 'trunk'
type Side = 'left' | 'right'

interface JointTriple {
  a: MotionPoint
  v: MotionPoint
  b: MotionPoint | null
}

const JOINTS: JointName[] = ['knee', 'hip', 'trunk']

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function median(values: number[]): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

const round1 = (value: number) => Math.round(value * 10) / 10

function midpoint(a: MotionPoint | null, b: MotionPoint | null): MotionPoint | null {
  if (!a || !b) return null
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, visibility: Math.min(a.visibility, b.visibility) }
}

function optionsFor(fps: number): DerivativeOptions {
  const safeFps = Number.isFinite(fps) && fps > 0 ? fps : 15
  return {
    windowSec: KINEMATICS_CONFIG.windowSec,
    order: KINEMATICS_CONFIG.order,
    minPoints: KINEMATICS_CONFIG.minPoints,
    maxGapMs: Math.max(KINEMATICS_CONFIG.gapFloorMs, (KINEMATICS_CONFIG.maxGapFrames * 1000) / safeFps)
  }
}

/** 3×3 正规方程，部分主元高斯消元；奇异返回 null。 */
function solve3(matrix: number[][], vector: number[]): [number, number, number] | null {
  const a = matrix.map((row, index) => [...row, vector[index]])
  for (let col = 0; col < 3; col++) {
    let pivot = col
    for (let row = col + 1; row < 3; row++) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row
    }
    if (!Number.isFinite(a[pivot][col]) || Math.abs(a[pivot][col]) < 1e-12) return null
    if (pivot !== col) {
      const temp = a[col]
      a[col] = a[pivot]
      a[pivot] = temp
    }
    const diagonal = a[col][col]
    for (let j = col; j < 4; j++) a[col][j] /= diagonal
    for (let row = 0; row < 3; row++) {
      if (row === col) continue
      const factor = a[row][col]
      if (factor === 0) continue
      for (let j = col; j < 4; j++) a[row][j] -= factor * a[col][j]
    }
  }
  return [a[0][3], a[1][3], a[2][3]]
}

interface QuadraticFit {
  value: number
  velocity: number
  acceleration: number
}

/**
 * 在 [lo, hi] 上以 centerIndex 为中心做二次最小二乘。
 * u 用秒做单位，所以 a1 是「输入单位/秒」，2a2 是「输入单位/秒²」。
 */
function fitQuadratic(
  samples: { timeMs: number; value: number | null }[],
  lo: number,
  hi: number,
  centerIndex: number
): QuadraticFit | null {
  const centerTime = samples[centerIndex].timeMs
  const ata = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
  const aty = [0, 0, 0]
  let count = 0
  for (let index = lo; index <= hi; index++) {
    const value = samples[index].value
    if (!isFiniteNumber(value)) continue
    const u = (samples[index].timeMs - centerTime) / 1000
    if (!Number.isFinite(u)) continue
    const terms = [1, u, u * u]
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) ata[row][col] += terms[row] * terms[col]
      aty[row] += terms[row] * value
    }
    count++
  }
  if (count < 3) return null
  const coefficients = solve3(ata, aty)
  if (!coefficients) return null
  const [a0, a1, a2] = coefficients
  if (![a0, a1, a2].every(Number.isFinite)) return null
  return { value: a0, velocity: a1, acceleration: 2 * a2 }
}

/**
 * Savitzky–Golay 局部多项式求导。
 * 缺失值处切段，不插值、不补 0；重复/倒退时间戳也切段。
 */
export function savitzkyGolay(
  samples: { timeMs: number; value: number | null }[],
  options: Partial<DerivativeOptions> = {}
): DerivativeSample[] {
  const out: DerivativeSample[] = samples.map(sample => ({
    timeMs: sample.timeMs,
    value: null,
    velocity: null,
    acceleration: null
  }))
  if (!samples.length) return out

  const windowSec = options.windowSec ?? KINEMATICS_CONFIG.windowSec
  const order = options.order ?? KINEMATICS_CONFIG.order
  const minPoints = Math.max(order + 1, options.minPoints ?? KINEMATICS_CONFIG.minPoints)
  const maxGapMs = options.maxGapMs ?? 120

  const flush = (start: number, endExclusive: number) => {
    const length = endExclusive - start
    if (length < minPoints) return
    const diffs: number[] = []
    for (let index = start + 1; index < endExclusive; index++) {
      const diff = samples[index].timeMs - samples[index - 1].timeMs
      if (diff > 0) diffs.push(diff)
    }
    const medianDt = median(diffs)
    if (medianDt === null || medianDt <= 0) return
    const half = Math.max(2, Math.min(12, Math.round((windowSec * 1000) / medianDt / 2)))
    for (let index = start; index < endExclusive; index++) {
      const lo = Math.max(start, index - half)
      const hi = Math.min(endExclusive - 1, index + half)
      if (hi - lo + 1 < minPoints) continue
      const fit = fitQuadratic(samples, lo, hi, index)
      if (!fit) continue
      const fullWindow = index - half >= start && index + half <= endExclusive - 1
      out[index] = {
        timeMs: samples[index].timeMs,
        value: fit.value,
        velocity: fit.velocity,
        // 边界只有单侧窗口，二阶导数不稳定，宁可缺也不给伪峰
        acceleration: fullWindow ? fit.acceleration : null
      }
    }
  }

  let runStart = -1
  for (let index = 0; index < samples.length; index++) {
    const sample = samples[index]
    if (!isFiniteNumber(sample.value)) {
      if (runStart >= 0) flush(runStart, index)
      runStart = -1
      continue
    }
    if (runStart < 0) {
      runStart = index
      continue
    }
    const previous = samples[index - 1]
    if (!isFiniteNumber(previous.value)
      || sample.timeMs <= previous.timeMs
      || sample.timeMs - previous.timeMs > maxGapMs) {
      flush(runStart, index)
      runStart = index
    }
  }
  if (runStart >= 0) flush(runStart, samples.length)
  return out
}

function tripleFor(frame: MotionFrame, joint: JointName, side: Side): JointTriple | null {
  const { shoulder, hip, knee, ankle } = frame.points
  if (joint === 'trunk') {
    const shoulderPoint = shoulder[side]
    const hipPoint = hip[side]
    return shoulderPoint && hipPoint ? { a: shoulderPoint, v: hipPoint, b: null } : null
  }
  if (joint === 'knee') {
    const hipPoint = hip[side]
    const kneePoint = knee[side]
    const anklePoint = ankle[side]
    return hipPoint && kneePoint && anklePoint ? { a: hipPoint, v: kneePoint, b: anklePoint } : null
  }
  const shoulderPoint = shoulder[side]
  const hipPoint = hip[side]
  const kneePoint = knee[side]
  return shoulderPoint && hipPoint && kneePoint ? { a: shoulderPoint, v: hipPoint, b: kneePoint } : null
}

/**
 * 整段固定一侧：逐帧换侧会在导数上制造一次巨大跳变。
 * 用所有有效帧的顶点可见度累计评分，平票取左。
 */
function chooseSide(frames: MotionFrame[], joint: JointName): Side | null {
  const score = (side: Side) => {
    let count = 0
    let total = 0
    for (const frame of frames) {
      const triple = tripleFor(frame, joint, side)
      if (!triple) continue
      const points = triple.b ? [triple.a, triple.v, triple.b] : [triple.a, triple.v]
      if (points.some(point => point.visibility < KINEMATICS_CONFIG.minVisibility)) continue
      count++
      total += joint === 'trunk'
        ? Math.min(triple.a.visibility, triple.v.visibility)
        : triple.v.visibility
    }
    return { count, total }
  }
  const left = score('left')
  const right = score('right')
  if (left.count < KINEMATICS_CONFIG.minPoints && right.count < KINEMATICS_CONFIG.minPoints) return null
  if (left.count < KINEMATICS_CONFIG.minPoints) return 'right'
  if (right.count < KINEMATICS_CONFIG.minPoints) return 'left'
  return right.total > left.total ? 'right' : 'left'
}

function exactAngle(frame: MotionFrame, joint: JointName, side: Side): number | null {
  const triple = tripleFor(frame, joint, side)
  if (!triple) return null
  const points = triple.b ? [triple.a, triple.v, triple.b] : [triple.a, triple.v]
  if (points.some(point => point.visibility < KINEMATICS_CONFIG.minVisibility)) return null
  if (joint === 'trunk') return trunkAngleAt(triple.a, triple.v)
  return triple.b ? angleAtExact(triple.a, triple.v, triple.b) : null
}

function buildJoint(frames: MotionFrame[], joint: JointName, fps: number): MotionKinematicsJoint {
  const side = chooseSide(frames, joint)
  const samples: MotionKinematicsSample[] = frames.map(frame => ({
    timeMs: frame.timeMs,
    angle: null,
    angularVelocity: null,
    angularAcceleration: null
  }))
  if (!side) return { joint, side: null, samples, validRatio: 0 }

  const values = frames.map(frame => ({ timeMs: frame.timeMs, value: exactAngle(frame, joint, side) }))
  const derived = savitzkyGolay(values, optionsFor(fps))
  let valid = 0
  for (let index = 0; index < frames.length; index++) {
    const row = derived[index]
    samples[index] = {
      timeMs: frames[index].timeMs,
      angle: row?.value ?? null,
      angularVelocity: row?.velocity ?? null,
      angularAcceleration: row?.acceleration ?? null
    }
    if (samples[index].angularVelocity !== null) valid++
  }
  return { joint, side, samples, validRatio: frames.length ? valid / frames.length : 0 }
}

function buildLinear(frames: MotionFrame[], fps: number): MotionKinematicsLinear | null {
  const torsoLengths: number[] = []
  for (const frame of frames) {
    const shoulder = midpoint(frame.points.shoulder.left, frame.points.shoulder.right)
    const hip = midpoint(frame.points.hip.left, frame.points.hip.right)
    if (!shoulder || !hip) continue
    if (Math.min(shoulder.visibility, hip.visibility) < KINEMATICS_CONFIG.minVisibility) continue
    const length = Math.hypot(shoulder.x - hip.x, shoulder.y - hip.y)
    if (Number.isFinite(length) && length > 0.05) torsoLengths.push(length)
  }
  if (torsoLengths.length < KINEMATICS_CONFIG.minPoints) return null
  const scaleLength = median(torsoLengths)
  if (scaleLength === null || !Number.isFinite(scaleLength) || scaleLength <= 0) return null

  const values = frames.map(frame => {
    const hip = midpoint(frame.points.hip.left, frame.points.hip.right)
    const value = !hip || hip.visibility < KINEMATICS_CONFIG.minVisibility
      ? null
      : -hip.y / scaleLength
    // 图像 y 向下；取负后「向上为正」，深蹲下降段速度为负
    return { timeMs: frame.timeMs, value }
  })
  const derived = savitzkyGolay(values, optionsFor(fps))
  let valid = 0
  const samples = derived.map((row, index) => {
    if (row.velocity !== null) valid++
    return { timeMs: frames[index].timeMs, velocity: row.velocity, acceleration: row.acceleration }
  })
  return {
    unit: '躯干长/秒',
    scaleLength: Math.round(scaleLength * 1e4) / 1e4,
    samples,
    validRatio: frames.length ? valid / frames.length : 0
  }
}

function buildReps(reps: RepAnalysis[], samples: MotionKinematicsSample[]): MotionKinematicsRep[] {
  return reps.map(rep => {
    let peakFlexion: number | null = null
    let peakExtension: number | null = null
    let peakAcceleration: number | null = null
    let peakAccelerationTime: number | null = null
    for (const sample of samples) {
      if (sample.timeMs < rep.startMs || sample.timeMs > rep.endMs) continue
      const velocity = sample.angularVelocity
      if (velocity !== null) {
        if (sample.timeMs <= rep.bottomMs && velocity < 0) {
          const magnitude = -velocity
          peakFlexion = peakFlexion === null ? magnitude : Math.max(peakFlexion, magnitude)
        }
        if (sample.timeMs >= rep.bottomMs && velocity > 0) {
          peakExtension = peakExtension === null ? velocity : Math.max(peakExtension, velocity)
        }
      }
      const acceleration = sample.angularAcceleration
      if (acceleration !== null) {
        const magnitude = Math.abs(acceleration)
        if (peakAcceleration === null || magnitude > peakAcceleration) {
          peakAcceleration = magnitude
          peakAccelerationTime = sample.timeMs
        }
      }
    }
    return {
      index: rep.index,
      startMs: rep.startMs,
      bottomMs: rep.bottomMs,
      endMs: rep.endMs,
      peakFlexionVelocity: peakFlexion,
      peakExtensionVelocity: peakExtension,
      peakAngularAcceleration: peakAcceleration,
      peakAccelerationTimeMs: peakAccelerationTime
    }
  })
}

export function computeKinematics(input: {
  frames: MotionFrame[]
  action: AnalysisAction
  fps: number
  reps: RepAnalysis[]
}): MotionKinematics | null {
  const { frames, action, reps } = input
  if (!frames.length) return null
  const fps = Number.isFinite(input.fps) && input.fps > 0 ? input.fps : 15
  const joints = JOINTS.map(joint => buildJoint(frames, joint, fps))
  const linear = buildLinear(frames, fps)
  if (!joints.some(joint => joint.validRatio > 0) && !linear) return null

  const primaryJoint: 'knee' | 'hip' = action === 'deadlift' ? 'hip' : 'knee'
  const primary = joints.find(joint => joint.joint === primaryJoint)
  const repKinematics = primary?.side ? buildReps(reps, primary.samples) : []
  return {
    version: MOTION_KINEMATICS_VERSION,
    primaryJoint,
    joints,
    linear,
    reps: repKinematics,
    quality: {
      smoothing: 'savitzky-golay',
      windowSec: KINEMATICS_CONFIG.windowSec,
      order: KINEMATICS_CONFIG.order,
      validRatio: primary?.validRatio ?? 0
    }
  }
}

const maxOf = (values: number[]): number | null => values.length ? Math.max(...values) : null

function peakAbs(samples: { value: number | null }[]): number | null {
  let peak: number | null = null
  for (const sample of samples) {
    if (sample.value === null) continue
    const magnitude = Math.abs(sample.value)
    peak = peak === null ? magnitude : Math.max(peak, magnitude)
  }
  return peak
}

/**
 * 聚合数值指标：只输出非 null，全部以 kin- 开头，供 UI 与通用测量值分离。
 * 这些是测量值，不是 finding；不设阈值、不判断标准与否。
 */
export function kinematicsMetrics(
  kinematics: MotionKinematics | null,
  action: AnalysisAction
): MotionAnalysisMetric[] {
  if (!kinematics) return []
  const metrics: MotionAnalysisMetric[] = []
  const push = (id: string, label: string, value: number | null, unit?: string) => {
    if (value === null || !Number.isFinite(value)) return
    metrics.push({ id: `${KINEMATICS_METRIC_PREFIX}${id}`, label, value: round1(value), ...(unit ? { unit } : {}) })
  }

  const config = configForAction(action)
  const downLabel = config?.phaseText.down ?? '下蹲'
  const upLabel = config?.phaseText.up ?? '起身'

  const flexionPeaks = kinematics.reps
    .map(rep => rep.peakFlexionVelocity)
    .filter((value): value is number => isFiniteNumber(value))
  const extensionPeaks = kinematics.reps
    .map(rep => rep.peakExtensionVelocity)
    .filter((value): value is number => isFiniteNumber(value))
  const accelerationPeaks = kinematics.reps
    .map(rep => rep.peakAngularAcceleration)
    .filter((value): value is number => isFiniteNumber(value))

  const primary = kinematics.joints.find(joint => joint.joint === kinematics.primaryJoint)
  const jointLabel = kinematics.primaryJoint === 'hip' ? '髋' : '膝'
  if (primary) {
    // 有完整重复时只统计重复区间，避免视频首尾的起身/离开画面被当成峰值。
    // 跑姿没有 rep 结构，只能对全程取峰值。
    if (kinematics.reps.length) {
      push('peak-angular-velocity', `峰值角速度（${jointLabel}）`, maxOf([...flexionPeaks, ...extensionPeaks]), '°/s')
      push('peak-angular-acceleration', `峰值角加速度（${jointLabel}）`, maxOf(accelerationPeaks), '°/s²')
    } else if (action === 'running') {
      push('peak-angular-velocity', `峰值角速度（${jointLabel}）`, peakAbs(primary.samples.map(sample => ({ value: sample.angularVelocity }))), '°/s')
      push('peak-angular-acceleration', `峰值角加速度（${jointLabel}）`, peakAbs(primary.samples.map(sample => ({ value: sample.angularAcceleration }))), '°/s²')
    }
  }

  if (flexionPeaks.length) push('eccentric-peak-angular-velocity', `${downLabel}峰值角速度`, maxOf(flexionPeaks), '°/s')
  if (extensionPeaks.length) push('concentric-peak-angular-velocity', `${upLabel}峰值角速度`, maxOf(extensionPeaks), '°/s')

  if (extensionPeaks.length >= 2) {
    const first = extensionPeaks[0]
    const last = extensionPeaks[extensionPeaks.length - 1]
    push('rep-peak-first', `首次${upLabel}峰值角速度`, first, '°/s')
    push('rep-peak-last', `末次${upLabel}峰值角速度`, last, '°/s')
    if (first > 0) {
      push('rep-peak-change', `组内${upLabel}峰值角速度变化`, ((last - first) / first) * 100, '%')
    }
  }

  if (kinematics.linear) {
    const ranges = kinematics.reps.filter(rep => Number.isFinite(rep.startMs) && Number.isFinite(rep.endMs))
    const samples = ranges.length
      ? kinematics.linear.samples.filter(sample => ranges.some(rep => sample.timeMs >= rep.startMs && sample.timeMs <= rep.endMs))
      : kinematics.linear.samples
    push('linear-peak-velocity', '髋部峰值竖直速度', peakAbs(samples.map(sample => ({ value: sample.velocity }))), '躯干长/秒')
    push('linear-peak-acceleration', '髋部峰值竖直加速度', peakAbs(samples.map(sample => ({ value: sample.acceleration }))), '躯干长/秒²')
  }

  return metrics
}

export function isKinematicsMetric(metric: MotionAnalysisMetric): boolean {
  return typeof metric.id === 'string' && metric.id.startsWith(KINEMATICS_METRIC_PREFIX)
}