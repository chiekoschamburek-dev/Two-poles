// 类内软打分 + 未知拒识：不定"最近的动作"，只在证据够强时才给 confident。
//
// 关键区分特征（都来自可解释的运动结构，而不是单个极值阈值）：
// - 深蹲 vs 硬拉：手腕相对膝的垂直位置（硬拉底部手在膝/胫骨附近）、髋/膝活动度比、
//   底部膝角与躯干前倾；
// - 深蹲 vs 椅子起坐：起始站姿 + 末段坐姿（或单向下降未起身）+ 底部平台；
// - 弯举：肘角主导、膝/髋几乎不动；
// - 跑步 vs 步行：步态大类内用步频/触地手感做连续打分（步频仍然不是大类硬门槛）。

import { extractRecognitionFeatures, type RecognitionFeatures } from './features'
import { decideFamily, type MotionFamily } from './family'

export interface ActionCandidate {
  action: string
  family: MotionFamily
  score: number
  /** 与第二名分差；只有一个候选时按 1-score 归一 */
  margin: number | null
}

export interface RecognitionResult {
  action: string
  family: MotionFamily
  confident: boolean
  candidates: ActionCandidate[]
  features: RecognitionFeatures
  signals: {
    minKneeAngle: number | null
    maxTrunkLean: number | null
    gaitFootStrikes: number
    gaitCadence: number | null
    kneeRange: number | null
    elbowRange: number | null
    meanTrunkAngle: number | null
    hipVerticalRange: number | null
    family: MotionFamily
    familyScores: Record<MotionFamily, number>
    margin: number | null
    confident: boolean
  }
  reasons: string[]
}

export const ACTION_CONFIDENCE = {
  /** 最高分低于该值不当作"已识别" */
  minScore: 0.72,
  /** 与第二名分差低于该值不当作"已识别"：避免深蹲/硬拉五五开时硬猜 */
  minMargin: 0.2,
  /** 步态要至少 5 个周期才标 confident（与预检的"至少 5 个周期"一致） */
  gaitMinCycles: 5,
  /** 跑步/步行的分界：步频是连续特征，不是大类门槛 */
  runCadenceMid: 112,
  runCadenceSpan: 18
} as const

const clamp01 = (value: number) => Math.max(0, Math.min(1, value))
const round2 = (value: number) => Math.round(value * 100) / 100

