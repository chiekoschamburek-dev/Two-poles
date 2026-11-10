<template>
  <div class="page">
    <header class="analysis-bar">
      <div class="bar-copy">
        <span class="micro">ANALYSIS</span>
        <h1>动作分析</h1>
        <p>上传本地视频，在端侧逐帧分析动作。视频不上传，分析完成后即丢弃。</p>
      </div>
      <StatusBadge v-if="step === 'result' && precheckResult" :variant="precheckResult.verdict === 'degraded' ? 'warning' : 'success'">
        {{ precheckResult.verdict === 'degraded' ? '低置信度结果' : '分析完成' }}
      </StatusBadge>
    </header>

    <BaseCard v-if="step === 'pick' || step === 'error'" class="panel">
      <h2>选择动作与视频</h2>
      <div class="action-row" role="radiogroup" aria-label="分析动作">
        <button
          v-for="item in actions"
          :key="item.id"
          type="button"
          role="radio"
          :aria-checked="action === item.id"
          :class="{ on: action === item.id }"
          @click="action = item.id"
        >
          <Video :size="16" />
          <span>{{ item.label }}</span>
          <small>{{ item.hint }}</small>
        </button>
      </div>

      <div class="upload-box">
        <Upload :size="20" />
        <div class="upload-copy">
          <strong>{{ fileName || '从相册选择视频' }}</strong>
          <span>mp4 / webm / mov · 1–60 秒 · ≤ 200MB</span>
        </div>
        <BaseButton size="sm" variant="secondary" :disabled="busy" @click="pickFile">
          {{ fileName ? '重新选择' : '选择视频' }}
        </BaseButton>
        <input
          ref="fileInput"
          class="sr-only"
          type="file"
          accept="video/mp4,video/webm,video/quicktime,.mov"
          :disabled="busy"
          @change="onFileChange"
        />
      </div>

      <div v-if="busy" class="inline-progress" aria-live="polite">
        <span>{{ statusText || '正在检查视频……' }}</span>
        <div class="bar"><i :style="{ width: `${Math.round(progress * 100)}%` }"></i></div>
      </div>
      <p v-if="errorMessage" class="error-line" role="alert">{{ errorMessage }}</p>
      <div v-if="selectedFile" class="actions">
        <BaseButton v-if="errorMessage" size="sm" variant="secondary" :disabled="busy" @click="retryFile">重试当前视频</BaseButton>
        <BaseButton v-if="errorMessage" size="sm" variant="ghost" :disabled="busy" @click="resetAll">清除</BaseButton>
      </div>

      <details class="guide" open>
        <summary>拍摄要求</summary>
        <ul>
          <li>手机固定，与髋同高，从正侧方或正前方拍全身（头顶到脚底）。</li>
          <li>深蹲、硬拉拍 3–5 次完整动作；跑姿至少 5 个步态周期，优先跑步机侧拍。</li>
          <li>距离 3–5 米，光线均匀，避免逆光和大面积遮挡。</li>
          <li>分析只在本机进行；视频不会上传，也不会保存。</li>
        </ul>
      </details>

      <template v-if="store.analyses.length">
        <h2 class="history-title">历史分析</h2>
        <ul class="history">
          <li v-for="record in store.analyses" :key="record.id">
            <RouterLink :to="`/analysis/${record.id}`" class="history-link">
              <span class="history-main">
                <strong>{{ record.exerciseName }} · {{ viewLabel(record.view) }}视角</strong>
                <small>{{ record.date }} · {{ record.findings.length }} 项关注</small>
              </span>
              <StatusBadge v-if="record.status === 'low-confidence'" variant="warning">低置信度</StatusBadge>
            </RouterLink>
          </li>
        </ul>
      </template>
      <p v-else class="muted small history-empty">还没有分析记录。</p>
    </BaseCard>

    <template v-else-if="step === 'prechecked' && precheckResult">
      <BaseCard class="panel">
        <h2>视频可分析</h2>
        <dl class="summary">
          <div><dt>动作</dt><dd>{{ actionLabel }}</dd></div>
          <div><dt>视角</dt><dd>{{ viewLabel(precheckResult.view) }}</dd></div>
          <div><dt>{{ action === 'running' ? '步态周期' : '完整重复' }}</dt><dd>{{ action === 'running' ? `${precheckResult.gaitCycles ?? '—'} 个` : `${precheckResult.repCount ?? '—'} 次` }}</dd></div>
          <div><dt>时长</dt><dd>{{ duration.toFixed(1) }} 秒</dd></div>
        </dl>
        <ul v-if="precheckResult.verdict === 'degraded'" class="warn-list">
          <li v-for="reason in precheckResult.reasons" :key="reason">{{ reason }}</li>
        </ul>
        <div class="actions">
          <BaseButton @click="startAnalysis"><Play :size="16" />开始分析</BaseButton>
          <BaseButton variant="ghost" @click="resetAll">换一个视频</BaseButton>
        </div>
      </BaseCard>
    </template>

    <BaseCard v-else-if="step === 'analyzing'" class="panel" aria-live="polite">
      <h2>正在分析</h2>
      <p class="muted">{{ saving ? '正在保存关键帧……' : (statusText || '正在逐帧分析……') }}</p>
      <div class="bar big"><i :style="{ width: `${Math.round(progress * 100)}%` }"></i></div>
      <div v-if="!saving" class="actions">
        <BaseButton variant="ghost" @click="stopAnalysis">取消</BaseButton>
      </div>
    </BaseCard>

    <BaseCard v-else-if="step === 'rejected' && precheckResult" class="panel">
      <h2>这段视频无法分析</h2>
      <ul class="error-list">
        <li v-for="reason in precheckResult.reasons" :key="reason">{{ reason }}</li>
      </ul>
      <details class="guide" open>
        <summary>重拍建议</summary>
        <ul>
          <li>固定手机，与髋同高，从正侧方或正前方拍。</li>
          <li>确保头顶到脚底都在画面内，人与镜头距离 3–5 米。</li>
          <li>光线均匀，避免逆光；选择 mp4 / webm / mov，时长 1–60 秒。</li>
        </ul>
      </details>
      <div class="actions">
        <BaseButton variant="secondary" @click="resetAll">重新选择视频</BaseButton>
      </div>
    </BaseCard>

    <template v-else-if="step === 'result' && result && precheckResult">
      <div class="result-head">
        <div>
          <span class="micro">RESULT</span>
          <h2>{{ actionLabel }} · {{ viewLabel(precheckResult.view) }}视角</h2>
          <p>{{ result.repCount !== null ? `识别到 ${result.repCount} 次完整重复` : (result.gaitCycles !== null ? `识别到 ${result.gaitCycles} 个步态周期` : '按所选动作完成分析') }}</p>
        </div>
      </div>

      <BaseCard v-if="precheckResult.verdict === 'degraded'" class="panel warn-panel">
        <strong>低置信度结果</strong>
        <ul class="warn-list">
          <li v-for="reason in precheckResult.reasons" :key="reason">{{ reason }}</li>
        </ul>
      </BaseCard>

      <BaseCard class="panel">
        <h2>关注项</h2>
        <p v-if="!result.findings.length" class="muted">本次没有命中关注项。下面是对这次动作的客观测量。</p>
        <article v-for="(finding, index) in result.findings" :key="`${finding.ruleId}-${index}`" class="finding">
          <header>
            <strong>{{ finding.title }}</strong>
            <span>{{ formatTime(finding.timeMs) }}</span>
          </header>
          <p>{{ finding.detail }}</p>
          <img
            v-if="finding.keyframeRef && keyframeUrls[finding.keyframeRef]"
            class="keyframe"
            :src="keyframeUrls[finding.keyframeRef]"
            alt="问题时刻的关键帧截图"
            loading="lazy"
          />
          <dl>
            <div><dt>实测</dt><dd>{{ formatMeasured(finding) }}</dd></div>
            <div><dt>阈值</dt><dd>{{ finding.thresholdLabel }}</dd></div>
            <div><dt>出处</dt><dd>{{ finding.sourceLabel }}</dd></div>
          </dl>
        </article>
      </BaseCard>

      <BaseCard class="panel">
        <h2>测量值</h2>
        <dl class="metrics">
          <div v-for="metric in result.metrics" :key="metric.id">
            <dt>{{ metric.label }}</dt>
            <dd>{{ metric.value }}<small v-if="metric.unit"> {{ metric.unit }}</small></dd>
          </div>
        </dl>
      </BaseCard>

      <p class="disclaimer">{{ disclaimer }}</p>
      <div class="actions">
        <BaseButton variant="secondary" @click="resetAll">换一个视频</BaseButton>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
