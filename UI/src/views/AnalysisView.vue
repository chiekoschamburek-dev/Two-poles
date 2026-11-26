<template>
  <div class="page">
    <PageHeader
      pole="movement"
      title="动作分析"
      kicker="ANALYSIS · 训练后复盘"
      subtitle="从相册选视频，本机逐帧分析；输出问题清单与关键帧。"
      flush
    >
      <template #actions>
        <span class="an-chip"><i aria-hidden="true"></i>端侧处理</span>
        <StatusBadge v-if="step === 'result' && precheckResult" :variant="precheckResult.verdict === 'degraded' ? 'warning' : 'success'">
          {{ precheckResult.verdict === 'degraded' ? '低置信度结果' : '分析完成' }}
        </StatusBadge>
      </template>
      <template #lead>逐帧看 <em>动作</em><span>，不评分</span></template>
    </PageHeader>

    <template v-if="step === 'pick' || step === 'error'">
      <section class="an-card">
        <div class="an-card-head">
          <h2>选择视频</h2>
          <span>{{ explanationEnabled ? '视频本机处理 · 解读上传数值' : '本地 · 不上传' }}</span>
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

        <div class="supported" aria-label="可分析动作">
          <span class="supported-label">可分析动作</span>
          <ul class="supported-list">
            <li v-for="item in templates" :key="item.id">
              <strong>{{ item.label }}</strong>
              <small>{{ kindLabel(item.kind) }} · {{ viewsLabel(item.views) }} · {{ item.findingsReady ? '关注项' : '只测量' }}</small>
            </li>
          </ul>
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
            <li>分析只在本机进行；视频不会上传，也不会保存。{{ store.privacy.saveMotionSeriesLocally ? '已开启「保存动作数据」时，关节角度等测量数据会保存在本机。' : '' }}</li>
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

      <MotionTrendCard v-for="trend in motionTrends" :key="trend.action" :trend="trend" />

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
              <template v-if="action === 'running'">自动识别：{{ actionLabel }}<span v-if="!actionConfirmed">（存疑，可按跑姿分析）</span></template>
              <template v-else-if="actionConfirmed">自动识别：{{ actionLabel }}</template>
              <template v-else>自动识别不确定：请选择实际动作</template>
              <span v-if="canSwitchAction" class="switch-group" role="group" aria-label="切换动作">
                <button
                  v-for="item in templates"
                  :key="item.id"
                  type="button"
                  class="switch-chip"
                  :class="{ on: action === item.id }"
                  :aria-pressed="action === item.id"
                  @click="chooseAction(item.id)"
                >{{ item.label }}<small v-if="!item.findingsReady" class="chip-note">只测量</small></button>
              </span>
            </dd>
          </div>
          <div><dt>视角</dt><dd>{{ viewLabel(precheckResult.view) }}</dd></div>
          <div><dt>{{ countLabel }}</dt><dd>{{ countValue }}</dd></div>
          <div><dt>时长</dt><dd>{{ duration.toFixed(1) }} 秒</dd></div>
          <div v-if="analyzedRangeLabel"><dt>分析区间</dt><dd>{{ analyzedRangeLabel }}</dd></div>
        </dl>
        <p v-if="needsActionConfirmation" class="manual-warning" role="status">自动识别不确定：请选择一个动作；未选择前不会开始分析。</p>
        <p v-if="!supportsFindings" class="muted">该动作目前只提供测量值，未配置文献阈值，不出关注项。</p>
        <ul v-if="precheckResult.verdict === 'degraded'" class="warn-list">
          <li v-for="reason in precheckResult.reasons" :key="reason">{{ reason }}</li>
        </ul>
        <div class="actions">
          <BaseButton :disabled="!canStartAnalysis" @click="startAnalysis"><Play :size="16" />{{ canStartAnalysis ? '开始分析' : '先选择动作' }}</BaseButton>
          <BaseButton variant="ghost" @click="resetAll">换一个视频</BaseButton>
        </div>
      </BaseCard>
    </template>

    <BaseCard v-else-if="step === 'view-pick' && precheckResult" class="panel">
      <h2>先确认拍摄视角</h2>
      <p class="muted">将按「{{ actionLabel }}」分析。人体和动作都识别到了，只是机位判不准；请按这条视频的实际拍摄方向选一个，规则会随视角切换。</p>
      <p v-if="precheckResult.suggestedView" class="muted">
        看起来更接近{{ viewLabel(precheckResult.suggestedView) }}（只是建议，以实际机位为准）；选择后结果按低置信度标注。
      </p>
      <div v-if="canSwitchAction" class="switch-group" role="group" aria-label="切换动作">
        <button
          v-for="item in templates"
          :key="item.id"
          type="button"
          class="switch-chip"
          :class="{ on: action === item.id }"
          :aria-pressed="action === item.id"
          @click="chooseAction(item.id)"
        >{{ item.label }}</button>
      </div>
      <div class="actions">
        <BaseButton v-if="actionTemplate.views.includes('side')" variant="secondary" @click="chooseView('side')">按侧面分析</BaseButton>
        <BaseButton v-if="actionTemplate.views.includes('front')" variant="secondary" @click="chooseView('front')">按正面分析</BaseButton>
        <BaseButton v-if="actionTemplate.views.includes('oblique')" variant="secondary" @click="chooseView('oblique')">按斜侧分析</BaseButton>
      </div>
      <div class="actions">
        <BaseButton variant="ghost" @click="resetAll">换一个视频</BaseButton>
      </div>
    </BaseCard>

    <BaseCard v-else-if="step === 'analyzing'" class="panel" aria-live="polite">
      <h2>{{ rechecking ? '正在重新检查' : '正在分析' }}</h2>
      <p class="muted">{{ rechecking
        ? '正在按所选动作重新采样视频，完成后才能开始分析……'
        : (saving ? '正在保存关键帧……' : (statusText || '正在逐帧分析……')) }}</p>
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
      <div v-if="canSwitchAction" class="actions">
        <span class="muted">或换一个动作重新检查：</span>
        <button
          v-for="item in templates"
          :key="item.id"
          type="button"
          class="switch-chip"
          :class="{ on: action === item.id }"
          :disabled="action === item.id"
          @click="chooseAction(item.id)"
        >{{ item.label }}</button>
      </div>
    </BaseCard>

    <template v-else-if="step === 'result' && result && precheckResult">
      <div class="result-head">
        <div>
          <span class="micro">RESULT</span>
          <h2>{{ actionLabel }} · {{ viewLabel(precheckResult.view) }}视角</h2>
          <p>{{ resultSummary }}</p>
          <p v-if="analyzedRangeLabel" class="muted small">分析区间 {{ analyzedRangeLabel }}{{ analyzedRangeNote }}</p>
          <p v-if="!supportsFindings && actionTemplate.note" class="muted small">{{ actionTemplate.note }}</p>
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
        <p v-if="!supportsFindings" class="muted">该动作目前只提供测量值，未配置文献阈值，不出关注项。下面是对这次动作的客观测量。</p>
        <p v-else-if="!result.findings.length" class="muted">本次没有命中关注项。下面是对这次动作的客观测量。</p>
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
            <div v-if="finding.confidence !== undefined">
              <dt>置信</dt>
              <dd>
                <span class="conf" :class="{ low: finding.confidence < 0.5 }">
                  {{ finding.confidence.toFixed(2) }}{{ finding.confidence < 0.5 ? ' · 仅供参考' : '' }}
                </span>
              </dd>
            </div>
          </dl>
        </article>
      </BaseCard>

      <KinematicsPanel
        v-if="hasKinematicsCard"
        :kinematics="result.kinematics ?? null"
        :angles="angleSamples"
        :metrics="result.metrics"
        :action="action"
        :fps="result.fps"
        :marker-times="markerTimes"
        @seek="seekToFinding"
      />
      <p v-if="hasKinematicsCard" class="curve-note">
        {{ seriesSaved ? '角度与运动学数据已保存在本机，可在设置关闭。' : '角度与运动学曲线仅在本次会话内存中，未落盘。' }}
      </p>

      <BaseCard v-if="report" class="panel">
        <div class="explain-head">
          <h2>解读</h2>
          <button type="button" class="switch-chip" :class="{ on: explanationEnabled }" :aria-pressed="explanationEnabled" @click="toggleExplanation">
            {{ explanationEnabled ? '已开启' : '开启模型解读' }}
          </button>
        </div>
        <p class="explain-note">
          {{ explanationEnabled
            ? '规则结论已判定完毕，模型只把测量结果换一种说法；开启后仅上传测量数值，不上传视频或画面。'
            : '默认关闭。开启后会把测量数值（不含视频与画面）发到所配置的模型，用于把结论改写得更易读。' }}
        </p>
        <p v-if="!report.lines.length" class="muted">{{ supportsFindings
          ? '本次没有命中关注项，没有需要解读的结论。下面是客观测量值。'
          : '该动作只提供测量值，没有关注项可解读。下面是客观测量值。' }}</p>
        <p v-if="explaining" class="muted">正在生成解读……规则文案已可用。</p>
        <article v-for="line in report.lines" :key="line.id" class="explain-line">
          <strong>{{ line.title }}</strong>
          <p>{{ line.text }}</p>
          <span class="engine-tag">{{ line.engine === 'llm' ? '模型改写' : '规则原文' }}</span>
        </article>
        <p class="disclaimer">{{ report.disclaimer }}</p>
      </BaseCard>

      <BaseCard v-if="nonKinematicsMetrics.length" class="panel">
        <h2>测量值</h2>
        <p v-if="!supportsFindings" class="muted small">这些数值没有阈值，不判断好坏；拍摄视角、遮挡与器械会直接影响读数。</p>
        <dl class="metrics">
          <div v-for="metric in nonKinematicsMetrics" :key="metric.id">
            <dt>{{ metric.label }}</dt>
            <dd>{{ metric.value }}<small v-if="metric.unit"> {{ metric.unit }}</small></dd>
          </div>
        </dl>
      </BaseCard>
      <p v-else class="curve-note">运动学指标见上方。</p>

      <p class="disclaimer">{{ disclaimer }}</p>
      <div class="actions">
        <details v-if="canSwitchAction" class="rerun-picker">
          <summary class="switch-chip">识别错了？换一个动作重新分析</summary>
          <div class="switch-group">
            <button
              v-for="item in templates"
              :key="item.id"
              type="button"
              class="switch-chip"
              :class="{ on: action === item.id }"
              :disabled="action === item.id"
              @click="chooseAction(item.id, true)"
            >{{ item.label }}</button>
          </div>
        </details>
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
import PageHeader from '@/components/common/PageHeader.vue'
import StatusBadge from '@/components/common/StatusBadge.vue'
import { useAppStore } from '@/stores/app'
import { useVideoAnalysis, VideoAnalysisError } from '@/composables/useVideoAnalysis'
import { MOTION_RULES_VERSION } from '@/services/motionRules'
import { saveAnalysisKeyframe } from '@/services/analysisKeyframes'
import KinematicsPanel from '@/components/analysis/KinematicsPanel.vue'
import MotionTrendCard from '@/components/reports/MotionTrendCard.vue'
import { buildAllTrends } from '@/services/motionTrends'
import { useMotionExplanation } from '@/composables/useMotionExplanation'
import { buildSeriesRecord, saveMotionSeries } from '@/services/motionSeries'
import { eventsFromFrames } from '@/services/motionEvents'
import { repRuleForTemplate, requiresActionConfirmation, templateFor, visibleTemplates } from '@/services/motionTemplates'
import { isKinematicsMetric } from '@/services/motionKinematics'
import type { MotionAngleSample } from '@/types/domain'
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