/** 力量类候选打分；证据越强分越高，单项证据不直接一票否决其他动作 */
function scoreStrength(features: RecognitionFeatures): ActionCandidate[] {
  const evidence = {
    wristBelowKneeMax: features.wristBelowKneeMax,
    hipKneeRomRatio: features.hipKneeRomRatio,
    kneeBottom: features.kneeBottom,
    trunkBottom: features.trunkBottom,
    hipDrop: features.hipDrop,
    kneeRange: features.kneeRange,
    elbowRange: features.elbowRange,
    kneeSync: features.kneeSync,
    seatedEnd: features.seatedEnd,
    startKnee: features.startKnee,
    endKnee: features.endKnee,
    bottomPlateauMs: features.bottomPlateauMs,
    cycleCount: features.cycleCount
  }

  // 深蹲：膝主导屈伸、手腕始终在膝上方、髋膝同步、有完整行程
  let squat = 0
  squat += (features.kneeRange ?? 0) >= 45 ? 0.35 : (features.kneeRange ?? 0) >= 30 ? 0.25 : 0
  squat += (features.kneeBottom ?? 999) <= 140 ? 0.25 : 0
  squat += (features.wristBelowKneeMax === null || features.wristBelowKneeMax < 0.05) ? 0.2 : 0
  squat += (features.hipKneeRomRatio === null || features.hipKneeRomRatio <= 1.2) ? 0.1 : 0
  squat += (features.hipDrop ?? 0) >= 0.3 ? 0.1 : 0
  squat += (features.kneeSync ?? 0) >= 0.5 ? 0.1 : 0
  // 手到膝下（硬拉特征）或末段坐着/没有回到起始位（起坐特征）都不像深蹲
  if ((features.wristBelowKneeMax ?? -1) > 0.15) squat -= 0.25
  if (features.seatedEnd || (features.startKnee !== null && features.endKnee !== null
    && features.endKnee < features.startKnee - 20)) squat -= 0.3

  // 硬拉：髋铰链为主（髋 ROM 明显大于膝）、手在膝附近/下方、底部膝相对直
  let deadlift = 0
  const hingeLike = (features.hipKneeRomRatio ?? 0) >= 1.1
    || (features.kneeBottom ?? 0) >= 125
    || (features.trunkBottom ?? 0) >= 50
  // 手到膝下方只有在髋铰链/直腿/大前倾同时成立时才是强证据；
  // 否则可能是弯举/走路时手腕投影落到膝下，不能单独把动作判成硬拉
  if ((features.wristBelowKneeMax ?? -1) >= 0.12) deadlift += hingeLike ? 0.5 : 0.15
  else if ((features.wristBelowKneeMax ?? -1) >= 0.05) deadlift += 0.2
  deadlift += (features.hipKneeRomRatio ?? 0) >= 1.6 ? 0.3 : (features.hipKneeRomRatio ?? 0) >= 1.1 ? 0.2 : 0
  deadlift += (features.kneeBottom ?? 0) >= 130 ? 0.15 : 0
  deadlift += (features.trunkBottom ?? 0) >= 35 ? 0.2 : 0
  deadlift += (features.hipDrop ?? 0) >= 0.8 ? 0.1 : 0

  // 椅子起坐：从站立开始、末段坐到低位、或单向下降未起身；底部常有平台
  let sitToStand = 0
  sitToStand += features.seatedEnd ? 0.6 : 0
  sitToStand += (features.startKnee ?? 0) >= 150 ? 0.15 : 0
  sitToStand += features.oneWayTrip ? 0.2 : 0
  sitToStand += features.bottomPlateauMs >= 600 ? 0.05 : 0
  sitToStand += (features.hipDrop ?? 0) >= 0.5 ? 0.1 : 0

  // 弯举：肘角主导往返，膝/髋/髋高基本不动
  let curl = 0
  curl += (features.elbowRange ?? 0) >= 90 ? 0.45 : (features.elbowRange ?? 0) >= 60 ? 0.35 : 0
  curl += (features.elbowBottom ?? 999) <= 100 ? 0.2 : 0
  curl += (features.kneeRange ?? 99) <= 30 ? 0.2 : 0
  curl += (features.hipDrop ?? 99) <= 0.3 ? 0.15 : 0
  curl += (features.wristBelowKneeMax ?? -1) <= 0 ? 0.05 : 0
  // 肘主导：肘角幅度明显大于下肢活动时，即使膝髋有噪声也保留弯举候选
  if ((features.elbowRange ?? 0) >= 60
    && (features.elbowRange ?? 0) >= 0.5 * ((features.kneeRange ?? 0) + (features.hipRange ?? 0))) curl += 0.15
  // 下肢明显在动就不是严格弯举：只保留候选分，不硬判
  if ((features.kneeRange ?? 0) >= 40 || (features.hipRange ?? 0) >= 40) curl -= 0.2

  return [
    { action: 'squat', family: 'strength', score: round2(clamp01(squat)), margin: null },
    { action: 'deadlift', family: 'strength', score: round2(clamp01(deadlift)), margin: null },
    { action: 'sit-to-stand', family: 'strength', score: round2(clamp01(sitToStand)), margin: null },
    { action: 'curl', family: 'strength', score: round2(clamp01(curl)), margin: null }
  ].map(candidate => ({ ...candidate, evidence })) as ActionCandidate[]
}

/** 步态大类内：跑步 vs 步行。步频/触地时间是连续特征，不用来做大类硬门槛 */
function scoreLocomotion(features: RecognitionFeatures): ActionCandidate[] {
  const cadence = features.gait.cadence
  const cadence01 = cadence === null
    ? 0.5
    : clamp01((cadence - ACTION_CONFIDENCE.runCadenceMid) / ACTION_CONFIDENCE.runCadenceSpan + 0.5)
  const run = cadence01
  const walk = 1 - cadence01
  return [
    { action: 'running', family: 'locomotion', score: round2(run), margin: null },
    { action: 'walk', family: 'locomotion', score: round2(walk), margin: null }
  ]
}