import { Play, Upload, Video } from 'lucide-vue-next'
import BaseButton from '@/components/common/BaseButton.vue'
import BaseCard from '@/components/common/BaseCard.vue'
import StatusBadge from '@/components/common/StatusBadge.vue'
import { useAppStore } from '@/stores/app'
import { useVideoAnalysis, VideoAnalysisError } from '@/composables/useVideoAnalysis'
import { MOTION_RULES_VERSION } from '@/services/motionRules'
import { saveAnalysisKeyframe } from '@/services/analysisKeyframes'
import { newId } from '@/utils/id'
import { toISODate } from '@/utils/time'
import type {
  AnalysisAction,
  AnalysisView,
  MotionAnalysis,
  MotionAnalysisFinding,
  MotionAnalysisResult,
  MotionPrecheckResult
} from '@/types/domain'

type Step = 'pick' | 'prechecked' | 'analyzing' | 'result' | 'rejected' | 'error'

const actions: { id: AnalysisAction; label: string; hint: string }[] = [
  { id: 'squat', label: '深蹲', hint: '侧面或正面' },
  { id: 'deadlift', label: '硬拉', hint: '侧面或正面' },
  { id: 'running', label: '跑姿', hint: '跑步机侧拍优先' }
]

const disclaimer = '规则参考各关注项所列文献，阈值由本项目自行翻译，未经运动医学或体能专业人士审核；结果仅供复盘参考，不构成诊断或训练处方。'