type Step = 'pick' | 'prechecked' | 'view-pick' | 'analyzing' | 'result' | 'rejected' | 'error'

const templates = visibleTemplates()

const disclaimer = '规则参考各关注项所列文献，阈值由本项目自行翻译，未经运动医学或体能专业人士审核；结果仅供复盘参考，不构成诊断或训练处方。'

const { phase, progress, statusText, duration, prepare, precheck, analyze, captureKeyframes, cancel, dispose, capturedFrames } = useVideoAnalysis()
const store = useAppStore()

const step = ref<Step>('pick')
const action = ref<AnalysisAction>('squat')
/** 自动识别不可信时，必须由用户明确选一个动作才能开始分析 */
const actionConfirmed = ref(false)
/** 换动作后正在按新模板重新预检；这期间不允许开始分析，避免拿旧口径起跑 */
const rechecking = ref(false)
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
const angleSamples = ref<MotionAngleSample[]>([])
const seriesSaved = ref(false)
const explanation = useMotionExplanation()
const motionTrends = computed(() => buildAllTrends(store.analyses, store.sessions))

const nonKinematicsMetrics = computed(() => (result.value?.metrics ?? []).filter(metric => !isKinematicsMetric(metric)))
const hasKinematicsCard = computed(() => actionTemplate.value.kinematics && (Boolean(result.value?.kinematics)
  || angleSamples.value.length > 0
  || (result.value?.metrics ?? []).some(isKinematicsMetric)))
