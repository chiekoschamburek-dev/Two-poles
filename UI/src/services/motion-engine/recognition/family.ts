// 一级运动大类：先分物理模态，再类内细分。
// 这里刻意不再用"步频 ≥140""膝角 ≤100"这类绝对硬门槛做跨类裁决：
// 分类错误一旦发生在第一级，后面所有规则都会跟着错（easy-run 判成硬拉就是这么来的）。
//
// 判据只依赖抗视角差异的运动结构：
// - 交替步态：左右腿不同步（膝角相关低）+ 有连续触地/周期；
// - 静态保持：幅度极小、身体近水平、持续够久；
// - 双侧同步力量：左右腿/髋同步屈伸，且有明显行程；
// - 其他/未知：证据不足时明确 unknown，而不是默认深蹲。

import type { RecognitionFeatures } from './features'

export type MotionFamily = 'strength' | 'locomotion' | 'isometric' | 'other' | 'unknown'

export const FAMILY_THRESHOLDS = {
  /** 左右膝角相关低于该值才可能是交替步态 */
  locomotionMaxSync: 0.35,
  /** 步态至少要有 2 个周期证据 */
  locomotionMinCycles: 2,
  /** 踝部抬升幅度下限（躯干长）：太小说明只是原地屈膝 */
  locomotionMinLiftAmp: 0.06,
  /** 静态保持：膝/髋幅度、髋高变化上限与持续时长 */
  isometricMaxKneeRange: 14,
  isometricMaxHipDrop: 0.22,
  isometricMinTrunk: 55,
  isometricMinDurationSec: 3,
  /** 力量动作最小行程 */
  strengthMinKneeRange: 22,
  strengthMinHipRange: 22,
  strengthMinElbowRange: 45,
  strengthMinHipDrop: 0.35,
  /** 可用帧比例下限；低于它返回 unknown */
  minUsableRatio: 0.35
} as const

export interface FamilyDecision {
  family: MotionFamily
  scores: Record<MotionFamily, number>
  reasons: string[]
}

const round2 = (value: number) => Math.round(value * 100) / 100
const clamp01 = (value: number) => Math.max(0, Math.min(1, value))

/** 判断一级运动大类；返回带分数的候选，便于上层记录"为什么这么判" */
export function decideFamily(features: RecognitionFeatures): FamilyDecision {
  const scores: Record<MotionFamily, number> = { strength: 0, locomotion: 0, isometric: 0, other: 0, unknown: 0 }
  const reasons: string[] = []
  if (features.frameCount < 8 || features.usableRatio < FAMILY_THRESHOLDS.minUsableRatio) {
    return { family: 'unknown', scores: { ...scores, unknown: 1 }, reasons: ['可用帧不足，无法可靠判断运动类型'] }
  }

  // 交替步态：左右膝不同步 + 连续触地周期 + 踝部有实际抬升
  if (features.kneeSync !== null && features.kneeSync <= FAMILY_THRESHOLDS.locomotionMaxSync) {
    const cycleScore = clamp01(features.gait.cycles / Math.max(4, FAMILY_THRESHOLDS.locomotionMinCycles * 2))
    const liftScore = clamp01((features.ankleLiftAmp ?? 0) / 0.2)
    const syncScore = clamp01((FAMILY_THRESHOLDS.locomotionMaxSync - features.kneeSync) / 0.35)
    scores.locomotion = round2(0.45 * cycleScore + 0.3 * liftScore + 0.25 * syncScore)
    if (scores.locomotion > 0.3) reasons.push(`左右腿交替（膝角相关 ${features.kneeSync.toFixed(2)}）`)
  }

  // 静态保持：低幅度 + 身体近水平 + 持续
  if (features.durationSec >= FAMILY_THRESHOLDS.isometricMinDurationSec
    && (features.kneeRange ?? 99) <= FAMILY_THRESHOLDS.isometricMaxKneeRange
    && (features.hipDrop ?? 99) <= FAMILY_THRESHOLDS.isometricMaxHipDrop
    && (features.trunkMean ?? 0) >= FAMILY_THRESHOLDS.isometricMinTrunk) {
    const durationScore = clamp01(features.durationSec / 6)
    const levelScore = clamp01(((features.trunkMean ?? 0) - 40) / 40)
    scores.isometric = round2(0.5 * durationScore + 0.5 * levelScore)
    reasons.push('关节幅度很小且身体接近水平，像静态支撑')
  }

  // 双侧同步力量：左右同步 + 明显行程（膝/髋/肘任一）
  const strengthMovement = Math.max(
    clamp01(((features.kneeRange ?? 0) - FAMILY_THRESHOLDS.strengthMinKneeRange) / 40),
    clamp01(((features.hipRange ?? 0) - FAMILY_THRESHOLDS.strengthMinHipRange) / 40),
    clamp01(((features.elbowRange ?? 0) - FAMILY_THRESHOLDS.strengthMinElbowRange) / 60),
    clamp01(((features.hipDrop ?? 0) - FAMILY_THRESHOLDS.strengthMinHipDrop) / 0.8)
  )
  const syncScore = features.kneeSync === null ? 0.6 : clamp01((features.kneeSync + 0.2) / 1.2)
  if (strengthMovement > 0.2) {
    scores.strength = round2(0.65 * strengthMovement + 0.35 * syncScore)
    reasons.push(`双腿同步且有明显行程（膝幅度 ${features.kneeRange ?? '—'}°、髋幅度 ${features.hipRange ?? '—'}°）`)
  }

  // 其他：有小幅运动但够不上任何一类
  const anyMovement = (features.kneeRange ?? 0) >= 12 || (features.hipRange ?? 0) >= 12
    || (features.elbowRange ?? 0) >= 30 || (features.gait.cycles ?? 0) >= 1
  scores.other = anyMovement ? round2(clamp01(0.2 + 0.2 * (features.durationSec >= 3 ? 1 : 0))) : 0.5

  const ranked = (Object.entries(scores) as [MotionFamily, number][])
    .filter(([family]) => family !== 'unknown')
    .sort((a, b) => b[1] - a[1])
  const [bestFamily, bestScore] = ranked[0]
  const second = ranked[1]?.[1] ?? 0
  if (bestScore < 0.4 || bestScore - second < 0.08) {
    // 没有占优证据：明确 unknown，交给用户确认，不硬套最近的动作
    return {
      family: 'unknown',
      scores,
      reasons: [...reasons, '运动类型证据不足（候选分数接近），不作硬性判断']
    }
  }
  if (bestFamily === 'other') {
    reasons.push('有轻微运动，但不满足力量/步态/静态保持的结构特征')
  }
  return { family: bestFamily, scores, reasons }
}

/** 大类的中文说明，用于预检原因与调试 */
export function familyLabel(family: MotionFamily): string {
  return family === 'strength' ? '力量动作'
    : family === 'locomotion' ? '步态'
      : family === 'isometric' ? '静态保持'
        : family === 'other' ? '其他运动' : '未知'
}