const { phase, progress, statusText, duration, prepare, precheck, analyze, captureKeyframes, cancel, dispose } = useVideoAnalysis()
const store = useAppStore()

const step = ref<Step>('pick')
const action = ref<AnalysisAction>('squat')
const fileName = ref('')
const precheckResult = ref<MotionPrecheckResult | null>(null)
const result = ref<MotionAnalysisResult | null>(null)
const errorMessage = ref('')
const fileInput = ref<HTMLInputElement | null>(null)
const selectedFile = ref<File | null>(null)
const saving = ref(false)
const keyframeUrls = ref<Record<string, string>>({})

const busy = computed(() => phase.value === 'precheck')
const actionLabel = computed(() => actions.find(item => item.id === action.value)?.label ?? '')
const viewLabel = (view: AnalysisView | null) => view === 'side' ? '侧面' : view === 'front' ? '正面' : '未知'

function pickFile() {
  fileInput.value?.click()
}

function messageOf(error: unknown): string {
  return error instanceof VideoAnalysisError ? error.message : (error as Error)?.message || '分析失败，请重试'
}

function isCancelled(error: unknown): boolean {
  return error instanceof VideoAnalysisError && error.code === 'cancelled'
}

function resetState() {
  step.value = 'pick'
  precheckResult.value = null
  result.value = null
  errorMessage.value = ''
  fileName.value = ''
  selectedFile.value = null
  saving.value = false
}

function revokeKeyframeUrls() {
  for (const url of Object.values(keyframeUrls.value)) URL.revokeObjectURL(url)
  keyframeUrls.value = {}
}

function resetAll() {
  if (phase.value !== 'idle') cancel()
  revokeKeyframeUrls()
  dispose()
  resetState()
}

async function runFile(file: File) {
  dispose()
  resetState()
  selectedFile.value = file
  fileName.value = file.name
  errorMessage.value = ''
  try {
    await prepare(file)
    precheckResult.value = await precheck(action.value)
    step.value = precheckResult.value.verdict === 'rejected' ? 'rejected' : 'prechecked'
  } catch (error) {
    if (isCancelled(error)) return
    errorMessage.value = messageOf(error)
    const fileError = error instanceof VideoAnalysisError
      && ['invalid-type', 'too-large', 'too-long', 'too-short'].includes(error.code)
    step.value = fileError ? 'pick' : 'error'
  }
}

async function retryFile() {
  if (selectedFile.value) await runFile(selectedFile.value)
}

async function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  await runFile(file)
}

