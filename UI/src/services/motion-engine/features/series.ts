// 共享时序特征层：把逐帧关键点整理成连续的、可归一化的运动表示。
// 目的：动作识别、视角估计、分段计数、专项分析都从同一份特征取数，
// 而不是各自再算一遍膝角/髋高/躯干倾角，导致口径漂移。
//
// 三种表示同时保留（不要互相替代）：
// - 相机坐标系位置（hipMidY 等）：整体下蹲/位移必须保留；
// - 身体中心相对量（关节角、左右差）：与人在画面中的位置无关；
// - 尺度归一化量（除以躯干长）：不同身高、不同机位距离可比。
//
// 纯函数：输入 MotionFrame[]，输出 MotionFeatureSeries；不碰 DOM、不依赖 Vue。

import type { MotionFrame, MotionPoint } from '@/services/motionAnalysis'
import { angleAtExact, trunkAngleAt, jointScore } from '@/composables/poseMath'
import { savitzkyGolay, KINEMATICS_CONFIG } from '@/services/motionKinematics'
import { assessPoseQuality } from '@/services/motion-engine/pose/quality'
import type { MotionFeatureFrame, MotionFeatureSeries } from '@/services/motion-engine/core/types'
import { MOTION_FEATURE_VERSION } from '@/services/motion-engine/core/versions'

type Joint = 'knee' | 'hip' | 'elbow'
type Side = 'left' | 'right'

