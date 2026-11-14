<template>
  <div class="page">
    <header class="an-hero">
      <div class="an-hero-top">
        <div class="an-id">
          <PoleMark pole="movement" :size="30" />
          <div>
            <span class="micro move">左极 · MOVEMENT</span>
            <h1>动作分析</h1>
          </div>
        </div>
        <span class="an-chip"><i aria-hidden="true"></i>端侧处理</span>
        <StatusBadge v-if="step === 'result' && precheckResult" :variant="precheckResult.verdict === 'degraded' ? 'warning' : 'success'">
          {{ precheckResult.verdict === 'degraded' ? '低置信度结果' : '分析完成' }}
        </StatusBadge>
      </div>
      <span class="an-kicker">ANALYSIS · 训练后复盘</span>
      <h2 class="an-lead">逐帧看 <em>动作</em><span>，不评分</span></h2>
      <p class="an-sub">从相册选视频，本机逐帧分析；输出问题清单与关键帧。</p>
    </header>

    <template v-if="step === 'pick' || step === 'error'">
      <section class="an-card">
        <div class="an-card-head">
          <h2>选择视频</h2>
          <span>本地 · 不上传</span>
        </div>

        <div class="an-upload">
          <span class="an-upload-ic"><Upload :size="15" /></span>
          <div class="an-upload-copy">
            <strong>{{ fileName || '从相册选择视频' }}</strong>
            <span>mp4 / webm / mov · 1–60 秒 · ≤ 200MB · 动作自动识别</span>
          </div>
          <button class="an-pick" type="button" :disabled="busy" @click="pickFile">
            {{ fileName ? '重新选择' : '选择视频' }}
          </button>
          <input
            ref="fileInput"
            class="sr-only"
            type="file"
            accept="video/mp4,video/webm,video/quicktime,.mov"
            :disabled="busy"
            @change="onFileChange"
          />
        </div>

        <div v-if="busy" class="an-progress" aria-live="polite">
          <span>{{ statusText || '正在检查视频……' }}</span>
          <div class="bar"><i :style="{ width: `${Math.round(progress * 100)}%` }"></i></div>
        </div>
        <p v-if="errorMessage" class="error-line" role="alert">{{ errorMessage }}</p>
        <div v-if="selectedFile" class="an-inline-actions">
          <BaseButton v-if="errorMessage" size="sm" variant="secondary" :disabled="busy" @click="retryFile">重试当前视频</BaseButton>
          <BaseButton v-if="errorMessage" size="sm" variant="ghost" :disabled="busy" @click="resetAll">清除</BaseButton>
        </div>

        <details class="an-guide">
          <summary>
            <span>拍摄要求</span>
            <small>固定手机、全身入镜；深蹲 / 硬拉 3–5 次，跑姿至少 5 个步态周期。</small>
          </summary>
          <ul>
            <li>手机固定，与髋同高，从正侧方或正前方拍全身（头顶到脚底）。</li>
            <li>深蹲、硬拉拍 3–5 次完整动作；跑姿至少 5 个步态周期，优先跑步机侧拍。</li>
            <li>距离 3–5 米，光线均匀，避免逆光和大面积遮挡。</li>
            <li>分析只在本机进行；视频不会上传，也不会保存。</li>
          </ul>
        </details>
      </section>

      <section class="an-card">
        <div class="an-card-head">
          <h2>历史分析</h2>
          <span>{{ store.analyses.length ? `${store.analyses.length} 条` : '暂无记录' }}</span>
        </div>
        <ul v-if="store.analyses.length" class="an-history">
          <li v-for="record in store.analyses" :key="record.id">
            <RouterLink :to="`/analysis/${record.id}`" class="an-history-link">
              <span class="an-h-ic"><Video :size="14" /></span>
              <span class="an-h-main">
                <strong>{{ record.exerciseName }} · {{ viewLabel(record.view) }}视角</strong>
                <small>{{ record.date.slice(5) }} · {{ record.findings.length }} 项关注</small>
              </span>
              <StatusBadge v-if="record.status === 'low-confidence'" variant="warning">低置信度</StatusBadge>
              <ChevronRight :size="13" class="an-h-chev" />
            </RouterLink>
          </li>
        </ul>
        <p v-else class="an-empty">还没有分析记录。</p>
      </section>

      <section class="an-flow" aria-label="分析流程">
        <div><span class="num">01</span><b>可分析性检查</b><small>全身入镜 / 视角 / 自动识别动作</small></div>
        <div><span class="num">02</span><b>端侧逐帧识别</b><small>视频不上传，分析后丢弃</small></div>
        <div><span class="num">03</span><b>问题清单</b><small>关键帧 · 阈值 · 出处</small></div>
      </section>
    </template>

    <template v-else-if="step === 'prechecked' && precheckResult">
      <BaseCard class="panel">
        <h2>视频可分析</h2>
        <dl class="summary">
          <div>
            <dt>动作</dt>
            <dd>
              自动识别：{{ actionLabel }}
              <span v-if="canSwitchAction" class="switch-group" role="group" aria-label="切换动作">
                <button
                  v-for="item in switchableActions"
                  :key="item.id"
                  type="button"
                  class="switch-chip"
                  :class="{ on: action === item.id }"
                  :aria-pressed="action === item.id"
                  @click="switchAction(item.id)"
                >{{ item.label }}</button>
              </span>
            </dd>
          </div>
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
          <p>{{ result.repCount !== null ? `识别到 ${result.repCount} 次完整重复` : (result.gaitCycles !== null ? `识别到 ${result.gaitCycles} 个步态周期` : '按自动识别的动作完成分析') }}</p>
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
        <BaseButton v-if="canSwitchAction" variant="ghost" @click="switchAndRerun">
          识别错了？按{{ otherActionLabel }}重新分析
        </BaseButton>
        <BaseButton variant="secondary" @click="resetAll">换一个视频</BaseButton>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