const markerTimes = computed(() => (result.value?.findings ?? [])
  .map(finding => finding.timeMs)
  .filter((time): time is number => time !== null))
const report = explanation.report
const explaining = explanation.explaining
const explanationEnabled = computed(() => explanation.settings.value.enabled)

function toggleExplanation() {
  explanation.setEnabled(!explanationEnabled.value)
  if (explanationEnabled.value) void explanation.explain()
}

function seekToFinding(timeMs: number) {
  const match = (result.value?.findings ?? []).find(finding => finding.timeMs === timeMs)
  if (match?.keyframeRef && keyframeUrls.value[match.keyframeRef]) {
    window.open(keyframeUrls.value[match.keyframeRef], '_blank', 'noopener')
  }
}

const busy = computed(() => phase.value === 'precheck')
const actionTemplate = computed(() => templateFor(action.value))
const actionLabel = computed(() => actionTemplate.value.label)
const supportsFindings = computed(() => actionTemplate.value.findingsReady)
/** 跑姿由步态特征判定，特征强，不提供改判；其余模板可在预检/结果页换 */
const canSwitchAction = computed(() => !!precheckResult.value && action.value !== 'running')
/** 自动识别不可信时，必须由用户选一个动作；跑姿没有动作选择器，允许按跑姿分析 */
const needsActionConfirmation = computed(() => requiresActionConfirmation(action.value, actionConfirmed.value))
const canStartAnalysis = computed(() => !needsActionConfirmation.value && !rechecking.value)
const countLabel = computed(() =>
  actionTemplate.value.kind === 'gait' ? '步态周期' : actionTemplate.value.kind === 'hold' ? '保持区间' : '完整重复'
)
const countValue = computed(() => {
  if (!precheckResult.value) return '—'
  if (precheckResult.value.gaitCycles !== null) return `${precheckResult.value.gaitCycles} 个`
  if (precheckResult.value.holdSeconds !== null && precheckResult.value.holdSeconds !== undefined) {
    return `${precheckResult.value.holdSeconds} 秒`
  }
  if (precheckResult.value.repCount !== null) return `${precheckResult.value.repCount} 次`
  return '—'
})
const viewLabel = (view: AnalysisView | null) => view === 'side' ? '侧面' : view === 'front' ? '正面' : view === 'oblique' ? '斜侧' : '未知'
/** 换动作重跑时，只保留与具体动作无关的原因（可见度、手动视角等） */
function carryOverReasons(reasons: string[]): string[] {
  const actionMarkers = ['未识别到完整重复', '深蹲与硬拉', '步态周期不足', '跑步步态特征',
    '静态保持区间不足', '动作特征不明确', '已按深蹲预检']
  return reasons.filter(reason => !actionMarkers.some(marker => reason.includes(marker)))
}
const kindLabel = (kind: string) => kind === 'gait' ? '步态' : kind === 'hold' ? '静态保持' : '计次'
const viewsLabel = (views: AnalysisView[]) => views.map(view => viewLabel(view)).join(' / ')
const resultSummary = computed(() => {
  if (!result.value) return '已完成分析'
  if (result.value.repCount !== null) return `识别到 ${result.value.repCount} 次完整重复`
  if (result.value.gaitCycles !== null) return `识别到 ${result.value.gaitCycles} 个步态周期`
  if (result.value.holdSeconds !== null && result.value.holdSeconds !== undefined) {
    return `分析区间 ${Math.round(result.value.holdSeconds * 10) / 10} 秒`
  }
  return '已完成分析'
})
/** 分析区间：V2 先粗扫找活跃段，结论要如实说明覆盖了哪几秒 */
const analyzedRangeLabel = computed(() => {
  const range = result.value?.analyzedRange ?? precheckResult.value?.analyzedRange ?? null
  if (!range) return ''
  const seconds = (ms: number) => (Math.max(0, ms) / 1000).toFixed(1)
  return `${seconds(range.startMs)}–${seconds(range.endMs)} 秒`
})
const analyzedRangeNote = computed(() => {
  const range = result.value?.analyzedRange ?? precheckResult.value?.analyzedRange ?? null
  if (!range) return ''
  return range.source === 'whole-clip' ? '（未找到稳定活跃段，按全片统计）' : '（只统计活跃运动段）'
})

