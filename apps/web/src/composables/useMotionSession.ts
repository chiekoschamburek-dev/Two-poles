// 实时模式外壳：与离线分析共用同一套几何、状态机、专项规则与 rep 摘要。
// 因果性：只使用过去与当前帧。rep 结束时该次已完成，其所有帧都是过去/当前，
// 因此这里跑与离线相同的 analyzeRep，得到逐位相同的摘要——不需要另写因果近似。
import { ref, shallowRef, computed } from 'vue'
import type { NormalizedLandmark } from '@mediapipe/tasks-vision'
import { useRepCounter } from '@/composables/useRepCounter'
import { useMotionFeedback } from '@/composables/useMotionFeedback'
import { extractMotionFrame, analyzeRep, type MotionFrame, type RepAnalysis } from '@/services/motionAnalysis'
import { createFrameBuffer, eventsFromSnapshot, thresholdsFor, type MotionEvent } from '@/services/motionEvents'
import { repRuleFor, type MotionExerciseConfig } from '@/services/motionConfig'
import { rulesFor } from '@/services/motionRules'
import { consistencyRulesFor } from '@/services/motionConsistency'
import type { AnalysisAction, AnalysisView, MotionAnalysisFinding } from '@/types/domain'

export interface MotionSessionOptions {
  config: MotionExerciseConfig
  /** 实时视角由机位决定；未知时按侧面规则跑，与跟练默认机位一致 */
  view?: AnalysisView
  fps?: number
}

export function useMotionSession(options: MotionSessionOptions) {
  const rule = repRuleFor(options.config, 'realtime')
  const counter = useRepCounter(rule)
  const feedback = useMotionFeedback()
  const buffer = createFrameBuffer()
  const events = shallowRef<MotionEvent[]>([])
  const reps = ref<RepAnalysis[]>([])
  const findings = ref<MotionAnalysisFinding[]>([])
  const lastEvent = shallowRef<MotionEvent | null>(null)
  let previousZone: 'start' | 'between' | 'end' | null = null
  const fps = options.fps ?? 15
  const view = options.view ?? 'side'
  const action: AnalysisAction | undefined = options.config.analysisAction

  const thresholds = computed(() => thresholdsFor(rule, counter.calibratedNeutral.value))

  function pushEvents(next: MotionEvent[]) {
    if (!next.length) return
    events.value = [...events.value, ...next].slice(-500)
    lastEvent.value = next[next.length - 1]
  }

  /**
   * 每个新推理帧调用一次。landmarks 为 null 表示这一帧没有可用关键点。
   * sample 可传入调用方已算好的关节角与可见度，避免两处各算一遍导致口径漂移。
   * 返回本次是否完成了一次重复，供上层做计数播报。
   */
  function ingest(
    landmarks: NormalizedLandmark[] | null,
    timestamp: number,
    sample?: { angle: number | null; visibility: number }
  ): boolean {
    if (!landmarks) return false
    const frame: MotionFrame = extractMotionFrame(landmarks, timestamp)
    buffer.push(frame)

    const joint = options.config.joint
    let angle: number | null = null
    let visibility = 0
    if (sample) {
      angle = sample.angle
      visibility = sample.visibility
    } else {
      const sides = frame.points[joint === 'elbow' ? 'shoulder' : joint]
      const side = sides.right && sides.left
        ? (sides.right.visibility > sides.left.visibility ? 'right' : 'left')
        : (sides.right ? 'right' : 'left')
      const hip = frame.points.hip[side]
      const knee = frame.points.knee[side]
      const ankle = frame.points.ankle[side]
      const shoulder = frame.points.shoulder[side]
      const triple = joint === 'hip'
        ? (shoulder && hip && knee ? [shoulder, hip, knee] : null)
        : joint === 'elbow'
          ? null
          : (hip && knee && ankle ? [hip, knee, ankle] : null)
      if (triple) {
        const [a, v, b] = triple
        const u = { x: a.x - v.x, y: a.y - v.y }
        const w = { x: b.x - v.x, y: b.y - v.y }
        const magnitude = Math.hypot(u.x, u.y) * Math.hypot(w.x, w.y)
        if (magnitude) {
          angle = Math.round((Math.acos(Math.min(1, Math.max(-1, (u.x * w.x + u.y * w.y) / magnitude))) * 180) / Math.PI)
        }
        visibility = Math.min(a.visibility, v.visibility, b.visibility)
      }
    }

    const before = counterSnapshot(false)
    const result = counter.feed(angle, visibility, timestamp)
    const after = counterSnapshot(result.counted)

    let summary: RepAnalysis | null = null
    if (result.counted && after.lastRep) {
      const repFrames = buffer.since(after.lastRep.startMs)
      summary = analyzeRep(repFrames, after.lastRep, reps.value.length + 1, fps, action ?? 'squat')
      reps.value = [...reps.value, summary]
      evaluateRules()
    }

    const smoothed = angle
    pushEvents(eventsFromSnapshot(before, after, {
      ts: timestamp, joint, angle, smoothed, visibility, mode: 'realtime',
      thresholds: thresholds.value, summary
    }, previousZone))
    if (smoothed !== null) {
      const t = thresholds.value
      previousZone = t.increasing
        ? (smoothed >= t.low ? 'end' : smoothed <= t.high ? 'start' : 'between')
        : (smoothed <= t.low ? 'end' : smoothed >= t.high ? 'start' : 'between')
    }
    if (result.counted) feedback.noteCount(timestamp)
    // 纠错让位于计数：只在没有刚计数时尝试播报最新一条高置信结论
    if (!result.counted && findings.value.length) {
      const newest = findings.value[findings.value.length - 1]
      feedback.offer(newest, timestamp, visibility, reps.value.length)
    }
    return result.counted
  }

  function counterSnapshot(counted: boolean) {
    return {
      count: counter.count.value,
      phase: counter.phase.value,
      gate: counter.gate.value,
      lastRepMs: counter.lastRepMs.value,
      lastRep: counter.lastRep.value,
      calibratedNeutral: counter.calibratedNeutral.value,
      counted,
      thresholds: counter.thresholds.value
    }
  }

  /** 与离线同一套规则；实时只在已完成 rep 上评估，保证因果 */
  function evaluateRules() {
    if (!action) return
    const context = { action, view, reps: reps.value, fps }
    const out: MotionAnalysisFinding[] = []
    for (const rule of [...rulesFor(action, view), ...consistencyRulesFor(action)]) {
      if (rule.output !== 'finding') continue
      out.push(...(rule.evaluate(context) as MotionAnalysisFinding[]))
    }
    findings.value = out
  }

  function reset() {
    counter.reset('新一组开始：请回到起始姿势')
    buffer.clear()
    events.value = []
    reps.value = []
    findings.value = []
    lastEvent.value = null
    previousZone = null
    feedback.reset()
  }

  /** 换组只丢半次行程，保留已完成 rep 的摘要供组内一致性使用 */
  function nextSet() {
    counter.reset('新一组开始：请回到起始姿势')
    buffer.clear()
    previousZone = null
  }

  return {
    counter, feedback, events, lastEvent, reps, findings, thresholds,
    ingest, reset, nextSet,
    capturedFrames: () => buffer.all()
  }
}