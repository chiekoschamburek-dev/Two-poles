// 姿态质量层：把"关键点可见"升级为"这一帧/这个关节的测量能不能信"。
// 可见 ≠ 定位准：骨长突变、关键点瞬跳、左右交换都会让角度测量偏几十度，
// 但平均可见度仍可能是 0.9。这里逐帧给可靠性，并切出推理缺口。
//
// 口径要点（用真实素材校准过）：
// - 骨长按"躯干长中位数"归一化后再比较，容忍透视/前倾造成的系统性缩短；
// - 跳变按"该关节自身典型位移"的倍数判定，不拿绝对像素当阈值：
//   跑步踝关节一帧摆 0.1 个归一化单位是正常的，关键点瞬移 0.3 才该被抓出来；
// - 可靠性是扣分制而不是乘积归零：单项异常只降低该帧权重，不把整段判死。
//
// 纯函数：输入 MotionFrame[]（与 V1 同一份帧结构），输出 PoseQualitySummary + 逐帧 reliability。

import type { MotionFrame, MotionPoint } from '@/services/motionAnalysis'
import type { PoseQualitySummary } from '@/services/motion-engine/core/types'

/** 骨段定义：用同一套左右侧索引，骨长在整段视频里本应近似恒定 */
const BONE_SPECS: [string, (frame: MotionFrame) => [MotionPoint | null, MotionPoint | null]][] = [
  ['torsoLeft', f => [f.points.shoulder.left, f.points.hip.left]],
  ['torsoRight', f => [f.points.shoulder.right, f.points.hip.right]],
  ['thighLeft', f => [f.points.hip.left, f.points.knee.left]],
  ['thighRight', f => [f.points.hip.right, f.points.knee.right]],
  ['shankLeft', f => [f.points.knee.left, f.points.ankle.left]],
  ['shankRight', f => [f.points.knee.right, f.points.ankle.right]],
  ['upperArmLeft', f => [f.points.shoulder.left, f.points.elbow?.left ?? null]],
  ['upperArmRight', f => [f.points.shoulder.right, f.points.elbow?.right ?? null]],
  ['forearmLeft', f => [f.points.elbow?.left ?? null, f.points.wrist?.left ?? null]],
  ['forearmRight', f => [f.points.elbow?.right ?? null, f.points.wrist?.right ?? null]]
]

/** 参与跳变判定的关节（核心测量关节；腕/肘只做辅助） */
const JUMP_JOINTS = ['shoulder', 'hip', 'knee', 'ankle', 'wrist'] as const

export const POSE_QUALITY_CONFIG = {
  /** 骨长相对中位数偏离超过该比例才开始扣分（容忍透视与体态变化） */
  boneDeviationGrace: 0.18,
  /** 超过 grace 后再偏离该比例，该帧骨长项扣到 0 */
  boneDeviationLimit: 0.55,
  /** 相邻帧位移超过该关节典型位移的倍数才视为瞬跳 */
  jumpRatioLimit: 3,
  /** 判定推理缺口：相邻帧时间差超过 max(帧间隔×3, 该值) */
  gapFloorMs: 120,
  /** 可见度低于该值算"不可用帧"（与 V1 MIN_FRAME_VISIBILITY 一致） */
  usableVisibility: 0.5,
  /** 可靠性低于该值视为"不可信帧" */
  reliableThreshold: 0.5
} as const

function finite(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function distance(a: MotionPoint | null, b: MotionPoint | null): number | null {
  if (!a || !b || !finite(a.x) || !finite(a.y) || !finite(b.x) || !finite(b.y)) return null
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function median(values: number[]): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function percentile(values: number[], p: number): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]
}