async function persistResult(analysisResult: MotionAnalysisResult, view: AnalysisView): Promise<MotionAnalysisResult> {
  const id = newId()
  const targetIndexes = analysisResult.findings
    .map((finding, index) => ({ finding, index }))
    .filter(({ finding }) => finding.timeMs !== null)
    .slice(0, 8)
    .map(({ index }) => index)
  const blobs = await captureKeyframes(targetIndexes.map(index => analysisResult.findings[index].timeMs as number))
  const saved = await Promise.all(targetIndexes.map(async (findingIndex, order) => {
    const blob = blobs[order]
    if (!blob) return false
    const ref = `${id}-f${findingIndex}`
    try {
      await saveAnalysisKeyframe(ref, blob)
      keyframeUrls.value[ref] = URL.createObjectURL(blob)
      return true
    } catch {
      return false
    }
  }))
  const findings = analysisResult.findings.map((finding, index) => {
    const order = targetIndexes.indexOf(index)
    const keyframeRef = order >= 0 && saved[order] ? `${id}-f${index}` : undefined
    return { ...finding, id: `${id}-f${index}`, ...(keyframeRef ? { keyframeRef } : {}) }
  })
  const record: MotionAnalysis = {
    id,
    userId: store.userProfile?.id || 'demo-user',
    date: toISODate(new Date()),
    action: action.value,
    exerciseName: actionLabel.value,
    view,
    status: precheckResult.value?.verdict === 'degraded' ? 'low-confidence' : 'completed',
    lowConfidenceReasons: precheckResult.value?.reasons ?? [],
    findings,
    metrics: analysisResult.metrics,
    repCount: analysisResult.repCount,
    gaitCycles: analysisResult.gaitCycles,
    ruleVersion: MOTION_RULES_VERSION,
    createdAt: new Date().toISOString(),
    _sync: 'pending'
  }
  store.addAnalysis(record)
  return { ...analysisResult, findings }
}

function reconcilePrecheck(analysisResult: MotionAnalysisResult) {
  if (!precheckResult.value) return
  let reasons = precheckResult.value.reasons
  if (action.value === 'running' && analysisResult.gaitCycles !== null) {
    reasons = reasons.filter(reason => !reason.includes('步态周期不足'))
    if (analysisResult.gaitCycles < 5) {
      reasons.push(`步态周期不足（识别到 ${analysisResult.gaitCycles} 个，至少 5 个），结果置信度低`)
    }
  } else if (analysisResult.repCount !== null) {
    reasons = reasons.filter(reason => !reason.includes('未识别到完整重复'))
    if (analysisResult.repCount === 0) {
      reasons.push('未识别到完整重复动作：请完整拍摄至少 1 次动作后重试')
    }
  }
  precheckResult.value = {
    ...precheckResult.value,
    gaitCycles: analysisResult.gaitCycles ?? precheckResult.value.gaitCycles,
    repCount: analysisResult.repCount ?? precheckResult.value.repCount,
    reasons,
    verdict: reasons.length ? 'degraded' : 'ok'
  }
}

async function startAnalysis() {
  const view = precheckResult.value?.view
  if (!view) return
  step.value = 'analyzing'
  errorMessage.value = ''
  try {
    const analysisResult = await analyze(action.value, view)
    reconcilePrecheck(analysisResult)
    saving.value = true
    result.value = await persistResult(analysisResult, view)
    saving.value = false
    step.value = 'result'
  } catch (error) {
    saving.value = false
    if (isCancelled(error)) {
      step.value = 'prechecked'
      return
    }
    errorMessage.value = messageOf(error)
    step.value = 'error'
  }
}

function stopAnalysis() {
  cancel()
  step.value = precheckResult.value ? 'prechecked' : 'pick'
}

function formatTime(ms: number | null): string {
  if (ms === null) return '—'
  const seconds = ms / 1000
  const minutes = Math.floor(seconds / 60)
  const rest = (seconds % 60).toFixed(1).padStart(4, '0')
  return `${minutes}:${rest}`
}

function formatMeasured(finding: MotionAnalysisFinding): string {
  if (finding.measured === null) return '—'
  return `${finding.measured}${finding.unit ? ` ${finding.unit}` : ''}`
}

onUnmounted(revokeKeyframeUrls)
</script>