function attachMargins(candidates: ActionCandidate[]): ActionCandidate[] {
  const sorted = [...candidates].sort((a, b) => b.score - a.score)
  return candidates.map(candidate => {
    const index = sorted.findIndex(item => item.action === candidate.action)
    const next = sorted[index + 1]
    return { ...candidate, margin: next ? round2(candidate.score - next.score) : round2(1 - candidate.score) }
  })
}

/**
 * 识别动作：先分大类，再类内软打分；证据不足时返回 unknown。
 * 输出保留全部候选与分数，便于预检/结果页解释"为什么这么判"。
 */
export function recognizeAction(frames: Parameters<typeof extractRecognitionFeatures>[0], fps: number): RecognitionResult {
  const features = extractRecognitionFeatures(frames, fps)
  const decision = decideFamily(features)
  const reasons = [...decision.reasons]
  let candidates: ActionCandidate[] = []
  let action = 'unknown'
  let confident = false

  if (decision.family === 'locomotion') {
    candidates = attachMargins(scoreLocomotion(features))
    const top = [...candidates].sort((a, b) => b.score - a.score)[0]
    action = top.action
    confident = features.gait.cycles >= ACTION_CONFIDENCE.gaitMinCycles
      && top.score >= ACTION_CONFIDENCE.minScore
      && (top.margin ?? 0) >= ACTION_CONFIDENCE.minMargin
    if (features.gait.cycles < ACTION_CONFIDENCE.gaitMinCycles) {
      reasons.push(`步态周期不足（${features.gait.cycles} 个）`)
    }
  } else if (decision.family === 'strength') {
    candidates = attachMargins(scoreStrength(features))
    const sorted = [...candidates].sort((a, b) => b.score - a.score)
    const top = sorted[0]
    const second = sorted[1]
    action = top.action
    const hasEvent = features.cycleCount >= 1 || features.oneWayTrip || features.seatedEnd
      || (features.kneeRange ?? 0) >= 30 || (features.hipRange ?? 0) >= 30
      || (features.elbowRange ?? 0) >= 45
    confident = hasEvent
      && top.score >= ACTION_CONFIDENCE.minScore
      && (top.margin ?? 0) >= ACTION_CONFIDENCE.minMargin
    if (!hasEvent) reasons.push('没有识别到可验证的完整动作/周期')
    if (top.score < ACTION_CONFIDENCE.minScore) reasons.push(`动作特征不够强（最高分 ${top.score.toFixed(2)}）`)
    else if ((top.margin ?? 0) < ACTION_CONFIDENCE.minMargin) {
      reasons.push(`候选动作分差太小（${top.action} ${top.score.toFixed(2)} vs ${second?.action ?? '—'} ${second?.score.toFixed(2)}），需要确认`)
    }
  } else if (decision.family === 'isometric') {
    candidates = attachMargins([{ action: 'plank', family: 'isometric', score: round2(decision.scores.isometric), margin: null }])
    action = 'plank'
    confident = features.durationSec >= 3 && (features.trunkMean ?? 0) >= 60
  } else {
    action = 'unknown'
    confident = false
    reasons.push('未识别出受支持的动作类型：请手动选择动作')
  }

  const sorted = [...candidates].sort((a, b) => b.score - a.score)
  const top = sorted[0]
  const margin = top?.margin ?? null
  return {
    action,
    family: decision.family,
    confident,
    candidates,
    features,
    signals: {
      minKneeAngle: features.kneeBottom,
      maxTrunkLean: features.maxTrunkLean,
      gaitFootStrikes: features.gait.footStrikes,
      gaitCadence: features.gait.cadence,
      kneeRange: features.kneeRange,
      elbowRange: features.elbowRange,
      meanTrunkAngle: features.meanTrunkAngle,
      hipVerticalRange: features.hipDrop,
      family: decision.family,
      familyScores: decision.scores,
      margin,
      confident
    },
    reasons
  }
}