function coefficientOfVariation(values: number[]): number {
  if (values.length < 2) return 0
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  if (mean <= 0) return 0
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length
  return Math.sqrt(variance) / mean
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

/** 帧内躯干中点距离：作为整段尺度基准（比单侧骨长更稳） */
function torsoLengthOf(frame: MotionFrame): number | null {
  const shoulder = frame.points.shoulder.left && frame.points.shoulder.right
    ? { x: (frame.points.shoulder.left.x + frame.points.shoulder.right.x) / 2, y: (frame.points.shoulder.left.y + frame.points.shoulder.right.y) / 2 }
    : null
  const hip = frame.points.hip.left && frame.points.hip.right
    ? { x: (frame.points.hip.left.x + frame.points.hip.right.x) / 2, y: (frame.points.hip.left.y + frame.points.hip.right.y) / 2 }
    : null
  if (!shoulder || !hip) return null
  const length = Math.hypot(shoulder.x - hip.x, shoulder.y - hip.y)
  return length > 0.01 ? length : null
}

export interface PoseQualityResult {
  summary: PoseQualitySummary
  /** 与 frames 一一对应；0–1 */
  reliability: number[]
  /** 逐帧的骨长偏离程度（0 正常，≥1 明显异常），用于调试/展示 */
  boneDeviation: number[][]
}

/**
 * 计算整段姿态质量。
 * 两遍扫描：第一遍求尺度基准与各关节典型位移，第二遍给逐帧可靠性。
 */
export function assessPoseQuality(frames: MotionFrame[], fps: number): PoseQualityResult {
  const frameStepMs = 1000 / Math.max(1, fps)
  const torsoLengths = frames.map(torsoLengthOf)
  const torsoMedian = median(torsoLengths.filter((value): value is number => value !== null)) ?? 1
  const scale = torsoMedian > 0.01 ? torsoMedian : 1

  // 骨长（按躯干尺度归一化，消除人物远近造成的整体缩放）
  const rawBones: (number | null)[][] = frames.map(frame =>
    BONE_SPECS.map(([, read]) => {
      const [from, to] = read(frame)
      const value = distance(from, to)
      return value === null ? null : value / scale
    })
  )
  const boneMedians: number[] = BONE_SPECS.map((_, boneIndex) =>
    median(rawBones.map(row => row[boneIndex]).filter((value): value is number => value !== null)) ?? 0)

  // 典型位移：每个关节/侧自身中位位移，作为瞬跳判定的基准
  const jumpKeys: { joint: typeof JUMP_JOINTS[number]; side: 'left' | 'right' }[] = []
  for (const joint of JUMP_JOINTS) for (const side of ['left', 'right'] as const) jumpKeys.push({ joint, side })
  const stepsByKey: number[][] = jumpKeys.map(() => [])
  for (let index = 1; index < frames.length; index++) {
    const previous = frames[index - 1]
    const current = frames[index]
    const dt = Math.max(1, current.timeMs - previous.timeMs)
    if (dt > Math.max(frameStepMs * 3, 120)) continue
    jumpKeys.forEach((key, keyIndex) => {
      const before = (previous.points as unknown as Record<string, { left: MotionPoint | null; right: MotionPoint | null } | undefined>)[key.joint]?.[key.side] ?? null
      const after = (current.points as unknown as Record<string, { left: MotionPoint | null; right: MotionPoint | null } | undefined>)[key.joint]?.[key.side] ?? null
      const step = distance(before, after)
      if (step !== null) stepsByKey[keyIndex].push(step / scale)
    })
  }
  const typicalSteps = stepsByKey.map(values => {
    const p = percentile(values.filter(value => value > 1e-4), 0.6)
    return p === null || p < 1e-3 ? 0.02 : p // 几乎没有位移时给一个很小的下限，避免把噪声当稳定
  })

  const reliability: number[] = []
  const boneDeviation: number[][] = []
  let sideSwaps = 0

  for (let index = 0; index < frames.length; index++) {
    const frame = frames[index]
    const joints = frame.points

    // 1) 骨长偏离
    const deviations = BONE_SPECS.map((_, boneIndex) => {
      const value = rawBones[index][boneIndex]
      const base = boneMedians[boneIndex]
      if (value === null || base <= 1e-6) return 0
      const relative = Math.abs(value - base) / base
      return clamp01((relative - POSE_QUALITY_CONFIG.boneDeviationGrace) / POSE_QUALITY_CONFIG.boneDeviationLimit)
    })
    boneDeviation.push(deviations)

    // 2) 瞬跳：该关节本帧位移相对自身典型位移的倍数
    let worstJump = 1
    if (index > 0) {
      const previous = frames[index - 1]
      const dt = Math.max(1, frame.timeMs - previous.timeMs)
      if (dt <= Math.max(frameStepMs * 3, 120)) {
        jumpKeys.forEach((key, keyIndex) => {
          const before = (previous.points as unknown as Record<string, { left: MotionPoint | null; right: MotionPoint | null } | undefined>)[key.joint]?.[key.side] ?? null
          const after = (joints as unknown as Record<string, { left: MotionPoint | null; right: MotionPoint | null } | undefined>)[key.joint]?.[key.side] ?? null
          const step = distance(before, after)
          if (step === null) return
          const ratio = (step / scale) / Math.max(typicalSteps[keyIndex], 1e-4)
          worstJump = Math.max(worstJump, ratio)
        })
      }
    }
    const jumpScore = worstJump <= POSE_QUALITY_CONFIG.jumpRatioLimit
      ? 1
      : clamp01(1 - (worstJump - POSE_QUALITY_CONFIG.jumpRatioLimit) / 4)

    // 3) 左右交换嫌疑：左右肩与左右髋的 x 顺序同时反向
    const shoulderGap = (joints.shoulder.left && joints.shoulder.right)
      ? joints.shoulder.left.x - joints.shoulder.right.x : null
    const hipGap = (joints.hip.left && joints.hip.right)
      ? joints.hip.left.x - joints.hip.right.x : null
    let swap = false
    if (shoulderGap !== null && hipGap !== null) {
      swap = Math.sign(shoulderGap) !== Math.sign(hipGap)
        && Math.abs(shoulderGap) > 0.01 && Math.abs(hipGap) > 0.01
    }
    if (swap) sideSwaps++

    // 4) 帧级可靠性：可见度为主，骨长/跳变只做扣分，不把正常透视当故障
    const visibility = Number.isFinite(frame.visibility) ? frame.visibility : 0
    const visScore = clamp01((visibility - 0.3) / 0.5)
    const boneScore = 1 - Math.max(...deviations, 0)
    const reliabilityValue = visScore
      * (0.4 + 0.6 * boneScore)
      * (0.35 + 0.65 * jumpScore)
      * (swap ? 0.7 : 1)
    reliability.push(Math.round(clamp01(reliabilityValue) * 1e4) / 1e4)
  }

  // 5) 缺口：时间戳断裂
  const gaps: { startMs: number; endMs: number }[] = []
  const maxGapMs = Math.max(POSE_QUALITY_CONFIG.gapFloorMs, frameStepMs * 3)
  for (let index = 1; index < frames.length; index++) {
    if (frames[index].timeMs - frames[index - 1].timeMs > maxGapMs) {
      gaps.push({ startMs: frames[index - 1].timeMs, endMs: frames[index].timeMs })
    }
  }

  const usableFrames = frames.filter(frame => frame.visibility >= POSE_QUALITY_CONFIG.usableVisibility).length
  const reliableFrames = reliability.filter(value => value >= POSE_QUALITY_CONFIG.reliableThreshold).length
  const meanReliability = reliability.length
    ? reliability.reduce((sum, value) => sum + value, 0) / reliability.length : 0
  const boneStability: Record<string, number> = {}
  for (const [name] of BONE_SPECS) {
    const values = rawBones.map(row => row[BONE_SPECS.findIndex(([boneName]) => boneName === name)])
      .filter((value): value is number => value !== null)
    boneStability[name] = Math.round(coefficientOfVariation(values) * 1000) / 1000
  }
  const problems: string[] = []
  const usableRatio = frames.length ? usableFrames / frames.length : 0
  if (usableRatio < 0.4) problems.push(`关键点可见度偏低（可用帧 ${Math.round(usableRatio * 100)}%）`)
  if (reliableFrames / Math.max(1, frames.length) < 0.5) problems.push('骨长/跳变异常帧过多，测量可靠性低')
  if (sideSwaps > frames.length * 0.1) problems.push('左右关键点疑似多次交换，左右侧指标不可用')
  if (gaps.length) problems.push(`存在 ${gaps.length} 处推理缺口`)

  return {
    summary: {
      frameCount: frames.length,
      usableFrames,
      usableRatio,
      reliableFrames,
      meanReliability: Math.round(meanReliability * 1000) / 1000,
      gaps,
      gapMs: Math.round(maxGapMs),
      boneStability,
      sideSwaps,
      problems
    },
    reliability,
    boneDeviation
  }
}