<style scoped>
.page { max-width: var(--content-max-width); margin: 0 auto; display: flex; flex-direction: column; gap: 14px; }
.analysis-bar { display: flex; align-items: flex-end; justify-content: space-between; gap: 18px; padding: 16px 0 12px; border-bottom: 1px solid var(--color-divider); }
.bar-copy { min-width: 0; }
.bar-copy h1 { margin: 5px 0 0; font-size: 24px; letter-spacing: -0.025em; }
.bar-copy p { margin: 5px 0 0; font-size: 12px; color: var(--color-text-muted); line-height: 1.65; }
.micro { font-family: var(--font-num); font-size: 10px; font-weight: 700; letter-spacing: 0.18em; color: var(--color-text-muted); }
.panel { padding: 18px 20px; }
.panel h2 { margin: 0 0 12px; font-size: 16px; }
.muted { margin: 0; color: var(--color-text-muted); font-size: 13px; line-height: 1.7; }
.action-row { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; }
.action-row button { display: inline-flex; align-items: center; gap: 8px; min-height: 42px; padding: 8px 14px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-card); color: var(--color-text-secondary); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }
.action-row button small { font-weight: 500; color: var(--color-text-muted); }
.action-row button.on { border-color: var(--color-accent-line); background: var(--color-accent-soft); color: var(--color-ink); }
.upload-box { display: flex; align-items: center; gap: 12px; padding: 14px 16px; border: 1px dashed var(--hair-strong); border-radius: var(--radius-lg); background: var(--color-neutral-soft); }
.upload-copy { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.upload-copy strong { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.upload-copy span { font-size: 11px; color: var(--color-text-muted); }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); border: 0; }
.inline-progress { margin-top: 12px; display: flex; flex-direction: column; gap: 6px; font-size: 12px; color: var(--color-text-muted); }
.bar { height: 8px; border-radius: 999px; background: var(--color-neutral-soft); overflow: hidden; box-shadow: inset 0 0 0 1px var(--color-border); }
.bar.big { height: 10px; margin: 14px 0; }
.bar i { display: block; height: 100%; background: var(--color-ink); transition: width var(--motion-fast); }
.error-line { margin: 12px 0 0; color: var(--color-danger); font-size: 13px; line-height: 1.6; }
.error-list { margin: 0 0 12px; padding-left: 18px; color: var(--color-danger); font-size: 13px; line-height: 1.8; }
.guide { margin-top: 14px; font-size: 12.5px; color: var(--color-text-secondary); }
.guide summary { cursor: pointer; font-weight: 600; }
.guide ul { margin: 8px 0 0; padding-left: 18px; line-height: 1.8; color: var(--color-text-muted); }
.summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 12px; margin: 0 0 12px; }
.summary div { padding: 10px 12px; border-radius: var(--radius-md); background: var(--color-neutral-soft); }
.summary dt { font-size: 11px; color: var(--color-text-muted); }
.summary dd { margin: 3px 0 0; font-size: 15px; font-weight: 700; }
.warn-panel { border-color: var(--color-caution); background: var(--color-caution-soft); }
.warn-list { margin: 8px 0 0; padding-left: 18px; color: var(--color-caution); font-size: 12.5px; line-height: 1.8; }
.actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 14px; }
.result-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; padding: 6px 2px 0; }
.result-head h2 { margin: 4px 0 0; font-size: 20px; }
.result-head p { margin: 4px 0 0; font-size: 12px; color: var(--color-text-muted); }
.finding { padding: 14px 0; border-top: 1px solid var(--color-divider); }
.finding:first-of-type { border-top: none; padding-top: 0; }
.finding header { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
.finding header strong { font-size: 14px; }
.finding header span { font-family: var(--font-num); font-size: 11px; color: var(--color-text-muted); }
.finding p { margin: 5px 0 8px; font-size: 13px; color: var(--color-text-secondary); line-height: 1.7; }
.finding dl { display: grid; gap: 4px; margin: 0; }
.finding dl div { display: grid; grid-template-columns: 48px 1fr; gap: 8px; font-size: 12px; }
.finding dt { color: var(--color-text-muted); }
.finding dd { margin: 0; color: var(--color-text-secondary); }
.metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin: 0; }
.metrics div { padding: 12px 14px; border-radius: var(--radius-md); background: var(--color-neutral-soft); }
.metrics dt { font-size: 11.5px; color: var(--color-text-muted); }
.metrics dd { margin: 4px 0 0; font-family: var(--font-num); font-size: 18px; font-weight: 700; }
.metrics small { font-size: 11px; font-weight: 500; color: var(--color-text-muted); }
.disclaimer { margin: 2px 2px 0; font-size: 11.5px; line-height: 1.7; color: var(--color-text-muted); }
.keyframe { display: block; width: min(100%, 360px); margin: 8px 0 10px; border-radius: var(--radius-md); border: 1px solid var(--color-border); }
.history { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.history-title { margin-top: 18px !important; }
.history-empty { margin-top: 14px; }
.small { font-size: 11.5px; }
.history li { border-top: 1px solid var(--color-divider); }
.history li:first-child { border-top: none; }
.history-link { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 11px 4px; text-decoration: none; color: inherit; }
.history-main { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.history-main strong { font-size: 13.5px; }
.history-main small { font-size: 11.5px; color: var(--color-text-muted); }
.history-link:hover strong { color: var(--color-accent-strong); }
@media (max-width: 767px) {
  .analysis-bar { flex-direction: column; align-items: stretch; gap: 10px; padding: 13px 0 10px; }
  .panel { padding: 16px 14px; }
  .upload-box { flex-wrap: wrap; }
}
</style>