import { ChevronRight, Play, Upload, Video } from 'lucide-vue-next'
import BaseButton from '@/components/common/BaseButton.vue'
import BaseCard from '@/components/common/BaseCard.vue'
import StatusBadge from '@/components/common/StatusBadge.vue'
import PoleMark from '@/components/poles/PoleMark.vue'
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

const ACTION_LABELS: Record<AnalysisAction, string> = {
  squat: '深蹲',
  deadlift: '硬拉',
  running: '跑姿'
}

/** 可改判的范围：跑姿由步态特征判定，特征强，不提供手动改判 */
const switchableActions: { id: AnalysisAction; label: string }[] = [
  { id: 'squat', label: '深蹲' },
  { id: 'deadlift', label: '硬拉' }
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
/** 本次分析已保存的记录 id；改判重跑时先删掉它，避免同一段视频留两条结果 */
const savedRecordId = ref<string | null>(null)

const busy = computed(() => phase.value === 'precheck')
const actionLabel = computed(() => ACTION_LABELS[action.value])
const otherActionLabel = computed(() => action.value === 'squat' ? '硬拉' : '深蹲')
/** 力量动作二分允许改判；跑姿不提供 */
const canSwitchAction = computed(() =>
  action.value === 'squat' || (action.value === 'deadlift' && precheckResult.value !== null)
)
const viewLabel = (view: AnalysisView | null) => view === 'side' ? '侧面' : view === 'front' ? '正面' : '未知'

/** 用户改判后同步检查结果：清除特征不明确/重复数这些跟动作绑定的口径 */
function applySwitchedAction(next: AnalysisAction) {
  action.value = next
  if (!precheckResult.value) return
  const reasons = precheckResult.value.reasons.filter(reason => !reason.includes('深蹲与硬拉'))
  precheckResult.value = {
    ...precheckResult.value,
    action: next,
    actionConfident: true,
    repCount: precheckResult.value.action === next ? precheckResult.value.repCount : null,
    reasons
  }
}

function switchAction(next: AnalysisAction) {
  if (next === action.value) return
  applySwitchedAction(next)
}

async function switchAndRerun() {
  if (savedRecordId.value) store.removeAnalysis(savedRecordId.value)
  savedRecordId.value = null
  result.value = null
  applySwitchedAction(action.value === 'squat' ? 'deadlift' : 'squat')
  revokeKeyframeUrls()
  await startAnalysis()
}

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
  savedRecordId.value = null
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
    precheckResult.value = await precheck()
    action.value = precheckResult.value.action ?? 'squat'
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
  savedRecordId.value = id
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
.page { max-width: 980px; margin: 0 auto; display: flex; flex-direction: column; gap: 12px; }

/* 页头：运动极身份 + 端侧处理 */
.an-hero { padding: 2px 2px 1px; }
.an-hero-top { display: flex; align-items: center; flex-wrap: wrap; gap: 9px; }
.an-id { display: flex; align-items: center; gap: 9px; flex: 1; min-width: 0; }
.an-id :deep(svg) { width: 30px; height: 30px; flex: none; overflow: visible; }
.micro { display: block; font-family: var(--font-num); font-size: 8.5px; font-weight: 600; letter-spacing: .14em; color: var(--color-text-muted); }
.micro.move { color: var(--pole-movement-strong); }
.an-id h1 { margin: 2px 0 0; font-size: 26px; line-height: 1.1; letter-spacing: -.03em; }
.an-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 23px;
  padding: 0 8px;
  flex: none;
  border: 1px solid var(--pole-movement-line);
  border-radius: var(--radius-sm);
  background: var(--pole-movement-soft);
  font-family: var(--font-num);
  font-size: 9px;
  font-weight: 600;
  color: var(--pole-movement-strong);
  white-space: nowrap;
}
.an-chip i { width: 5px; height: 5px; border-radius: 50%; background: currentColor; }
.an-kicker { display: block; margin-top: 12px; font-family: var(--font-num); font-size: 8.5px; font-weight: 600; letter-spacing: .16em; color: var(--color-text-muted); }
.an-lead { margin: 5px 0 0; font-size: 26px; line-height: 1.16; letter-spacing: -.035em; font-weight: 600; }
.an-lead em { font-style: normal; color: var(--pole-movement); letter-spacing: -.04em; }
.an-lead span { font-family: var(--font); font-size: 13px; font-weight: 500; letter-spacing: 0; color: var(--color-text-muted); }
.an-sub { margin: 6px 0 0; font-size: 11px; line-height: 1.65; color: var(--color-text-secondary); }

