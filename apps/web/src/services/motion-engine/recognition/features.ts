// 动作识别的共享特征：不依赖动作名，只描述"身体怎么动的"。
// 与 M1 的 MotionFeatureSeries 相比，这层刻意保留左右分侧角度与稳健分位数，
// 因为区分深蹲/硬拉/起坐/弯举靠的是"关节如何协同"，不是单个极值。
//
// 纯函数：输入 MotionFrame[]，输出可解释特征；不碰 DOM、不依赖 Vue。
// 注意：这里的角度沿用 2D 归一化坐标（与 V1 规则同一口径），透视形变的影响
// 留给 M5/M6 的不确定带处理；本层只做相对比较，不宣称绝对角度真值。

import type { MotionFrame, MotionPoint } from '@/services/motionAnalysis'
import { angleAtExact, trunkAngleAt } from '@/composables/poseMath'
import { pearson } from '@/services/motion-engine/temporal/correlation'
import { findPeaks } from '@/services/motion-engine/temporal/peaks'
import { estimateGaitEvents } from '@/services/motion-engine/temporal/gait'

export interface GaitEvidence {
  footStrikes: number
  cycles: number
  cadence: number | null
  contactTimeMs: number | null
}

export interface RecognitionFeatures {
  fps: number
  durationSec: number
  durationMs: number
  frameCount: number
  usableRatio: number
  /** 左右膝关节角序列的相关系数；接近 1 = 双腿同步（力量动作），接近 0/负 = 交替（步态） */
  kneeSync: number | null
  hipSync: number | null
  /** 关节活动幅度（p95-p5，度） */
  kneeRange: number | null
  hipRange: number | null
  elbowRange: number | null
  /** 髋部相对踝的归一化高度变化（躯干长） */
  hipDrop: number | null
  /** 底部/顶部关节角（稳健分位数） */
  kneeBottom: number | null
  kneeTop: number | null
  hipBottom: number | null
  hipTop: number | null
  elbowBottom: number | null
  elbowTop: number | null
  /** 底部帧上的躯干前倾中位数（度） */
  trunkBottom: number | null
  trunkMean: number | null
  /** 髋-膝活动度比：硬拉以髋铰链为主时显著大于 1 */
  hipKneeRomRatio: number | null
  /** 手腕相对膝的高度（正值 = 腕在膝下方）最大值与底部中位数；硬拉底部手在膝/胫骨附近 */
  wristBelowKneeMax: number | null
  wristBelowKneeBottom: number | null
  /** 分析窗口首尾姿态 */
  startKnee: number | null
  endKnee: number | null
  startHipHeight: number | null
  endHipHeight: number | null
  /** 底部低角度平台的最长持续时间（毫秒）：坐下/底部停顿 */
  bottomPlateauMs: number
  /** 自适应峰谷得到的动作周期数（膝最小/髋最大） */
  cycleCount: number
  /** 结束姿态是否像"坐着/低位停留"：末段膝角不高且髋高明显低于起始 */
  seatedEnd: boolean
  /** 是否只完成单向行程（下放未起身，或从底部起身未下放） */
  oneWayTrip: boolean
  /** 踝部相对髋的抬升幅度（左右平均，躯干长），步态/高抬腿会偏高 */
  ankleLiftAmp: number | null
  gait: GaitEvidence
  /** 兼容旧摘要字段：全程最小膝角 / 最大躯干前倾 */
  minKneeAngle: number | null
  maxTrunkLean: number | null
  meanTrunkAngle: number | null
}

type Side = 'left' | 'right'

function finite(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function sideAngle(frame: MotionFrame, joint: 'knee' | 'hip' | 'elbow', side: Side): number | null {
  const { shoulder, elbow, wrist, hip, knee, ankle } = frame.points
  if (joint === 'knee') return hip[side] && knee[side] && ankle[side]
    ? angleAtExact(hip[side] as MotionPoint, knee[side] as MotionPoint, ankle[side] as MotionPoint) : null
  if (joint === 'hip') return shoulder[side] && hip[side] && knee[side]
    ? angleAtExact(shoulder[side] as MotionPoint, hip[side] as MotionPoint, knee[side] as MotionPoint) : null
  return shoulder[side] && elbow?.[side] && wrist?.[side]
    ? angleAtExact(shoulder[side] as MotionPoint, elbow[side] as MotionPoint, wrist[side] as MotionPoint) : null
}

function midpointY(a: MotionPoint | null, b: MotionPoint | null): number | null {
  if (!a || !b || !finite(a.y) || !finite(b.y)) return null
  return (a.y + b.y) / 2
}

function percentile(values: number[], p: number): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]
}

