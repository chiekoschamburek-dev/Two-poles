// 动作分析解读：规则文案永远先出，模型在超时内返回才替换，任何失败静默保持规则文案。
// 契约照 useDietFeedback：engine='rules' 先渲染，签名去重含失败态，避免对同一结论集反复请求。
// 默认关闭：开启后只把结构化测量文本发到云端，不发图像/视频。
import { ref, onUnmounted } from 'vue'
import { useAppStore } from '@/stores/app'
import { callLlmChat, canUseLlm, extractJson } from '@/services/llm'
import {
  buildMotionReport,
  buildMotionReportMessages,
  validateMotionPhrases,
  applyMotionPhrases,
  reportSignature,
  MOTION_PHRASE_TIMEOUT_MS,
  MOTION_EXPLANATION_KEY,
  DEFAULT_MOTION_EXPLANATION,
  type MotionReport,
  type MotionExplanationSettings
} from '@/services/motionReport'
import type { AnalysisAction, MotionAnalysisFinding, MotionAnalysisMetric } from '@/types/domain'

function loadSettings(): MotionExplanationSettings {
  try {
    const raw = localStorage.getItem(MOTION_EXPLANATION_KEY)
    if (!raw) return { ...DEFAULT_MOTION_EXPLANATION }
    const parsed = JSON.parse(raw) as Partial<MotionExplanationSettings>
    return { enabled: parsed.enabled === true }
  } catch {
    return { ...DEFAULT_MOTION_EXPLANATION }
  }
}

export function useMotionExplanation() {
  const store = useAppStore()
  const settings = ref<MotionExplanationSettings>(loadSettings())
  const report = ref<MotionReport | null>(null)
  const explaining = ref(false)
  let abort: AbortController | null = null
  let attemptedSignature = ''

  function setEnabled(enabled: boolean) {
    settings.value = { enabled }
    try {
      localStorage.setItem(MOTION_EXPLANATION_KEY, JSON.stringify(settings.value))
    } catch {
      // 隐私模式下写不进去不影响本次会话
    }
  }

  /** 规则报告立即可用；调用方先渲染它，再等 explain() 决定是否替换文案 */
  function prepare(input: {
    action: AnalysisAction
    findings: MotionAnalysisFinding[]
    metrics: MotionAnalysisMetric[]
    repCount: number | null
    gaitCycles: number | null
    holdSeconds?: number | null
  }): MotionReport {
    abort?.abort()
    attemptedSignature = ''
    report.value = buildMotionReport(input)
    return report.value
  }

  async function explain(): Promise<void> {
    const current = report.value
    if (!current || !current.lines.length) return
    if (!settings.value.enabled) return
    if (!canUseLlm(store.llmConfig, store.llmDefault)) return
    const signature = reportSignature(current)
    if (signature === attemptedSignature) return
    // 失败也记签名：否则同一段分析会对同一个错误反复发请求
    attemptedSignature = signature
    explaining.value = true
    abort = new AbortController()
    const timer = setTimeout(() => abort?.abort(), MOTION_PHRASE_TIMEOUT_MS)
    try {
      const messages = buildMotionReportMessages(current)
      const result = await callLlmChat(store.llmConfig, [
        { role: 'system', content: messages.system },
        { role: 'user', content: messages.user }
      ], { signal: abort.signal })
      if (result.error) return
      const validated = validateMotionPhrases(extractJson(result.text), current)
      // 只有校验通过的条目才替换；其余保持规则原文
      if (Object.keys(validated.phrases).length || validated.warnings.length) {
        report.value = applyMotionPhrases(current, validated)
      }
    } finally {
      clearTimeout(timer)
      explaining.value = false
    }
  }

  function dispose() {
    abort?.abort()
    abort = null
  }

  onUnmounted(dispose)

  return { settings, report, explaining, setEnabled, prepare, explain, dispose }
}