function finite(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function midpoint(a: MotionPoint | null, b: MotionPoint | null): { x: number; y: number } | null {
  if (!a || !b || !finite(a.x) || !finite(a.y) || !finite(b.x) || !finite(b.y)) return null
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

interface AngleSample {
  angle: number | null
  visibility: number
  side: Side | null
}

/**
 * 选侧口径与 V1 完全一致：用顶点关节自身可见度（膝角看膝、髋角看髋），
 * 可见度对外仍是三点最小值。统一到同一语义，才能保证迁移期新旧引擎数字可对照。
 */
function jointAngleExact(frame: MotionFrame, joint: Joint): AngleSample {
  const read = (side: Side): { angle: number | null; score: number; visibility: number; side: Side } => {
    const shoulder = frame.points.shoulder[side]
    const elbow = frame.points.elbow?.[side] ?? null
    const wrist = frame.points.wrist?.[side] ?? null
    const hip = frame.points.hip[side]
    const knee = frame.points.knee[side]
    const ankle = frame.points.ankle[side]
    const points = joint === 'knee'
      ? (hip && knee && ankle ? [hip, knee, ankle] : null)
      : joint === 'hip'
        ? (shoulder && hip && knee ? [shoulder, hip, knee] : null)
        : (shoulder && elbow && wrist ? [shoulder, elbow, wrist] : null)
    if (!points) return { angle: null, score: 0, visibility: 0, side }
    const angle = angleAtExact(points[0], points[1], points[2])
    return {
      angle,
      score: angle === null ? 0 : jointScore(points[1]),
      visibility: angle === null ? 0 : Math.min(...points.map(point => finite(point.visibility) ? point.visibility : 0)),
      side
    }
  }
  const left = read('left')
  const right = read('right')
  if (left.angle === null && right.angle === null) return { angle: null, visibility: 0, side: null }
  if (left.angle === null) return right
  if (right.angle === null) return left
  const chosen = right.score > left.score ? right : left
  return { angle: chosen.angle, visibility: chosen.visibility, side: chosen.side }
}

/** 派生序列的平滑窗口：沿用运动学引擎配置，保证同一套平滑口径 */
function velocityOptions(fps: number): { windowSec: number; order: 2; minPoints: number; maxGapMs: number } {
  return {
    windowSec: KINEMATICS_CONFIG.windowSec,
    order: 2,
    minPoints: KINEMATICS_CONFIG.minPoints,
    // 15fps 下单帧 66.7ms，允许丢 2 帧；30fps 同理
    maxGapMs: Math.max(KINEMATICS_CONFIG.gapFloorMs, (1000 / Math.max(1, fps)) * KINEMATICS_CONFIG.maxGapFrames)
  }
}

function velocitySeries(frames: MotionFrame[], values: (number | null)[], fps: number): (number | null)[] {
  const samples = frames.map((frame, index) => ({ timeMs: frame.timeMs, value: values[index] }))
  return savitzkyGolay(samples, velocityOptions(fps)).map(sample => sample.velocity)
}

export interface BuildFeatureSeriesOptions {
  /** 保留原始帧引用，便于视角/步态模块直接读坐标；默认不挂 */
  attachFrames?: boolean
}

/**
 * 从逐帧关键点构建共享特征序列。
 * 注意：这里算的是 2D 投影角；正面拍摄时躯干前倾的投影会严重偏大（easy-run 正面 83°），
 * 所以 trunkAngle 只作为连续特征，是否可解释由视角层的 observability 决定。
 */
export function buildMotionFeatureSeries(frames: MotionFrame[], fps: number): MotionFeatureSeries {
  const quality = assessPoseQuality(frames, fps)
  const knee: (number | null)[] = []
  const hip: (number | null)[] = []
  const elbow: (number | null)[] = []
  const trunk: (number | null)[] = []
  const kneeVisibility: number[] = []
  const hipVisibility: number[] = []
  const elbowVisibility: number[] = []
  const torsoLengths: number[] = []

  const frameFeatures: MotionFeatureFrame[] = frames.map((frame, index) => {
    const kneeSample = jointAngleExact(frame, 'knee')
    const hipSample = jointAngleExact(frame, 'hip')
    const elbowSample = jointAngleExact(frame, 'elbow')
    // 躯干侧沿用 V1：以膝角选出的那一侧为准，保证既有规则数值可对照
    const trunkSide: Side = kneeSample.side ?? 'left'
    const trunkSample = trunkAngleAt(frame.points.shoulder[trunkSide], frame.points.hip[trunkSide])
    knee.push(kneeSample.angle)
    hip.push(hipSample.angle)
    elbow.push(elbowSample.angle)
    trunk.push(trunkSample)
    kneeVisibility.push(kneeSample.visibility)
    hipVisibility.push(hipSample.visibility)
    elbowVisibility.push(elbowSample.visibility)

    const hipMid = midpoint(frame.points.hip.left, frame.points.hip.right)
    const shoulderMid = midpoint(frame.points.shoulder.left, frame.points.shoulder.right)
    const ankleMid = midpoint(frame.points.ankle.left, frame.points.ankle.right)
    const kneeMid = midpoint(frame.points.knee.left, frame.points.knee.right)
    const wristMid = midpoint(frame.points.wrist?.left ?? null, frame.points.wrist?.right ?? null)
    const torsoLength = hipMid && shoulderMid ? Math.hypot(hipMid.x - shoulderMid.x, hipMid.y - shoulderMid.y) : null
    if (torsoLength !== null && torsoLength > 0.02) torsoLengths.push(torsoLength)
    const scale = torsoLength !== null && torsoLength > 0.02 ? torsoLength : null
    const reliability = quality.reliability[index] ?? 0

    return {
      timeMs: frame.timeMs,
      visibility: finite(frame.visibility) ? frame.visibility : 0,
      kneeAngle: kneeSample.angle,
      hipAngle: hipSample.angle,
      elbowAngle: elbowSample.angle,
      trunkAngle: trunkSample,
      kneeVisibility: kneeSample.visibility,
      hipVisibility: hipSample.visibility,
      elbowVisibility: elbowSample.visibility,
      hipMidY: hipMid?.y ?? null,
      shoulderMidY: shoulderMid?.y ?? null,
      ankleMidY: ankleMid?.y ?? null,
      kneeMidY: kneeMid?.y ?? null,
      wristMidY: wristMid?.y ?? null,
      ankleYLeft: finite(frame.points.ankle.left?.y) ? frame.points.ankle.left!.y : null,
      ankleYRight: finite(frame.points.ankle.right?.y) ? frame.points.ankle.right!.y : null,
      torsoLength,
      hipHeightNorm: hipMid && ankleMid && scale ? (ankleMid.y - hipMid.y) / scale : null,
      wristBelowKnee: wristMid && kneeMid && scale ? (wristMid.y - kneeMid.y) / scale : null,
      kneeForwardNorm: kneeMid && hipMid && scale ? (kneeMid.x - hipMid.x) / scale : null,
      kneeVelocity: null,
      hipVelocity: null,
      elbowVelocity: null,
      reliability,
      jointReliable: {
        knee: kneeSample.angle !== null && reliability >= 0.3,
        hip: hipSample.angle !== null && reliability >= 0.3,
        elbow: elbowSample.angle !== null && reliability >= 0.3,
        trunk: trunkSample !== null && reliability >= 0.3
      }
    }
  })

  // 速度序列放在逐帧特征之后统一求导：Savitzky–Golay 需要整段上下文
  const kneeVel = velocitySeries(frames, knee, fps)
  const hipVel = velocitySeries(frames, hip, fps)
  const elbowVel = velocitySeries(frames, elbow, fps)
  for (let index = 0; index < frameFeatures.length; index++) {
    frameFeatures[index].kneeVelocity = kneeVel[index] ?? null
    frameFeatures[index].hipVelocity = hipVel[index] ?? null
    frameFeatures[index].elbowVelocity = elbowVel[index] ?? null
  }

  const sortedTorso = [...torsoLengths].sort((a, b) => a - b)
  const torsoMedian = sortedTorso.length
    ? (sortedTorso.length % 2 ? sortedTorso[Math.floor(sortedTorso.length / 2)] : (sortedTorso[sortedTorso.length / 2 - 1] + sortedTorso[sortedTorso.length / 2]) / 2)
    : null
  const durationSec = frames.length > 1 ? Math.max(0, (frames[frames.length - 1].timeMs - frames[0].timeMs) / 1000) : 0

  return {
    version: MOTION_FEATURE_VERSION,
    fps,
    durationSec,
    frames: frameFeatures,
    quality: quality.summary,
    scale: { torsoLengthMedian: torsoMedian === null ? null : Math.round(torsoMedian * 1e4) / 1e4 }
  }
}

/** 取一段特征序列的子区间；时间戳边界都包含 */
export function sliceFeatureSeries(series: MotionFeatureSeries, startMs: number, endMs: number): MotionFeatureSeries {
  const frames = series.frames.filter(frame => frame.timeMs >= startMs - 1e-6 && frame.timeMs <= endMs + 1e-6)
  const durationSec = frames.length > 1 ? Math.max(0, (frames[frames.length - 1].timeMs - frames[0].timeMs) / 1000) : 0
  const usableFrames = frames.filter(frame => frame.visibility >= 0.5).length
  return {
    ...series,
    durationSec,
    frames,
    quality: {
      ...series.quality,
      frameCount: frames.length,
      usableFrames,
      usableRatio: frames.length ? usableFrames / frames.length : 0
    }
  }
}

/** 便捷读取：角度序列（缺测为 null） */
export function angleSequence(series: MotionFeatureSeries, joint: 'knee' | 'hip' | 'elbow' | 'trunk'): (number | null)[] {
  return series.frames.map(frame => {
    if (joint === 'knee') return frame.kneeAngle
    if (joint === 'hip') return frame.hipAngle
    if (joint === 'elbow') return frame.elbowAngle
    return frame.trunkAngle
  })
}

/** 便捷读取：时间戳序列 */
export function timeSequence(series: MotionFeatureSeries): number[] {
  return series.frames.map(frame => frame.timeMs)
}