/* 选择动作、上传、历史 */
.an-card {
  padding: 13px 14px 14px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xl);
  background: var(--color-card);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, .9);
}
.an-card-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding-bottom: 8px; border-bottom: 1px solid var(--color-divider); margin-bottom: 10px; }
.an-card-head h2 { margin: 0; font-size: 14px; font-weight: 600; letter-spacing: -.005em; }
.an-card-head > span { font-family: var(--font-num); font-size: 8.5px; letter-spacing: .04em; color: var(--color-text-muted); white-space: nowrap; }
.switch-group { display: inline-flex; gap: 5px; margin-left: 8px; vertical-align: middle; }
.switch-chip {
  padding: 3px 10px;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  background: var(--color-card);
  color: var(--color-text-secondary);
  font-family: inherit;
  font-size: 10.5px;
  font-weight: 600;
  cursor: pointer;
  transition: border-color var(--motion-fast), background var(--motion-fast);
}
.switch-chip:hover { border-color: var(--pole-movement-line); }
.switch-chip.on { border-color: var(--pole-movement-line); background: var(--pole-movement-soft); color: var(--pole-movement-strong); }
.an-upload { display: flex; align-items: center; gap: 9px; margin-top: 8px; padding: 9px 10px; border: 1px dashed var(--hair-strong); border-radius: var(--radius-lg); background: var(--surface-field); }
.an-upload-ic { width: 30px; height: 30px; flex: none; display: grid; place-items: center; border-radius: var(--radius-base); background: var(--color-card); border: 1px solid var(--color-border); color: var(--pole-movement-strong); }
.an-upload-copy { flex: 1; min-width: 0; }
.an-upload-copy strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 10.5px; font-weight: 600; }
.an-upload-copy span { display: block; margin-top: 2px; font-size: 8.5px; color: var(--color-text-muted); }
.an-pick { flex: none; height: 29px; padding: 0 10px; border: 0; border-radius: var(--radius-base); background: var(--color-ink); color: var(--color-on-accent); font-family: inherit; font-size: 10px; font-weight: 600; cursor: pointer; }
.an-pick:disabled { opacity: .55; cursor: default; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); border: 0; }
.an-progress { display: flex; flex-direction: column; gap: 6px; margin-top: 10px; font-size: 10px; color: var(--color-text-muted); }
.bar { height: 6px; border-radius: 999px; background: var(--color-neutral-soft); overflow: hidden; box-shadow: inset 0 0 0 1px var(--color-border); }
.bar.big { height: 10px; margin: 14px 0; }
.bar i { display: block; height: 100%; background: var(--color-ink); transition: width var(--motion-fast); }
.error-line { margin: 10px 0 0; color: var(--color-danger); font-size: 11px; line-height: 1.6; }
.error-list { margin: 0 0 12px; padding-left: 18px; color: var(--color-danger); font-size: 12.5px; line-height: 1.8; }
.an-inline-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 9px; }
.an-guide { margin-top: 10px; padding-top: 9px; border-top: 1px solid var(--color-divider); font-size: 10px; color: var(--color-text-secondary); }
.an-guide summary { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px; cursor: pointer; list-style: none; }
.an-guide summary::-webkit-details-marker { display: none; }
.an-guide summary span { font-weight: 600; color: var(--color-text-secondary); }
.an-guide summary small { font-size: 8.5px; line-height: 1.5; color: var(--color-text-muted); }
.an-guide ul { margin: 8px 0 0; padding-left: 16px; line-height: 1.8; color: var(--color-text-muted); }
.an-history { list-style: none; margin: 0; padding: 0; }
.an-history li { border-top: 1px solid var(--color-divider); }
.an-history li:first-child { border-top: 0; }
.an-history-link { display: flex; align-items: center; gap: 9px; padding: 8px 0; color: inherit; text-decoration: none; }
.an-history-link:hover .an-h-main strong { color: var(--pole-movement-strong); }
.an-h-ic { width: 28px; height: 28px; flex: none; display: grid; place-items: center; border: 1px solid var(--pole-movement-line); border-radius: var(--radius-base); background: var(--pole-movement-soft); color: var(--pole-movement-strong); }
.an-h-main { flex: 1; min-width: 0; }
.an-h-main strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 10.5px; font-weight: 600; }
.an-h-main small { display: block; margin-top: 1px; font-size: 8.5px; color: var(--color-text-muted); }
.an-h-chev { flex: none; color: var(--color-text-muted); }
.an-empty { margin: 2px 0 0; font-size: 10px; color: var(--color-text-muted); }
.an-flow { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; padding: 10px 2px 2px; border-top: 1px dashed var(--color-border); }
.an-flow > div { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.an-flow .num { font-family: var(--font-num); font-size: 8px; letter-spacing: .08em; color: var(--pole-movement-strong); }
.an-flow b { font-size: 9.5px; font-weight: 600; color: var(--color-text-secondary); }
.an-flow small { font-size: 8px; line-height: 1.5; color: var(--color-text-muted); }

/* 处理中 / 结果 / 失败沿用同一张卡片语言 */
.panel { padding: 15px 16px; border-radius: var(--radius-xl); }
.panel h2 { margin: 0 0 12px; font-size: 16px; }
.muted { margin: 0; color: var(--color-text-muted); font-size: 13px; line-height: 1.7; }
.guide { margin-top: 14px; font-size: 12px; color: var(--color-text-secondary); }
.guide summary { cursor: pointer; font-weight: 600; }
.guide ul { margin: 8px 0 0; padding-left: 18px; line-height: 1.8; color: var(--color-text-muted); }
.summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 12px; margin: 0 0 12px; }
.summary div { padding: 10px 12px; border-radius: var(--radius-md); background: var(--color-neutral-soft); }
.summary dt { font-size: 11px; color: var(--color-text-muted); }
.summary dd { margin: 3px 0 0; font-size: 15px; font-weight: 700; }
.warn-panel { border-color: var(--color-caution); background: var(--color-caution-soft); }
.warn-list { margin: 8px 0 0; padding-left: 18px; color: var(--color-caution); font-size: 12.5px; line-height: 1.8; }
.actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 14px; }
.result-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; padding: 2px 2px 0; }
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

@media (max-width: 767px) {
  .page { gap: 10px; }
  .an-hero { padding: 2px 2px 1px; }
  .an-id h1 { font-size: 24px; }
  .an-lead { font-size: 24px; }
  .an-card { padding: 12px 13px 13px; }
  .an-actions { gap: 5px; }
  .an-actions button { padding: 7px; }
  .an-actions button span { font-size: 10px; }
  .an-upload { align-items: flex-start; }
  .an-pick { align-self: center; }
  .panel { padding: 14px; }
  .an-flow { gap: 7px; }
}
</style>
