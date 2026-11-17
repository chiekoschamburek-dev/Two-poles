// 实时纠错播报的门控策略：纯函数，selfcheck 不需要 Web Speech 就能断言。
// useSpeech 的契约是「只播组数、次数与休息计时，不做动作纠错」，所以纠错走独立通道，
// 由本策略决定是否放行，再由 useMotionFeedback 调用 useSpeech 作为输出原语。
import type { MotionAnalysisFinding } from '@/types/domain'

export const FEEDBACK_GATES = {
  minConfidence: 0.6,
  minJointVisibility: 0.6,
  /** 偏离必须持续这么久才播，避免关键点抖一下就纠错 */
  minAnomalyMs: 300,
  /** 一致性结论要连续这么多次 rep 才播 */
  minConsecutiveReps: 2,
  sameRuleCooldownMs: 8000,
  globalCooldownMs: 4000,
  /** 计数播报优先：刚报过数就不插纠错 */
  countYieldMs: 1500
} as const

export interface FeedbackState {
  /** ruleId → 上次播报时间 */
  lastSpokenByRule: Record<string, number>
  lastSpokenAt: number | null
  lastCountSpokenAt: number | null
  /** ruleId → 首次观测到偏离的时间 */
  anomalySince: Record<string, number>
  /** ruleId → 连续命中的 rep 序号列表 */
  consecutiveReps: Record<string, number[]>
}

export function initialFeedbackState(): FeedbackState {
  return { lastSpokenByRule: {}, lastSpokenAt: null, lastCountSpokenAt: null, anomalySince: {}, consecutiveReps: {} }
}

export type FeedbackVerdict =
  | { allow: true; state: FeedbackState }
  | { allow: false; reason: 'disabled' | 'low-confidence' | 'low-visibility' | 'too-brief' | 'not-consecutive' | 'rule-cooldown' | 'global-cooldown' | 'yield-to-count'; state: FeedbackState }

export interface FeedbackCandidate {
  finding: MotionAnalysisFinding
  nowMs: number
  jointVisibility: number
  enabled: boolean
  /** 一致性类结论（ruleId 含 -CN-）需要连续 rep 佐证 */
  repIndex?: number
}

function isConsistency(ruleId: string): boolean {
  return ruleId.includes('-CN-')
}

/**
 * 四道门：opt-in → 置信度/可见度 → 异常持续 → 冷却。
 * 不放行时也要推进 anomalySince/consecutiveReps，否则下次永远攒不够证据。
 */
export function evaluateFeedback(candidate: FeedbackCandidate, state: FeedbackState): FeedbackVerdict {
  const { finding, nowMs, jointVisibility, enabled, repIndex } = candidate
  const ruleId = finding.ruleId
  const next: FeedbackState = {
    lastSpokenByRule: { ...state.lastSpokenByRule },
    lastSpokenAt: state.lastSpokenAt,
    lastCountSpokenAt: state.lastCountSpokenAt,
    anomalySince: { ...state.anomalySince },
    consecutiveReps: { ...state.consecutiveReps }
  }

  if (!enabled) return { allow: false, reason: 'disabled', state: next }

  const confidence = finding.confidence ?? 0
  if (confidence < FEEDBACK_GATES.minConfidence) return { allow: false, reason: 'low-confidence', state: next }
  if (jointVisibility < FEEDBACK_GATES.minJointVisibility) return { allow: false, reason: 'low-visibility', state: next }

  // 先累积证据（冷却期内也要攒），再判冷却，最后判持续时长——
  // 否则冷却期把 anomalySince 清掉后，下一次会报 too-brief 而不是真实原因 cooldown
  let durationBlock: 'too-brief' | 'not-consecutive' | null = null
  if (isConsistency(ruleId)) {
    const previous = next.consecutiveReps[ruleId] ?? []
    const index = repIndex ?? 0
    const chain = previous.length && index === previous[previous.length - 1] + 1 ? [...previous, index] : [index]
    next.consecutiveReps[ruleId] = chain
    if (chain.length < FEEDBACK_GATES.minConsecutiveReps) durationBlock = 'not-consecutive'
  } else {
    if (next.anomalySince[ruleId] === undefined) next.anomalySince[ruleId] = nowMs
    if (nowMs - next.anomalySince[ruleId] < FEEDBACK_GATES.minAnomalyMs) durationBlock = 'too-brief'
  }

  if (next.lastCountSpokenAt !== null && nowMs - next.lastCountSpokenAt < FEEDBACK_GATES.countYieldMs) {
    return { allow: false, reason: 'yield-to-count', state: next }
  }
  const lastRule = next.lastSpokenByRule[ruleId]
  if (lastRule !== undefined && nowMs - lastRule < FEEDBACK_GATES.sameRuleCooldownMs) {
    return { allow: false, reason: 'rule-cooldown', state: next }
  }
  if (next.lastSpokenAt !== null && nowMs - next.lastSpokenAt < FEEDBACK_GATES.globalCooldownMs) {
    return { allow: false, reason: 'global-cooldown', state: next }
  }
  if (durationBlock) return { allow: false, reason: durationBlock, state: next }

  next.lastSpokenByRule[ruleId] = nowMs
  next.lastSpokenAt = nowMs
  delete next.anomalySince[ruleId]
  delete next.consecutiveReps[ruleId]
  return { allow: true, state: next }
}

/** 计数播报后调用，让纠错让位 */
export function noteCountSpoken(state: FeedbackState, nowMs: number): FeedbackState {
  return { ...state, lastCountSpokenAt: nowMs }
}

/** 偏离消失时清掉累积证据，避免下次一出现就立刻满足持续时长 */
export function clearAnomaly(state: FeedbackState, ruleId: string): FeedbackState {
  const anomalySince = { ...state.anomalySince }
  const consecutiveReps = { ...state.consecutiveReps }
  delete anomalySince[ruleId]
  delete consecutiveReps[ruleId]
  return { ...state, anomalySince, consecutiveReps }
}

export interface MotionFeedbackSettings {
  enabled: boolean
}

export const DEFAULT_MOTION_FEEDBACK: MotionFeedbackSettings = { enabled: false }
export const MOTION_FEEDBACK_KEY = 'twopoles.v1.motionFeedback'