function median(values: number[]): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
}

function rangeOf(values: number[]): number | null {
  const lo = percentile(values, 0.05)
  const hi = percentile(values, 0.95)
  return lo === null || hi === null ? null : Math.round((hi - lo) * 10) / 10
}

const round1 = (value: number | null) => value === null ? null : Math.round(value * 10) / 10

/**
 * 从帧序列提取识别特征。
 * 分位数（p05/p95）而不是 min/max：个别帧的关键点跳变不该决定动作类别。
 */
export function extractRecognitionFeatures(frames: MotionFrame[], fps: number): RecognitionFeatures {
  const usable = frames.filter(frame => frame.visibility >= 0.5)
  const durationMs = frames.length > 1 ? frames[frames.length - 1].timeMs - frames[0].timeMs : 0
  const kneePrimary: number[] = []
  const hipPrimary: number[] = []
  const elbowPrimary: number[] = []
  const trunk: number[] = []
  const hipHeight: number[] = []
  const wristBelow: number[] = []
  const hipHeightsWithTime: { timeMs: number; value: number }[] = []
  const kneeWithTime: { timeMs: number; value: number }[] = []
  const kneeLeft: (number | null)[] = []
  const kneeRight: (number | null)[] = []

  for (const frame of usable) {
    const kneeL = sideAngle(frame, 'knee', 'left')
    const kneeR = sideAngle(frame, 'knee', 'right')
    kneeLeft.push(kneeL)
    kneeRight.push(kneeR)
    // 主信号取两侧平均（都有效时），避免单侧遮挡把幅度砍半
    const knee = kneeL !== null && kneeR !== null ? (kneeL + kneeR) / 2 : kneeL ?? kneeR
    const hipL = sideAngle(frame, 'hip', 'left')
    const hipR = sideAngle(frame, 'hip', 'right')
    const hip = hipL !== null && hipR !== null ? (hipL + hipR) / 2 : hipL ?? hipR
    const elbowL = sideAngle(frame, 'elbow', 'left')
    const elbowR = sideAngle(frame, 'elbow', 'right')
    const elbow = elbowL !== null && elbowR !== null ? (elbowL + elbowR) / 2 : elbowL ?? elbowR
    const shoulderMidY = midpointY(frame.points.shoulder.left, frame.points.shoulder.right)
    const hipMidY = midpointY(frame.points.hip.left, frame.points.hip.right)
    const ankleMidY = midpointY(frame.points.ankle.left, frame.points.ankle.right)
    const kneeMidY = midpointY(frame.points.knee.left, frame.points.knee.right)
    const wristMidY = midpointY(frame.points.wrist?.left ?? null, frame.points.wrist?.right ?? null)
    const torso = shoulderMidY !== null && hipMidY !== null ? Math.abs(hipMidY - shoulderMidY) : null
    const shoulder = frame.points.shoulder.left
    const hipPoint = frame.points.hip.left
    const trunkAngle = trunkAngleAt(shoulder, hipPoint)

    if (knee !== null) {
      kneePrimary.push(knee)
      kneeWithTime.push({ timeMs: frame.timeMs, value: knee })
    }
    if (hip !== null) hipPrimary.push(hip)
    if (elbow !== null) elbowPrimary.push(elbow)
    if (trunkAngle !== null) trunk.push(trunkAngle)
    if (torso !== null && torso > 0.02 && ankleMidY !== null && hipMidY !== null) {
      const value = (ankleMidY - hipMidY) / torso
      hipHeight.push(value)
      hipHeightsWithTime.push({ timeMs: frame.timeMs, value })
    }
    if (torso !== null && torso > 0.02 && wristMidY !== null && kneeMidY !== null) {
      wristBelow.push((wristMidY - kneeMidY) / torso)
    }
  }

  const kneeRange = rangeOf(kneePrimary)
  const hipRange = rangeOf(hipPrimary)
  const kneeBottom = percentile(kneePrimary, 0.05)
  const kneeTop = percentile(kneePrimary, 0.95)
  const hipBottom = percentile(hipPrimary, 0.05)
  const hipTop = percentile(hipPrimary, 0.95)
  const bottomBand = kneeBottom === null ? null : kneeBottom + 12
  const wristAtBottom = bottomBand === null ? [] : usable.flatMap(frame => {
    const kneeL = sideAngle(frame, 'knee', 'left')
    const kneeR = sideAngle(frame, 'knee', 'right')
    const knee = kneeL !== null && kneeR !== null ? (kneeL + kneeR) / 2 : kneeL ?? kneeR
    if (knee === null || knee > bottomBand) return []
    const kneeMid = midpointY(frame.points.knee.left, frame.points.knee.right)
    const wristMid = midpointY(frame.points.wrist?.left ?? null, frame.points.wrist?.right ?? null)
    const shoulderMid = midpointY(frame.points.shoulder.left, frame.points.shoulder.right)
    const hipMid = midpointY(frame.points.hip.left, frame.points.hip.right)
    if (kneeMid === null || wristMid === null || shoulderMid === null || hipMid === null) return []
    const torso = Math.abs(hipMid - shoulderMid)
    return torso > 0.02 ? [(wristMid - kneeMid) / torso] : []
  })
  const trunkAtBottom = bottomBand === null ? [] : usable.flatMap(frame => {
    const kneeL = sideAngle(frame, 'knee', 'left')
    const kneeR = sideAngle(frame, 'knee', 'right')
    const knee = kneeL !== null && kneeR !== null ? (kneeL + kneeR) / 2 : kneeL ?? kneeR
    if (knee === null || knee > bottomBand) return []
    const value = trunkAngleAt(frame.points.shoulder.left, frame.points.hip.left)
    return value === null ? [] : [value]
  })

  // 底部平台：膝角在最低 12° 带内连续停留的最长时间
  let bottomPlateauMs = 0
  let runStart: number | null = null
  if (bottomBand !== null) {
    for (const sample of kneeWithTime) {
      const inBand = sample.value <= bottomBand
      if (inBand && runStart === null) runStart = sample.timeMs
      if (!inBand && runStart !== null) {
        bottomPlateauMs = Math.max(bottomPlateauMs, sample.timeMs - runStart)
        runStart = null
      }
    }
    if (runStart !== null && kneeWithTime.length) {
      bottomPlateauMs = Math.max(bottomPlateauMs, kneeWithTime[kneeWithTime.length - 1].timeMs - runStart)
    }
  }

  // 动作周期数：膝角谷 + 髋角峰，取更大者；显著度按本次幅度自适应
  const times = kneeWithTime.map(sample => sample.timeMs)
  const kneeValleys = findPeaks(kneePrimary, times, {
    direction: 'min',
    minProminence: Math.max(12, 0.2 * (kneeRange ?? 0)),
    minDistanceMs: 500
  })
  const hipPts = hipHeightsWithTime.map((sample, index) => ({ timeMs: sample.timeMs, value: hipPrimary[index] ?? null }))
  const hipPeaks = findPeaks(hipPts.map(point => point.value), hipPts.map(point => point.timeMs), {
    direction: 'max',
    minProminence: Math.max(10, 0.2 * (hipRange ?? 0)),
    minDistanceMs: 500
  })
  const cycleCount = Math.max(kneeValleys.length, hipPeaks.length)

  const startCount = Math.max(3, Math.floor(usable.length * 0.08))
  const startKnee = mean(usable.slice(0, startCount).flatMap(frame => {
    const value = sideAngle(frame, 'knee', 'left') ?? sideAngle(frame, 'knee', 'right')
    return value === null ? [] : [value]
  }))
  const endKnee = mean(usable.slice(-startCount).flatMap(frame => {
    const value = sideAngle(frame, 'knee', 'left') ?? sideAngle(frame, 'knee', 'right')
    return value === null ? [] : [value]
  }))
  const startHipHeight = mean(hipHeightsWithTime.slice(0, startCount).map(sample => sample.value))
  const endHipHeight = mean(hipHeightsWithTime.slice(-startCount).map(sample => sample.value))
  // 末段坐着：2D 投影下"坐着"的膝角可能只有 130–140°（斜侧/背向时大腿被压缩），
// 不能按 90° 的教科书值卡；同时要求髋高明显低于开始，避免把站立收尾当成坐着。
  const seatedEnd = endKnee !== null && endKnee < 140
    && startHipHeight !== null && endHipHeight !== null
    && endHipHeight <= startHipHeight - 0.25
  // 单向行程：首尾必须出现"姿势层级"的变化（不只是首尾几帧的噪声差），
  // 例如从站直坐到低位、或从底部开始没有再下放。要求髋高也随方向一起变。
  const oneWayTrip = startKnee !== null && endKnee !== null
    && Math.abs(startKnee - endKnee) > 25
    && startHipHeight !== null && endHipHeight !== null
    && (endKnee < startKnee
      ? endHipHeight <= startHipHeight - 0.25
      : endHipHeight >= startHipHeight + 0.25)

  // 步态证据：左右踝各自相对髋的抬升周期；交替性好才可能判步态
  const ankleLiftLeft: (number | null)[] = []
  const ankleLiftRight: (number | null)[] = []
  for (const frame of usable) {
    const shoulderMid = midpointY(frame.points.shoulder.left, frame.points.shoulder.right)
    const hipMid = midpointY(frame.points.hip.left, frame.points.hip.right)
    const torso = shoulderMid !== null && hipMid !== null ? Math.abs(hipMid - shoulderMid) : null
    const read = (point: MotionPoint | null) => torso !== null && torso > 0.02 && finite(point?.y)
      ? (hipMid! - point!.y) / torso : null
    ankleLiftLeft.push(read(frame.points.ankle.left))
    ankleLiftRight.push(read(frame.points.ankle.right))
  }
  const liftAmpOf = (values: (number | null)[]) => {
    const valid = values.filter((value): value is number => value !== null)
    const lo = percentile(valid, 0.1)
    const hi = percentile(valid, 0.9)
    return lo === null || hi === null ? null : hi - lo
  }
  const liftAmps = [liftAmpOf(ankleLiftLeft), liftAmpOf(ankleLiftRight)].filter((value): value is number => value !== null)
  const ankleLiftAmp = liftAmps.length ? liftAmps.reduce((sum, value) => sum + value, 0) / liftAmps.length : null

  // 步态证据与 analyzeGait 共用同一套事件估计（归一化踝抬升 + 步幅自相关），
// 不再各写一份原始踝 y 极小值检测——两份口径会在真实素材上给出不同步频。
  const gaitEstimate = estimateGaitEvents(frames, fps)
  const gaitCycles = gaitEstimate.cycles
  const cadence = gaitEstimate.cadence
  const strikeCount = gaitEstimate.strikes.length

  const trunkLeanSeries = trunk
  return {
    fps,
    durationSec: durationMs / 1000,
    durationMs,
    frameCount: frames.length,
    usableRatio: frames.length ? usable.length / frames.length : 0,
    kneeSync: pearson(kneeLeft, kneeRight),
    hipSync: pearson(
      usable.map(frame => sideAngle(frame, 'hip', 'left')),
      usable.map(frame => sideAngle(frame, 'hip', 'right'))
    ),
    kneeRange,
    hipRange,
    elbowRange: rangeOf(elbowPrimary),
    hipDrop: rangeOf(hipHeightsWithTime.map(sample => sample.value)),
    kneeBottom: round1(kneeBottom),
    kneeTop: round1(kneeTop),
    hipBottom: round1(hipBottom),
    hipTop: round1(hipTop),
    elbowBottom: round1(percentile(elbowPrimary, 0.05)),
    elbowTop: round1(percentile(elbowPrimary, 0.95)),
    trunkBottom: round1(median(trunkAtBottom)),
    trunkMean: round1(mean(trunkLeanSeries)),
    hipKneeRomRatio: kneeRange !== null && kneeRange > 1 && hipRange !== null
      ? Math.round((hipRange / kneeRange) * 100) / 100 : null,
    wristBelowKneeMax: wristBelow.length ? Math.round(Math.max(...wristBelow) * 100) / 100 : null,
    wristBelowKneeBottom: round1(median(wristAtBottom)),
    startKnee: round1(startKnee),
    endKnee: round1(endKnee),
    startHipHeight: round1(startHipHeight),
    endHipHeight: round1(endHipHeight),
    bottomPlateauMs: Math.round(bottomPlateauMs),
    cycleCount,
    seatedEnd,
    oneWayTrip,
    ankleLiftAmp: ankleLiftAmp === null ? null : Math.round(ankleLiftAmp * 100) / 100,
    gait: {
      footStrikes: strikeCount,
      cycles: gaitCycles,
      cadence,
      contactTimeMs: null
    },
    minKneeAngle: kneeBottom,
    maxTrunkLean: trunkLeanSeries.length ? Math.round(Math.max(...trunkLeanSeries)) : null,
    meanTrunkAngle: round1(mean(trunkLeanSeries))
  }
}

/** 便捷判断：是否有足够的周期/行程证据支撑"识别到了动作" */
export function hasMovements(features: RecognitionFeatures): boolean {
  return features.cycleCount >= 1
    || features.oneWayTrip
    || features.seatedEnd
    || features.gait.cycles >= 1
    || (features.kneeRange ?? 0) >= 30
    || (features.hipRange ?? 0) >= 30
    || (features.elbowRange ?? 0) >= 45
}