/**
 * 自动视角判不准时的兜底：用户点一下机位，按所选视角继续。
 * 这不是「猜对了」——降级标注保留，结果页会写明视角由用户指定。
 */
function chooseView(view: AnalysisView) {
  if (!precheckResult.value) return
  precheckResult.value = {
    ...precheckResult.value,
    view,
    verdict: 'degraded',
    reasons: [
      ...precheckResult.value.reasons.filter(reason => !reason.includes('无法自动判定拍摄视角')),
      `视角由你手动指定为${viewLabel(view)}，结果按低置信度标注`
    ]
  }
  step.value = 'prechecked'
}

/**
 * 选动作：预检阶段重新预检，保证次数/步态/保持区间与所选模板一致；
 * 结果页换动作则直接按当前视角重跑，旧记录与关键帧先删掉，避免一段视频留两条结果。
 */
async function chooseAction(next: AnalysisAction, rerun = false) {
  if (next === action.value && actionConfirmed.value) return
  if (savedRecordId.value) {
    store.removeAnalysis(savedRecordId.value)
    savedRecordId.value = null
  }
  revokeKeyframeUrls()
  result.value = null
  action.value = next
  actionConfirmed.value = true
  if (!selectedFile.value || !precheckResult.value) return
  const nextTemplate = templateFor(next)
  if (rerun && precheckResult.value.view && nextTemplate.views.includes(precheckResult.value.view)) {
    const carried = carryOverReasons(precheckResult.value.reasons)
    precheckResult.value = {
      ...precheckResult.value,
      action: next,
      actionConfident: true,
      repCount: null,
      gaitCycles: null,
      holdSeconds: null,
      reasons: carried,
      verdict: carried.length ? 'degraded' : 'ok'
    }
    await startAnalysis()
    return
  }
  // 先清掉上一模板的次数/原因，避免重新预检期间继续显示“深蹲 0 次”这类旧口径
  precheckResult.value = {
    ...precheckResult.value,
    action: next,
    actionConfident: true,
    repCount: null,
    gaitCycles: null,
    holdSeconds: null,
    reasons: [],
    verdict: 'ok'
  }
  rechecking.value = true
  step.value = 'analyzing'
  try {
    precheckResult.value = await precheck(next)
    actionConfirmed.value = true
    const verdict = precheckResult.value.verdict
    step.value = verdict === 'rejected'
      ? 'rejected'
      : verdict === 'view-unclear'
        ? 'view-pick'
        : 'prechecked'
  } catch (error) {
    if (isCancelled(error)) return
    errorMessage.value = messageOf(error)
    step.value = 'error'
  } finally {
    rechecking.value = false
  }
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
  actionConfirmed.value = false
  rechecking.value = false
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
    actionConfirmed.value = precheckResult.value.actionConfident
    const verdict = precheckResult.value.verdict
    step.value = verdict === 'rejected'
      ? 'rejected'
      : verdict === 'view-unclear'
        ? 'view-pick'
        : 'prechecked'
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
    usableRatio: Math.round(analysisResult.usableRatio * 100) / 100,
    ruleVersion: MOTION_RULES_VERSION,
    createdAt: new Date().toISOString(),
    _sync: 'pending'
  }
  store.addAnalysis(record)
  savedRecordId.value = id
  return { ...analysisResult, findings }
}

