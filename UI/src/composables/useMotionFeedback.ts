// 实时纠错通道：与 useSpeech 分开。useSpeech 的契约是只播组数/次数/休息，不做动作纠错；
// 这里组合调用它作为输出原语，门控全部交给纯函数 motionFeedbackPolicy，便于 selfcheck 断言。
import { ref, onUnmounted } from 'vue'
import { useSpeech } from '@/composables/useSpeech'
import {
  evaluateFeedback,
  initialFeedbackState,
  noteCountSpoken,
  clearAnomaly,
  MOTION_FEEDBACK_KEY,
  DEFAULT_MOTION_FEEDBACK,
  type FeedbackState,
  type MotionFeedbackSettings
} from '@/services/motionFeedbackPolicy'
import type { MotionAnalysisFinding } from '@/types/domain'

function loadSettings(): MotionFeedbackSettings {
  try {
    const raw = localStorage.getItem(MOTION_FEEDBACK_KEY)
    if (!raw) return { ...DEFAULT_MOTION_FEEDBACK }
    const parsed = JSON.parse(raw) as Partial<MotionFeedbackSettings>
    return { enabled: parsed.enabled === true }
  } catch {
    return { ...DEFAULT_MOTION_FEEDBACK }
  }
}

export function useMotionFeedback() {
  const { speak, stop } = useSpeech()
  const settings = ref<MotionFeedbackSettings>(loadSettings())
  const lastSpoken = ref<string | null>(null)
  const lastBlockReason = ref<string | null>(null)
  let state: FeedbackState = initialFeedbackState()

  function setEnabled(enabled: boolean) {
    settings.value = { enabled }
    try {
      localStorage.setItem(MOTION_FEEDBACK_KEY, JSON.stringify(settings.value))
    } catch {
      // 隐私模式下写不进去不影响本次会话
    }
    if (!enabled) stop()
  }

  /** 计数播报后调用，让纠错让位 */
  function noteCount(nowMs: number) {
    state = noteCountSpoken(state, nowMs)
  }

  function offer(finding: MotionAnalysisFinding, nowMs: number, jointVisibility: number, repIndex?: number): boolean {
    const verdict = evaluateFeedback({ finding, nowMs, jointVisibility, enabled: settings.value.enabled, repIndex }, state)
    state = verdict.state
    if (!verdict.allow) {
      lastBlockReason.value = verdict.reason
      return false
    }
    lastBlockReason.value = null
    lastSpoken.value = finding.title
    speak(finding.title)
    return true
  }

  /** 偏离消失时清掉累积证据 */
  function resolve(ruleId: string) {
    state = clearAnomaly(state, ruleId)
  }

  function reset() {
    state = initialFeedbackState()
    lastSpoken.value = null
    lastBlockReason.value = null
    stop()
  }

  onUnmounted(stop)

  return { settings, lastSpoken, lastBlockReason, setEnabled, offer, resolve, noteCount, reset }
}