/** 只有用户显式开启「保存动作数据」才落盘；画面与视频始终不保存 */
async function persistSeries(analysisResult: MotionAnalysisResult, view: AnalysisView) {
  seriesSaved.value = false
  if (!store.privacy.saveMotionSeriesLocally) return
  const id = savedRecordId.value
  if (!id) return
  const frames = capturedFrames()
  const fps = analysisResult.fps
  if (!frames.length || !fps) return
  const template = templateFor(action.value)
  const rule = repRuleForTemplate(template)
  const events = rule && template.segmentation
    ? eventsFromFrames(frames, rule, template.segmentation.joint).events
    : []
  try {
    seriesSaved.value = await saveMotionSeries(buildSeriesRecord({
      key: id,
      savedAt: new Date().toISOString(),
      fps,
      action: action.value,
      view,
      ruleVersion: MOTION_RULES_VERSION,
      usableRatio: analysisResult.usableRatio,
      frames,
      angles: analysisResult.angles ?? [],
      reps: analysisResult.reps ?? [],
      events,
      ...(analysisResult.kinematics ? { kinematics: analysisResult.kinematics } : {})
    }))
  } catch {
    // 配额不足或隐私模式：曲线仍可用内存数据渲染，不影响分析结果
  }
}

function reconcilePrecheck(analysisResult: MotionAnalysisResult) {
  if (!precheckResult.value) return
  const template = templateFor(action.value)
  let reasons = precheckResult.value.reasons
  if (template.kind === 'gait' && analysisResult.gaitCycles !== null) {
    reasons = reasons.filter(reason => !reason.includes('步态周期不足'))
    if (analysisResult.gaitCycles < 5) {
      reasons.push(`步态周期不足（识别到 ${analysisResult.gaitCycles} 个，至少 5 个），结果置信度低`)
    }
  } else if (template.kind === 'reps' && analysisResult.repCount !== null) {
    reasons = reasons.filter(reason => !reason.includes('未识别到完整重复'))
    if (analysisResult.repCount === 0) {
      reasons.push('未识别到完整重复动作：请完整拍摄至少 1 次动作后重试')
    }
  } else if (template.kind === 'hold' && analysisResult.holdSeconds !== null && analysisResult.holdSeconds !== undefined) {
    reasons = reasons.filter(reason => !reason.includes('静态保持区间不足'))
    if (analysisResult.holdSeconds < 3) {
      reasons.push('静态保持区间不足 3 秒：请拍摄完整的支撑过程后重试')
    }
  }
  precheckResult.value = {
    ...precheckResult.value,
    action: action.value,
    actionConfident: true,
    gaitCycles: analysisResult.gaitCycles ?? precheckResult.value.gaitCycles,
    repCount: analysisResult.repCount ?? precheckResult.value.repCount,
    holdSeconds: analysisResult.holdSeconds ?? precheckResult.value.holdSeconds,
    reasons,
    verdict: reasons.length ? 'degraded' : 'ok'
  }
}

async function startAnalysis() {
  const view = precheckResult.value?.view
  if (!view || needsActionConfirmation.value) return
  rechecking.value = false
  step.value = 'analyzing'
  errorMessage.value = ''
  try {
    const analysisResult = await analyze(action.value, view)
    reconcilePrecheck(analysisResult)
    angleSamples.value = analysisResult.angles ?? []
    saving.value = true
    result.value = await persistResult(analysisResult, view)
    await persistSeries(analysisResult, view)
    saving.value = false
    step.value = 'result'
    explanation.prepare({
      action: action.value,
      findings: result.value.findings,
      metrics: result.value.metrics,
      repCount: result.value.repCount,
      gaitCycles: result.value.gaitCycles,
      holdSeconds: result.value.holdSeconds ?? null
    })
    if (explanationEnabled.value) void explanation.explain()
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
  rechecking.value = false
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
.page { max-width: var(--page-max-width); margin: 0 auto; display: flex; flex-direction: column; gap: 12px; }

/* 页头由 PageHeader 统一负责；这里只留本页特有的「端侧处理」小标 */
.micro { display: block; font-family: var(--font-num); font-size: 8.5px; font-weight: 600; letter-spacing: .14em; color: var(--color-text-muted); }
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
  min-height: var(--target-size);
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
.switch-chip:disabled { opacity: .45; cursor: not-allowed; }
.chip-note { margin-left: 4px; font-size: 8px; color: var(--color-text-muted); }
.supported { margin-top: 12px; padding: 10px 12px; border: 1px solid var(--hair-soft); border-radius: var(--radius-md); background: var(--surface-field); }
.supported-label { display: block; font-family: var(--font-num); font-size: 8.5px; letter-spacing: .12em; text-transform: uppercase; color: var(--color-text-muted); margin-bottom: 6px; }
.supported-list { display: flex; flex-wrap: wrap; gap: 6px 14px; list-style: none; margin: 0; padding: 0; }
.supported-list li { display: flex; align-items: baseline; gap: 5px; min-width: 0; }
.supported-list strong { font-size: 11px; color: var(--color-ink); font-weight: 600; }
.supported-list small { font-size: 9px; color: var(--color-text-muted); }
.manual-warning { margin: 8px 0 0; padding: 8px 10px; border-radius: var(--radius-sm); background: var(--color-caution-soft); color: var(--color-caution); font-size: 11.5px; line-height: 1.7; }
.rerun-picker { display: inline-block; }
.rerun-picker summary { list-style: none; display: inline-flex; align-items: center; }
.rerun-picker summary::-webkit-details-marker { display: none; }
.rerun-picker .switch-group { display: flex; flex-wrap: wrap; margin: 8px 0 0; }
.an-upload { display: flex; align-items: center; gap: 9px; margin-top: 8px; padding: 9px 10px; border: 1px dashed var(--hair-strong); border-radius: var(--radius-lg); background: var(--surface-field); }
.an-upload-ic { width: 30px; height: 30px; flex: none; display: grid; place-items: center; border-radius: var(--radius-base); background: var(--color-card); border: 1px solid var(--color-border); color: var(--pole-movement-strong); }
.an-upload-copy { flex: 1; min-width: 0; }
.an-upload-copy strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 10.5px; font-weight: 600; }
.an-upload-copy span { display: block; margin-top: 2px; font-size: 8.5px; color: var(--color-text-muted); }
.an-pick { flex: none; min-height: var(--target-size); padding: 0 12px; border: 0; border-radius: var(--radius-base); background: var(--color-ink); color: var(--color-on-accent); font-family: inherit; font-size: 10px; font-weight: 600; cursor: pointer; }
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
.conf { font-family: var(--font-num); font-variant-numeric: tabular-nums; font-weight: 600; color: var(--pole-movement-strong); }
.conf.low { color: var(--color-text-muted); font-weight: 500; }
.curve-note { font-size: 9.5px; color: var(--color-text-muted); margin-left: auto; }
.explain-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 8px; }
.explain-head h2 { margin: 0; font-size: 16px; }
.explain-note { margin: 0 0 10px; font-size: 11px; line-height: 1.7; color: var(--color-text-muted); }
.explain-line { padding: 10px 0; border-top: 1px solid var(--color-divider); }
.explain-line strong { font-size: 13px; }
.explain-line p { margin: 4px 0 6px; font-size: 13px; line-height: 1.75; color: var(--color-text-secondary); }
.engine-tag { display: inline-block; padding: 1px 7px; border: 1px solid var(--color-border); border-radius: 999px; font-family: var(--font-num); font-size: 8.5px; font-weight: 600; color: var(--color-text-muted); }

@media (max-width: 767px) {
  .page { gap: 10px; }
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
