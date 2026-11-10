<template>
  <div class="execution-page">
    <div class="page-header">
      <div>
        <span class="micro kick"><i></i>训练跟练</span>
        <h1>{{ trainingMode ? `${exercise.name} · 第 ${displaySet} 组` : '选择跟练方式' }}</h1>
        <p v-if="trainingMode === 'camera'">摄像头在本次跟练中持续开启。画面只在本机处理。</p>
        <p v-else-if="trainingMode === 'timer'">计时与语音 · 摄像头关闭</p>
        <p v-if="trainingMode && trainingItems.length > 1" class="queue-progress">
          第 {{ itemIndex + 1 }} / {{ trainingItems.length }} 项<template v-if="nextItem && !finished"> · 下一项 {{ nextItem.exerciseName }}</template>
        </p>
      </div>
      <BaseButton variant="secondary" :icon="X" @click="leave">结束</BaseButton>
    </div>

    <BaseCard v-if="!trainingMode" class="guide-picker">
      <h2>{{ planDate }} 的训练计划</h2>
      <ol v-if="plannedItems.length" class="guide-queue">
        <li v-for="item in plannedItems" :key="item.id">
          <strong>{{ item.exerciseName }}</strong>
          <span v-if="planItemSpec(item)"> · {{ planItemSpec(item) }}</span>
          <span v-if="item.completed"> · 已完成</span>
        </li>
      </ol>
      <div class="guide-actions">
        <BaseButton :icon="Camera" :disabled="pendingItems.length > 0 && !store.privacy.cameraEnabled" @click="startTraining('camera')">摄像头跟练</BaseButton>
        <BaseButton variant="secondary" :icon="Play" @click="startTraining('timer')">计时与语音</BaseButton>
      </div>
      <p v-if="!pendingItems.length" role="status">{{ emptyStartAttempted ? emptyPlanMessage : emptyPlanStatus }}</p>
      <template v-else>
        <p>摄像头跟练支持的动作会自动计数。计时与语音会按计划时长推进，没有可用时长的动作可手动结束。</p>
        <p v-if="!store.privacy.cameraEnabled">摄像头已在「设置 → 隐私」关闭。</p>
      </template>
    </BaseCard>

    <template v-else>
    <p v-if="trainingMode === 'timer' && degradeReason" class="voice-status" role="status">{{ degradeReason }}</p>
    <!-- 组数 / 次数 / 时长：横贯两栏的进度条（放上面，两块画面共享） -->
    <div class="count-strip animate-slide-in-up" role="group" aria-label="训练进度">
      <div class="strip-cell">
        <span class="strip-label">组数进度</span>
        <div class="strip-num">{{ displaySet }}<i>/{{ exercise.sets }}</i></div>
        <div class="strip-bar"><div class="strip-fill" :style="{ width: setProgress + '%' }"></div></div>
        <p class="strip-sub" aria-live="polite">{{ setsDoneLine }}</p>
      </div>
      <div class="strip-cell primary">
        <!-- 中间格按课次类型自适应：计次 / 计时保持 / 计步（F18） -->
        <template v-if="isRepsMode">
          <span class="strip-label">本组完成次数</span>
          <div class="strip-num" data-testid="rep-count" aria-live="polite">{{ displayReps }}<i>/{{ exercise.repsPerSet }}</i></div>
          <div class="strip-dots" :style="{ gridTemplateColumns: 'repeat(' + Math.min(exercise.repsPerSet, 10) + ', 1fr)' }">
            <span v-for="n in exercise.repsPerSet" :key="n" :class="{ done: n <= displayReps }"></span>
          </div>
        </template>
        <template v-else-if="isTimeMode">
          <span class="strip-label">{{ openTimer ? '本组已用时' : '本组剩余时间' }}</span>
          <div class="strip-num">{{ holdLeft }}<i>秒</i></div>
          <div v-if="!openTimer" class="strip-bar"><div class="strip-fill" :style="{ width: holdProgress + '%' }"></div></div>
        </template>
        <template v-else>
          <span class="strip-label">已计步数</span>
          <div class="strip-num">{{ stepCounter.steps.value }}<i>步</i></div>
          <p class="strip-sub">{{ stepsSub }}</p>
        </template>
      </div>
      <div class="strip-cell">
        <span class="strip-label">已用时长</span>
        <div class="strip-num">{{ durationLabel }}</div>
        <p class="strip-sub">{{ paused ? '已暂停' : phaseLabel }}</p>
      </div>
    </div>

    <div v-if="isRepsMode" class="counting-controls" aria-label="计数方式">
      <div class="counting-sources">
        <button type="button" class="chip" :class="{ active: countMode === 'camera' }" :aria-pressed="countMode === 'camera'"
          :disabled="!live || !cameraRule || finished || calibrating" @click="useCameraCounting">摄像头计数</button>
        <button type="button" class="chip" :class="{ active: countMode === 'manual' }" :aria-pressed="countMode === 'manual'"
          :disabled="finished || calibrating" @click="useManualCounting">手动计数</button>
      </div>
      <div class="manual-count-buttons">
        <button type="button" aria-label="减少一次" :disabled="!canCount || reps === 0" @click="changeManualCount(-1)">−1</button>
        <button type="button" aria-label="完成一次" :disabled="!canCount" @click="changeManualCount(1)">+1 完成一次</button>
      </div>
      <p role="status">{{ countingHint }}</p>
    </div>

    <div class="stage-grid" :class="{ 'timer-only': trainingMode === 'timer' }">
      <!-- 左：本地真人动作演示。视频独立循环，训练计数仍由原有时间线或摄像头负责。 -->
      <BaseCard class="pane pane-demo glass animate-slide-in-up">
        <div class="pane-head">
          <span class="pane-title">{{ trainingMode === 'timer' ? '本组计时' : '演示动作' }}</span>
          <span class="pane-note">{{ trainingMode === 'timer' ? nextSetSpec : '真人动作示范' }}</span>
        </div>
        <div class="pane-body">
          <div class="demo-frame">
            <template v-if="trainingMode === 'camera' && demoVideo && !demoVideoFailed">
              <video ref="demoVideoRef" :key="demoVideo.file" class="demo-video" :src="`/demo-videos/${demoVideo.file}`"
                autoplay loop muted playsinline preload="metadata" :aria-label="`${exercise.name}真人动作演示`"
                @error="demoVideoFailed = true"></video>
              <div class="demo-video-caption">
                <span>{{ demoVideo.note }}</span>
                <a :href="demoVideo.source" target="_blank" rel="noopener noreferrer">素材来源</a>
              </div>
              <div v-if="isTimeMode" class="demo-video-count">{{ openTimer ? '已用' : '剩余' }} {{ holdLeft }} 秒</div>
              <div v-else-if="isStepsMode" class="demo-video-count">
                已计 {{ stepCounter.steps.value }} 步
                <button v-if="stepCounter.status.value === 'idle'" type="button" class="cam-main-btn" @click="startSteps">开启计步</button>
              </div>
            </template>
            <div v-else-if="isTimeMode" class="hold-panel">
              <span class="hold-kick">{{ openTimer ? '已用时间' : '剩余时间' }}</span>
              <div class="hold-count" aria-hidden="true">{{ holdLeft }}<small>秒</small></div>
              <p class="hold-howto">{{ exerciseHowto }}</p>
              <small class="hold-note">{{ nextSetSpec }}</small>
            </div>
            <div v-else-if="isStepsMode" class="steps-panel">
              <span class="hold-kick">计步</span>
              <div class="hold-count" aria-hidden="true">{{ stepCounter.steps.value }}<small>步</small></div>
              <p class="steps-meta">{{ stepsMeta }}</p>
              <button v-if="stepCounter.status.value === 'idle'" type="button" class="cam-main-btn" @click="startSteps">开启计步</button>
              <small class="steps-note">{{ stepsNote }}</small>
            </div>
            <div v-else class="hold-panel">
              <span class="hold-kick">{{ demoVideoFailed ? '演示视频加载失败' : '真人演示待补充' }}</span>
              <p class="hold-howto">{{ exerciseHowto }}</p>
            </div>
            <div class="stage-overlay">
              <div class="badge-group">
                <span v-if="isRepsMode" class="confidence-badge animate-fade-in" :class="confidenceClass" :key="confidenceClass">{{ confidenceText }}</span>
                <span class="phase-badge set-badge">组 {{ displaySet }}/{{ exercise.sets }} · 已完成 {{ closedSets }}</span>
              </div>
              <span class="phase-badge" :class="{ 'animate-pulse': status === 'resting' }">{{ phaseLabel }}</span>
            </div>
            <div class="frame-sheen gradient-shimmer" v-if="isRepsMode && !finished && !paused"></div>
            <!-- F17 组间休息页：预显下一组的动作与起始姿势；面板不吞点击，跳过走两步确认（plan.md §4.2） -->
            <div v-if="status === 'resting' && !finished" class="rest-overlay">
              <div class="rest-panel">
                <span class="rest-kick">组间休息</span>
                <div class="rest-count" aria-hidden="true">{{ restLeft }}<small>秒</small></div>
                <div class="rest-next" aria-live="polite">
                  <strong>下一个：{{ exercise.name }} · 第 {{ nextSetNo }}/{{ exercise.sets }} 组 · {{ nextSetSpec }}</strong>
                  <p>{{ startPoseHint }}</p>
                </div>
                <div class="rest-actions">
                  <button type="button" class="rest-skip" :class="{ armed: skipArmed }" @click="onRestSkipClick">
                    {{ skipArmed ? '再按一次确认跳过' : '跳过休息' }}
                  </button>
                  <button type="button" class="rest-stop" @click="stopAndRecord">结束并记录</button>
                </div>
                <small class="rest-note">跳过需连按两次确认，防止误触</small>
              </div>
            </div>
            <p v-else class="stage-live" aria-live="polite">{{ stageMessage }}</p>
          </div>
        </div>
        <div class="pane-foot">{{ trainingMode === 'timer' ? (openTimer ? '完成动作后，点「完成本组」继续。' : '倒计时结束后自动继续。') : demoHint }}</div>
      </BaseCard>

      <!-- 右：实时摄像头（独立开关，与演示同屏） -->
      <BaseCard v-if="trainingMode === 'camera'" class="pane pane-cam glass animate-slide-in-up">
        <div class="pane-head">
          <span class="pane-title">实时摄像头</span>
          <span class="pane-note">{{ camNote }}</span>
        </div>
        <div class="pane-body">
          <div class="cam-frame">
            <video ref="videoRef" v-show="camRequested" class="cam-feed" muted playsinline></video>
            <canvas ref="canvasRef" v-show="camRequested" class="cam-overlay"></canvas>

            <div v-if="!camRequested" class="cam-idle">
              <Camera :size="26" aria-hidden="true" />
              <p>画面只在本机做姿态推理，不上传、不落盘</p>
              <button v-if="store.privacy.cameraEnabled && !finished" type="button" class="cam-main-btn" @click="startCamera">开启摄像头</button>
              <small v-else-if="finished">跟练结束，摄像头已关闭</small>
              <small v-else>摄像头已在「设置 → 隐私」关闭</small>
            </div>
            <div v-else-if="cameraConnecting" class="cam-idle">
              <p>{{ pose.startingStage.value === 'camera' ? '正在请求摄像头权限…' : '相机已连接，正在加载端侧姿态模型（首次约 5.5 MB）…' }}</p>
              <button type="button" class="cam-main-btn ghost" @click="switchToTimer">改用计时</button>
            </div>
            <div v-else-if="camErrored" class="cam-idle">
              <p class="cam-error" role="alert">{{ pose.errorMessage.value }}</p>
              <button v-if="store.privacy.cameraEnabled" type="button" class="cam-main-btn" @click="startCamera">重试</button>
              <button type="button" class="cam-main-btn ghost" @click="switchToTimer">{{ status === 'idle' ? '改用计时' : '用计时重开当前动作' }}</button>
            </div>
            <template v-else-if="live">
              <div class="cam-angles" aria-hidden="true">膝 {{ pose.kneeAngle.value ?? '—' }}° · 髋 {{ pose.hipAngle.value ?? '—' }}° · 肘 {{ pose.elbowAngle.value ?? '—' }}°</div>
              <button
                class="cam-calib"
                :disabled="calibrating || !counter || finished || status !== 'playing'"
                @click="runCalibrate"
              >{{ calibrating ? '校准中…' : counter ? '校准机位' : '该动作无计数规则' }}</button>
            </template>
          </div>
        </div>
        <div class="pane-foot">{{ camHint }}</div>
      </BaseCard>
    </div>

    <div class="stage-controls">
      <BaseButton v-if="openTimer && status === 'playing'" :disabled="!canAdvance" size="sm" @click="finishSet">完成本组</BaseButton>
      <button class="ctrl-btn secondary" :aria-label="paused ? '继续' : '暂停'" :disabled="!canPause" @click="togglePause">
        <Pause v-if="!paused" :size="20" /><Play v-else :size="20" />
      </button>
      <button class="ctrl-btn secondary" aria-label="跳过本组" :disabled="!canAdvance" @click="skipSet">
        <SkipForward :size="20" />
      </button>
      <button class="ctrl-btn danger" aria-label="结束并记录" :disabled="status === 'idle'" @click="stopAndRecord">
        <Square :size="18" />
      </button>
    </div>

    <div class="after-area">
      <BaseCard v-if="!finished" class="actions-card animate-slide-in-up">
        <h3>完成后记录</h3>
        <p v-if="isRepsMode">完成次数可以修正。看不清时暂停计数，不输出姿势安全结论。共 {{ exercise.sets }} 组，每组 {{ exercise.repsPerSet }} 次，组间休息 {{ exercise.restDuration / 1000 }} 秒。</p>
        <p v-else-if="isTimeMode">{{ openTimer ? '计时会持续到你点「完成本组」。' : '倒计时结束后自动进入下一组或下一个动作。' }} 随时可暂停、跳过或结束并记录。</p>
        <p v-else>计步课次：目标 {{ exercise.targetMinutes }} 分钟。步数来自设备运动传感器（只读运动，不读位置），不可用时退回手动计时；距离不给估算值。随时可结束并记录。</p>
        <BaseButton v-if="isRepsMode" variant="secondary" size="sm" :disabled="!canCount" :icon="Edit3" @click="toggleEdit">手动修正</BaseButton>
        <div v-if="editOpen" class="correct-form">
          <input v-model.number="editValue" type="number" min="0" :max="exercise.repsPerSet" aria-label="修正本组次数" />
          <BaseButton size="sm" @click="applyCorrection">确认</BaseButton>
        </div>
        <BaseButton variant="ghost" size="sm" :icon="FileText" @click="leave">放弃本次记录</BaseButton>
      </BaseCard>

      <BaseCard v-else class="actions-card summary animate-slide-in-up">
        <h3>跟练已结束 · 已记录 {{ recordedCount }} 项</h3>
        <ul v-if="recordedId" class="summary-list">
          <li><span>动作</span><b>{{ exercise.name }}</b></li>
          <li><span>完成组数</span><b>{{ closedSets }} / {{ exercise.sets }}</b></li>
          <li v-if="isRepsMode"><span>总次数</span><b>{{ totalReps }} / {{ exercise.sets * exercise.repsPerSet }}</b></li>
          <li v-else-if="isTimeMode"><span>类型</span><b>计时 · {{ nextSetSpec }}</b></li>
          <li v-else><span>总步数</span><b>{{ stepCounter.steps.value > 0 ? stepCounter.steps.value : '未计步（手动计时）' }}</b></li>
          <li v-if="isRepsMode"><span>计数来源</span><b>{{ countingSourceLabel }}</b></li>
          <li v-if="isRepsMode && cameraUsed"><span>模型识别次数</span><b>{{ modelReps }} 次</b></li>
          <li v-if="isRepsMode && cameraUsed"><span>关键点可见度均值</span><b>{{ Math.round(averageConfidence * 100) }}%</b></li>
          <li><span>手动修正</span><b>{{ manualCorrections }} 次</b></li>
          <li><span>状态</span><b>{{ completionLabel }}</b></li>
          <li><span>RPE</span><b>{{ feedbackSaved ? (rpe === null ? '未记录' : rpe) : '待反馈' }}</b></li>
        </ul>

        <div v-if="recordedId && !feedbackSaved" class="feedback">
          <h4>这次感觉怎么样？</h4>
          <div class="field">
            <span class="field-label">RPE 主观用力程度（0 几乎不费力 · 10 力竭）</span>
            <div class="rpe-row">
              <button
                v-for="n in RPE_SCALE"
                :key="n"
                class="rpe-chip"
                :class="{ active: rpe === n }"
                :aria-pressed="rpe === n"
                @click="rpe = n"
              >{{ n }}</button>
            </div>
            <small>不选就是"未记录"——周报会把它算作数据缺失，而不是 0 负荷。</small>
          </div>
          <label class="check"><input v-model="discomfort" type="checkbox" /> 训练中有不适或疼痛</label>
          <div v-if="completionLabel === '部分完成'" class="field">
            <span class="field-label">没完成的原因</span>
            <input v-model="reasonText" type="text" placeholder="例如：时间不够、状态不好" />
          </div>
          <div class="field">
            <span class="field-label">备注（可选）</span>
            <textarea v-model="notesText" rows="2" placeholder="想记下的细节…"></textarea>
          </div>
          <BaseButton size="sm" @click="saveFeedback">保存反馈</BaseButton>
          <BaseButton variant="ghost" size="sm" @click="feedbackSaved = true">先跳过</BaseButton>
        </div>
        <p v-else-if="feedbackSaved" class="feedback-saved">
          反馈{{ rpe === null && !discomfort ? '已跳过' : '已保存' }}：RPE {{ rpe === null ? '未记录' : rpe }} · {{ discomfort ? '有不适' : '无不适' }}
        </p>

        <p class="stored-note">{{ recordedNote }}</p>
        <BaseButton size="sm" :icon="Play" @click="showModePicker">重新选择跟练方式</BaseButton>
        <BaseButton variant="secondary" size="sm" @click="leave">返回概览</BaseButton>
      </BaseCard>
    </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, shallowRef, computed, watch, nextTick, onUnmounted } from 'vue'
import { onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router'
import { X, Pause, Play, SkipForward, Square, Camera, Edit3, FileText } from 'lucide-vue-next'
import BaseCard from '@/components/common/BaseCard.vue'
import BaseButton from '@/components/common/BaseButton.vue'
import { demoVideos } from '@/services/demoVideos'
import { useAppStore } from '@/stores/app'
import { usePoseCamera, type PoseSample } from '@/composables/usePoseCamera'
import { useRepCounter } from '@/composables/useRepCounter'
import { useSpeech } from '@/composables/useSpeech'
import { useStepCounter } from '@/composables/useStepCounter'
import { findExercise } from '@/services/exercises'
import type { ExercisePhase, PlanItem } from '@/types/domain'
import { toISODate } from '@/utils/time'
import {
  demoExercises,
  getPhaseText,
  getConfidenceLevel,
  guideExercise,
  summarizeSession,
  timedSetLabel
} from '@/services/demoCameraService'
import type { TrainingGuide } from '@/services/demoCameraService'

const route = useRoute()
const router = useRouter()
const store = useAppStore()

const planDate = computed(() => {
  const requested = route.query.planDate
  return typeof requested === 'string' && requested ? requested : toISODate(new Date())
})
const dayItems = computed(() => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(planDate.value)) return []
  const date = new Date(`${planDate.value}T00:00:00`)
  if (toISODate(date) !== planDate.value) return []
  const plan = store.weekPlan(date)
  return plan?.items.filter(item => item.date === planDate.value) ?? []
})
const plannedItems = computed(() => {
  const itemId = route.query.planItemId
  return itemId ? dayItems.value.filter(item => item.id === itemId) : dayItems.value
})
const pendingItems = computed(() => plannedItems.value.filter(item => !item.completed))
const emptyStartAttempted = ref(false)
const emptyPlanStatus = computed(() => {
  if (!dayItems.value.length) return '当天还没有计划。'
  if (!plannedItems.value.length) return '这项训练已不在当天计划中。'
  return route.query.planItemId ? '这项训练已完成。' : '当天的计划已全部完成。'
})
const emptyPlanMessage = computed(() => dayItems.value.length
  ? emptyPlanStatus.value
  : '当天还没有计划。可以先到计划页录入训练安排。')
const trainingMode = ref<TrainingGuide | null>(null)
const trainingItems = shallowRef<PlanItem[]>([])
const itemIndex = ref(0)
const nextItem = computed(() => trainingItems.value[itemIndex.value + 1])
const idleExercise = guideExercise(undefined, 'timer')
const exercise = shallowRef(idleExercise)
const setIndex = ref(1)
const reps = ref(0)
const displayReps = ref(0)
const confidence = ref(0)
const message = ref('准备开始')
const phase = ref<ExercisePhase>('idle')
const status = ref<'playing' | 'resting' | 'idle'>('idle')
const elapsedMs = ref(0)
const paused = ref(false)
const finished = ref(false)
const editOpen = ref(false)
const editValue = ref(0)
const manualCorrections = ref(0)
const repsBySet = ref<number[]>([])
const recordedNote = ref('')
const recordedId = ref('')
const recordedCount = ref(0)
const rpe = ref<number | null>(null)
const discomfort = ref(false)
const reasonText = ref('')
const notesText = ref('')
const feedbackSaved = ref(false)
const pose = usePoseCamera()
const { speak: speakPrompt, stop: stopSpeech, degradeReason } = useSpeech()
const speak = (text: string) => speakPrompt(text, trainingMode.value === 'timer')
/** F18 计步：DeviceMotion 过峰检测；不支持/被拒/无传感器时如实降级为手动计时 */
const stepCounter = useStepCounter()
/** 摄像头由整次跟练持有，换动作时只切换计数规则。 */
const camRequested = ref(false)
const videoRef = ref<HTMLVideoElement | null>(null)
const demoVideoRef = ref<HTMLVideoElement | null>(null)
const demoVideoFailed = ref(false)
const canvasRef = ref<HTMLCanvasElement | null>(null)

/** F05：实时摄像头用关键点角度驱动状态机计数。 */
const counter = shallowRef<ReturnType<typeof useRepCounter> | null>(null)
const camJoint = ref<'knee' | 'elbow' | 'hip'>('knee')

function jointSample(sample: PoseSample | null) {
  if (!sample) return { angle: null, visibility: 0, side: null as 'left' | 'right' | null }
  if (camJoint.value === 'knee') return { angle: sample.kneeAngle, visibility: sample.kneeVisibility, side: sample.kneeSide }
  if (camJoint.value === 'hip') return { angle: sample.hipAngle, visibility: sample.hipVisibility, side: sample.hipSide }
  return { angle: sample.elbowAngle, visibility: sample.elbowVisibility, side: sample.elbowSide }
}
const calibrating = ref(false)
/** session-RPE 量表含 0 档：0 表示几乎不费力 */
const RPE_SCALE = Array.from({ length: 11 }, (_, i) => i)
const cameraRule = computed(() => exercise.value.mode === 'reps' ? findExercise(exercise.value.name)?.camera : undefined)
const countMode = ref<'manual' | 'camera'>('manual')
const modelReps = ref(0)
const cameraUsed = ref(false)
let cameraCountOffset = 0
let countingSide: 'left' | 'right' | null = null

function buildCounter() {
  counter.value?.interrupt()
  const cam = cameraRule.value
  if (!cam) {
    counter.value = null
    return null
  }
  camJoint.value = cam.joint
  const c = useRepCounter({
    neutral: cam.neutral,
    bottom: cam.bottom,
    hysteresis: 8,
    minStageMs: cam.minStageMs,
    minRepMs: 700,
    maxStageMs: 6000,
    minVisibility: 0.5
  })
  counter.value = c
  cameraCountOffset = reps.value
  countingSide = null
  c.reset('已就绪：先校准机位，或直接在起始姿势下开始')
  return c
}

async function runCalibrate() {
  calibrating.value = true
  try {
    await calibratePose()
  } finally {
    calibrating.value = false
  }
}

async function calibratePose() {
  const c = counter.value
  if (!c || !live.value) return
  const ok = await c.calibrate(() => {
    const sample = pose.sample.value
    const joint = jointSample(sample)
    return joint.angle === null || !sample ? null : { angle: joint.angle, visibility: joint.visibility, timestamp: sample.timestamp }
  })
  if (c !== counter.value) return
  store.showToast({
    type: ok ? 'success' : 'warning',
    title: ok ? '机位已校准' : '校准未完成',
    message: ok
      ? `阈值按你的起始姿势（${c.calibratedNeutral.value}°）设定，不是通用标准姿势判定`
      : '请让侧面全身完整入镜、光线稳定后重试',
    duration: 3500
  })
}

let setElapsed = 0
let restElapsed = 0
let lastTs = 0
let rafId = 0
let tweenRaf = 0
let confidenceSum = 0
let confidenceCount = 0
let recorded = false

// ——— 整次跟练共用摄像头 ———
const live = computed(() => camRequested.value && pose.status.value === 'live')
const cameraConnecting = computed(() => camRequested.value && pose.status.value === 'starting')
const camErrored = computed(() => camRequested.value && ['denied', 'error', 'unsupported'].includes(pose.status.value))
const canPause = computed(() => status.value !== 'idle' && (trainingMode.value !== 'camera' || live.value))
const canAdvance = computed(() => canPause.value && !paused.value)

async function startCamera() {
  if (trainingMode.value !== 'camera' || !store.privacy.cameraEnabled || finished.value || live.value || cameraConnecting.value) return
  camRequested.value = true
  await nextTick()
  if (!camRequested.value) return
  if (!videoRef.value || !canvasRef.value) {
    camRequested.value = false
    pose.errorMessage.value = '摄像头画面容器没有准备好，请重试。'
    return
  }
  await pose.start(videoRef.value, canvasRef.value)
  if (!live.value) return
  if (status.value === 'idle') restart()
  else {
    cameraUsed.value = true
    useCameraCounting()
    message.value = '摄像头已重新接入，点「继续」恢复训练'
  }
}

function useCameraCounting() {
  if (!live.value || !cameraRule.value) return
  countMode.value = 'camera'
  if (!counter.value) buildCounter()
  cameraCountOffset = reps.value - (counter.value?.count.value ?? 0)
  counter.value?.interrupt()
}

function stopCamera() {
  if (!camRequested.value) return
  camRequested.value = false
  pose.stop()
  pose.errorMessage.value = ''
  counter.value?.interrupt()
  counter.value = null
}

// ——— F17 组间休息页 ———
/** 休息剩余秒数（reactive）：tick 里只写 restElapsed，这里每秒刷新倒计时显示 */
const restLeft = ref(0)
/** 跳过休息的两步确认：第一下进入确认态，3 秒内不按自动回落继续等待 */
const skipArmed = ref(false)
let skipArmTimer = 0
/** "组间剩 5 秒"只播一次 */
let restFiveSaid = false

const nextSetNo = computed(() => Math.min(setIndex.value + 1, exercise.value.sets))

// ——— F18 计时/计步型课次 ———
const isRepsMode = computed(() => exercise.value.mode === 'reps')
const isTimeMode = computed(() => exercise.value.mode === 'time')
const isStepsMode = computed(() => exercise.value.mode === 'steps')
const openTimer = computed(() => isTimeMode.value && exercise.value.holdSeconds === undefined)
const targetMs = computed(() => (exercise.value.targetMinutes ?? 0) * 60_000)
/** time 模式本组剩余秒（tick 里按 setElapsed 换算） */
const holdLeft = ref(0)
/** "还剩 5 秒"每组只播一次 */
let holdFiveSaid = false
/** steps 模式已播报到的 5 分钟里程碑 */
let minuteMark = 0
/** 三种模式通用的已完成组数（reps 模式另有 repsBySet 明细） */
const closedSets = ref(0)
const holdProgress = computed(() => {
  const hold = exercise.value.holdSeconds ?? 0
  return hold ? Math.min(((hold - holdLeft.value) / hold) * 100, 100) : 0
})
const exerciseHowto = computed(() => trainingItems.value[itemIndex.value]?.note
  ?? findExercise(exercise.value.name)?.howto ?? '')
const stepsSub = computed(() => {
  const cad = stepCounter.cadence.value
  return `${cad > 0 ? `${cad} 步/分` : '步频 —'} · 目标 ${exercise.value.targetMinutes} 分钟`
})
const stepsMeta = computed(() => {
  const cad = stepCounter.cadence.value
  return `${cad > 0 ? `步频 ${cad} 步/分` : '步频 —'} · 目标 ${exercise.value.targetMinutes} 分钟`
})
const stepsNote = computed(() => {
  const st = stepCounter.status.value
  if (st === 'active') return '正在读取设备运动传感器计步；只读运动数据，不读位置'
  if (st === 'requesting') return '等待运动传感器权限…'
  if (st === 'idle') return '开启后用设备运动传感器自动计步；不开也不影响计时'
  return stepCounter.degradeNote.value || '已退回手动计时'
})
/** 预显的下一组规格文案（休息页与读屏用） */
const nextSetSpec = computed(() =>
  isTimeMode.value ? timedSetLabel(exercise.value) : `每组 ${exercise.value.repsPerSet} 次`
)
/** 预显的起始姿势：动作库要领 + 按课次类型给站位/口径提示 */
const startPoseHint = computed(() => {
  const lib = findExercise(exercise.value.name)
  const station = isTimeMode.value
    ? (openTimer.value ? '完成这一组后手动确认' : '开始后按计时进行')
    : isStepsMode.value
      ? '计步课次：步数由设备运动传感器负责；开启摄像头仅供自查姿态'
      : lib?.camera
        ? `侧面面向镜头，${lib.camera.joint === 'knee' ? '髋、膝、踝' : lib.camera.joint === 'hip' ? '肩、髋、膝' : '肩、肘、手腕'}保持清晰`
        : '该动作暂无摄像头计数规则，请使用手动计数，画面仅供姿势自查'
  return [exerciseHowto.value, station].filter(Boolean).join(' · ')
})

function disarmSkip() {
  window.clearTimeout(skipArmTimer)
  skipArmed.value = false
}

function onRestSkipClick() {
  // 两步确认（plan.md §4.2）：第一下只进入确认态、继续等待，第二下才真的跳过
  if (!skipArmed.value) {
    skipArmed.value = true
    window.clearTimeout(skipArmTimer)
    skipArmTimer = window.setTimeout(() => { skipArmed.value = false }, 3000)
    return
  }
  disarmSkip()
  skipSet()
}

function tweenRepsTo(target: number) {
  cancelAnimationFrame(tweenRaf)
  const from = displayReps.value
  const delta = target - from
  if (!delta) return
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    displayReps.value = target
    return
  }
  const startedAt = performance.now()
  const step = (now: number) => {
    const p = Math.min((now - startedAt) / 320, 1)
    displayReps.value = Math.round(from + delta * (1 - Math.pow(1 - p, 3)))
    if (p < 1) tweenRaf = requestAnimationFrame(step)
  }
  tweenRaf = requestAnimationFrame(step)
}

watch(reps, value => tweenRepsTo(value))

const displaySet = computed(() => Math.min(setIndex.value, exercise.value.sets))
/** 直接把"已完成几组"说清楚，不让人从"当前组数 1/2"里猜 */
const setsDoneLine = computed(() => `已完成 ${closedSets.value} / ${exercise.value.sets} 组`)
const setProgress = computed(() => {
  const within = isTimeMode.value ? holdProgress.value / 100 : isStepsMode.value
    ? Math.min(elapsedMs.value / targetMs.value, 1) : Math.min(reps.value / exercise.value.repsPerSet, 1)
  return ((displaySet.value - 1 + within) / exercise.value.sets) * 100
})
const phaseLabel = computed(() => {
  if (finished.value) return '已完成'
  if (status.value === 'idle') return '等待摄像头'
  if (paused.value) return '已暂停'
  if (status.value === 'resting') return '组间休息'
  if (isTimeMode.value) return '计时中'
  if (isStepsMode.value) return stepCounter.status.value === 'active' ? '计步中' : '计时中'
  return getPhaseText(phase.value, exercise.value.kind)
})
const demoVideo = computed(() => demoVideos[exercise.value.name])
watch(() => exercise.value.name, () => { demoVideoFailed.value = false })
watch([paused, status, finished, () => exercise.value.name], async () => {
  await nextTick()
  const video = demoVideoRef.value
  if (!video) return
  if (paused.value || status.value !== 'playing' || finished.value) video.pause()
  else video.play().catch(() => { demoVideoFailed.value = true })
}, { immediate: true })
const totalReps = computed(() => repsBySet.value.reduce((sum, n) => sum + n, 0))
const averageConfidence = computed(() => (confidenceCount ? confidenceSum / confidenceCount : 0))
const completionLabel = computed(() => {
  if (isTimeMode.value) return closedSets.value >= exercise.value.sets ? '全部完成' : '部分完成'
  if (isStepsMode.value) return elapsedMs.value >= targetMs.value ? '全部完成' : '部分完成'
  const target = exercise.value.sets * exercise.value.repsPerSet
  return repsBySet.value.length >= exercise.value.sets && totalReps.value >= target ? '全部完成' : '部分完成'
})
const durationLabel = computed(() => {
  const total = Math.floor(elapsedMs.value / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
})
const jointLabel = computed(() => (camJoint.value === 'knee' ? '膝角' : camJoint.value === 'hip' ? '髋角' : '肘角'))

const stageMessage = computed(() => message.value)
const shownConfidence = computed(() => (live.value ? pose.visibility.value : confidence.value))
const confidenceLevel = computed(() => getConfidenceLevel(shownConfidence.value))
const confidenceClass = computed(() => confidenceLevel.value.level)
const confidenceText = computed(() => countMode.value === 'manual' ? '手动录入次数'
  : live.value ? confidenceLevel.value.text : '等待摄像头')

const demoHint = computed(() => {
  if (!demoVideo.value || demoVideoFailed.value) return '请参照动作要领练习；当前没有可用的准确真人演示视频'
  return '真人视频循环播放供动作参考。支持的动作可自动计数，也可手动录入。'
})

const camNote = computed(() => {
  if (cameraConnecting.value) return '连接中…'
  if (live.value) {
    const where = pose.runsIn.value === 'main' ? ' · 推理回落主线程' : ''
    return `${pose.fps.value} FPS · ${pose.delegate.value === 'GPU' ? 'GPU' : 'CPU'} 推理${where}`
  }
  if (camErrored.value) return '不可用'
  return '未开启'
})

const camHint = computed(() => {
  if (!store.privacy.cameraEnabled) return '摄像头已在设置中关闭；到「设置 → 隐私」可重新打开'
  if (cameraConnecting.value) {
    return pose.startingStage.value === 'camera' ? '等待摄像头授权…' : '相机已连接 · 正在准备端侧姿态模型…'
  }
  if (camErrored.value) return pose.errorMessage.value || '摄像头不可用'
  if (live.value) {
    if (isTimeMode.value) return '识别：端侧关键点 · 计时课次不需要摄像头计数，画面仅供自查姿势'
    if (isStepsMode.value) return '识别：端侧关键点 · 计步由设备运动传感器负责，画面仅供自查姿势'
    const c = counter.value
    if (!c) return '该动作暂无自动计数规则，请使用上方手动计数；摄像头画面仅供姿势自查'
    return `端侧关键点计数（${jointLabel.value}）· 阈值 ${Math.round(c.lowThreshold.value)}° · ${c.calibratedNeutral.value !== null ? '已校准' : '未校准'} · 完成一个往返记一次`
  }
  return '开启后画面只在本机做姿态推理，不上传、不落盘'
})

const canCount = computed(() => status.value === 'playing' && canAdvance.value && !calibrating.value)
const countingSourceLabel = computed(() => modelReps.value ? (manualCorrections.value ? '摄像头识别 + 手动修正' : '摄像头识别 / 手动录入') : '手动计数')
const countingHint = computed(() => {
  if (finished.value) return '本次计数已保存，可以查看下方记录或再练一遍。'
  if (paused.value) return '计数已暂停，继续后请先回到起始姿势。'
  if (status.value === 'resting') return '组间休息，计数暂停；下一组从 0 开始。'
  if (countMode.value === 'manual') return cameraRule.value
    ? '每完成一次点 +1。也可以切换为摄像头计数，识别一个完整往返。'
    : '该动作暂无摄像头自动计数规则，请每完成一次点 +1。'
  if (camErrored.value) return '摄像头不可用，次数不会自动增加；请重试或切换手动计数。'
  if (!live.value) return '正在等待摄像头与姿态模型，准备好前不会自动增加次数。'
  if (calibrating.value) return '机位校准中，已有次数保留，计数暂停。'
  return counter.value?.gate.value ?? '摄像头计数中：起始姿势 → 动作末端 → 返回起始姿势，记为一次。'
})

function useManualCounting() {
  countMode.value = 'manual'
  counter.value?.interrupt()
  message.value = '每完成一次动作，点 +1 记一次'
}

function changeManualCount(delta: number) {
  if (!canCount.value) return
  const next = Math.max(0, Math.min(exercise.value.repsPerSet, reps.value + delta))
  if (next === reps.value) return
  if (countMode.value === 'camera') manualCorrections.value++
  reps.value = next
  cameraCountOffset = next - (counter.value?.count.value ?? 0)
  message.value = `已记 ${next} 次`
  speak(String(next))
  if (next >= exercise.value.repsPerSet) finishSet()
}

watch(pose.sample, sample => {
  if (!sample || countMode.value !== 'camera' || !isRepsMode.value || !live.value || !canCount.value) return
  const c = counter.value
  if (!c) return
  const sampleJoint = jointSample(sample)
  if (countingSide && sampleJoint.side && countingSide !== sampleJoint.side) c.interrupt('识别侧发生变化，请回到起始姿势')
  if (sampleJoint.side) countingSide = sampleJoint.side
  const result = c.feed(sampleJoint.angle, sampleJoint.visibility, sample.timestamp)
  confidence.value = sampleJoint.visibility
  confidenceSum += sampleJoint.visibility
  confidenceCount++
  phase.value = result.phase
  message.value = result.gate ?? (result.counted ? '已完成一次往返' : getPhaseText(result.phase, exercise.value.kind))
  if (result.counted) {
    modelReps.value++
    reps.value = Math.max(0, Math.min(c.count.value + cameraCountOffset, exercise.value.repsPerSet))
    speak(String(reps.value))
    if (reps.value >= exercise.value.repsPerSet) finishSet()
  }
}, { flush: 'sync' })

watch(live, (now, before) => {
  if (!before || now || trainingMode.value !== 'camera' || status.value === 'idle') return
  counter.value?.interrupt('画面中断，恢复后请回到起始姿势')
  paused.value = true
  message.value = '摄像头已中断，训练已暂停'
}, { flush: 'sync' })

function tick(ts: number) {
  rafId = requestAnimationFrame(tick)
  if (!lastTs) lastTs = ts
  // 后台标签页回来时 ts 会一次性跳大，钳制增量以免事件被成批吞掉
  const dt = Math.min(ts - lastTs, 250)
  lastTs = ts

  if (!paused.value && status.value === 'playing') {
    elapsedMs.value += dt
    if (isTimeMode.value) {
      setElapsed += dt
      if (openTimer.value) {
        holdLeft.value = Math.floor(setElapsed / 1000)
        message.value = '完成动作后，点「完成本组」'
      } else {
        const remainMs = Math.max(exercise.value.setDuration - setElapsed, 0)
        holdLeft.value = Math.ceil(remainMs / 1000)
        message.value = `剩余 ${holdLeft.value} 秒`
        if (!holdFiveSaid && remainMs <= 5000 && exercise.value.setDuration > 5000) {
          holdFiveSaid = true
          speak('还剩 5 秒')
        }
        if (remainMs <= 0) finishSet()
      }
    } else if (isStepsMode.value) {
      // F18 计步：计步交给传感器（或手动计时），到目标时长自动完成
      const minutes = Math.floor(elapsedMs.value / 60_000)
      if (minutes >= minuteMark + 5) {
        minuteMark += 5
        speak(`已 ${minuteMark} 分钟`)
      }
      if (elapsedMs.value >= targetMs.value) {
        message.value = '达到目标时长'
        closeCurrentSet()
        complete(true)
      }
    }
  } else if (!paused.value && status.value === 'resting') {
    elapsedMs.value += dt
    restElapsed += dt
    const remaining = Math.max(Math.ceil((exercise.value.restDuration - restElapsed) / 1000), 0)
    restLeft.value = remaining
    message.value = `组间休息 ${remaining} 秒`
    if (!restFiveSaid && remaining <= 5 && exercise.value.restDuration > 5000) {
      restFiveSaid = true
      speak('组间剩 5 秒')
    }
    if (restElapsed >= exercise.value.restDuration) startNextSet()
  }
}

function closeCurrentSet(completed = true) {
  if (status.value !== 'playing') return
  if (completed) closedSets.value++
  if (isRepsMode.value) repsBySet.value.push(reps.value)
}

function finishSet() {
  if (status.value !== 'playing' || !canAdvance.value) return
  closeCurrentSet()
  if (setIndex.value < exercise.value.sets) {
    status.value = 'resting'
    restElapsed = 0
    restFiveSaid = false
    holdFiveSaid = false
    restLeft.value = Math.ceil(exercise.value.restDuration / 1000)
    speak(`本组完成，休息 ${restLeft.value} 秒`)
  } else {
    complete(true)
  }
}

function startNextSet() {
  disarmSkip()
  setIndex.value++
  reps.value = 0
  setElapsed = 0
  cameraCountOffset = 0
  countingSide = null
  holdFiveSaid = false
  holdLeft.value = exercise.value.holdSeconds ?? 0
  counter.value?.reset('新一组开始：请回到起始姿势')
  status.value = 'playing'
  message.value = `第 ${setIndex.value} 组开始`
  speak(isTimeMode.value ? `第 ${setIndex.value} 组开始，${nextSetSpec.value}` : `第 ${setIndex.value} 组开始`)
}

function skipSet() {
  if (!canAdvance.value) return
  closeCurrentSet(false)
  if (setIndex.value < exercise.value.sets) {
    startNextSet()
    store.showToast({ type: 'info', title: `已跳到第 ${setIndex.value} 组`, duration: 2000 })
  } else {
    complete(true)
  }
}

function stopAndRecord() {
  if (status.value === 'idle') return
  closeCurrentSet(false)
  complete(false)
}

function complete(advance: boolean) {
  if (finished.value) return
  record()
  if (advance && nextItem.value) {
    itemIndex.value++
    configureExercise()
    restart()
    return
  }
  cancelAnimationFrame(rafId)
  finished.value = true
  status.value = 'idle'
  phase.value = 'complete'
  message.value = '训练完成'
  counter.value?.interrupt()
  stopCamera()
  disarmSkip()
  if (isStepsMode.value) {
    // 停监听但保留已计步数，摘要要用
    stepCounter.stop()
    speak(stepCounter.steps.value > 0 ? `训练完成，共 ${stepCounter.steps.value} 步` : '训练完成')
  } else {
    speak('训练完成')
  }
}

function record() {
  if (recorded || (!elapsedMs.value && !closedSets.value && !repsBySet.value.some(Boolean))) return
  recorded = true
  const session = store.addSession(
    summarizeSession({
      exercise: exercise.value,
      planItemId: trainingItems.value[itemIndex.value]?.id,
      setsCompleted: closedSets.value,
      repsBySet: repsBySet.value,
      steps: isStepsMode.value ? stepCounter.steps.value : undefined,
      cameraUsed: cameraUsed.value,
      countedReps: modelReps.value,
      averageConfidence: averageConfidence.value,
      manualCorrections: manualCorrections.value,
      elapsedMs: elapsedMs.value
    })
  )
  recordedCount.value++
  recordedId.value = session.id
  recordedNote.value = `已保存到本地记录（共 ${store.sessions.length} 条）`
}

/** F18 计步开关：必须在用户手势里调用（iOS 的权限申请要求手势上下文） */
async function startSteps() {
  await stepCounter.start()
}

function saveFeedback() {
  if (!recordedId.value) return
  store.applyFeedback(recordedId.value, {
    sessionId: recordedId.value,
    rpe: rpe.value,
    discomfort: discomfort.value,
    reason: completionLabel.value === '部分完成' ? reasonText.value.trim() || undefined : undefined,
    notes: notesText.value.trim() || undefined
  })
  feedbackSaved.value = true
}

function toggleEdit() {
  editOpen.value = !editOpen.value
  if (editOpen.value) editValue.value = reps.value
}

function applyCorrection() {
  if (!Number.isFinite(editValue.value) || !canCount.value) return
  const next = Math.round(Math.max(0, Math.min(editValue.value, exercise.value.repsPerSet)))
  if (next !== reps.value) manualCorrections.value++
  reps.value = next
  cameraCountOffset = next - (counter.value?.count.value ?? 0)
  editOpen.value = false
  store.showToast({ type: 'info', title: `本组次数已修正为 ${next}`, message: '计数与修正值分别保留，不覆盖模型计数', duration: 2200 })
  if (next >= exercise.value.repsPerSet) finishSet()
}

function togglePause() {
  if (!canPause.value) return
  paused.value = !paused.value
  counter.value?.interrupt(paused.value ? '已暂停计数' : '请回到起始姿势后继续')
  if (paused.value) lastTs = 0
  message.value = paused.value ? '已暂停' : '继续训练'
  speak(paused.value ? '已暂停' : '继续训练')
}

function planItemSpec(item: PlanItem): string {
  const minutes = item.plannedTargetMinutes ?? item.plannedDuration
  return [
    item.plannedSets && `${item.plannedSets} 组`,
    item.plannedReps && `每组 ${item.plannedReps} 次`,
    item.plannedHoldSeconds && `每组 ${item.plannedHoldSeconds} 秒`,
    item.plannedDistance && `${item.plannedDistance} 米`,
    minutes && `${minutes} 分钟`
  ].filter(Boolean).join(' · ')
}

function configureExercise() {
  const guide = trainingMode.value
  const item = trainingItems.value[itemIndex.value]
  if (!guide || !item) return
  const base = demoExercises.find(candidate => candidate.name === item.exerciseName)
  exercise.value = guideExercise(base, guide, item)
  holdLeft.value = exercise.value.holdSeconds ?? 0
}

function startTraining(guide: TrainingGuide) {
  if (trainingMode.value) return
  if (!pendingItems.value.length) {
    emptyStartAttempted.value = true
    return
  }
  if (guide === 'camera' && !store.privacy.cameraEnabled) return
  trainingItems.value = pendingItems.value.map(item => ({ ...item }))
  itemIndex.value = 0
  recordedCount.value = 0
  trainingMode.value = guide
  configureExercise()
  if (guide === 'camera') void startCamera()
  else restart()
}

function switchToTimer() {
  trainingMode.value = 'timer'
  stopCamera()
  configureExercise()
  restart()
}

function showModePicker() {
  cancelAnimationFrame(rafId)
  status.value = 'idle'
  stopCamera()
  stopSpeech()
  trainingMode.value = null
  exercise.value = idleExercise
  emptyStartAttempted.value = false
  finished.value = false
}

function restart() {
  cancelAnimationFrame(rafId)
  cancelAnimationFrame(tweenRaf)
  setIndex.value = 1
  reps.value = 0
  displayReps.value = 0
  confidence.value = 0
  message.value = '准备开始'
  phase.value = 'idle'
  status.value = 'playing'
  elapsedMs.value = 0
  paused.value = false
  finished.value = false
  editOpen.value = false
  manualCorrections.value = 0
  repsBySet.value = []
  recordedNote.value = ''
  recordedId.value = ''
  rpe.value = null
  discomfort.value = false
  reasonText.value = ''
  notesText.value = ''
  feedbackSaved.value = false
  setElapsed = 0
  restElapsed = 0
  lastTs = 0
  confidenceSum = 0
  confidenceCount = 0
  recorded = false
  cameraCountOffset = 0
  countingSide = null
  modelReps.value = 0
  cameraUsed.value = live.value
  countMode.value = live.value && cameraRule.value ? 'camera' : 'manual'
  calibrating.value = false
  restLeft.value = Math.ceil(exercise.value.restDuration / 1000)
  restFiveSaid = false
  holdFiveSaid = false
  minuteMark = 0
  closedSets.value = 0
  holdLeft.value = exercise.value.holdSeconds ?? 0
  // 换动作/重开时停掉旧计步监听；要计步再点"开启计步"（iOS 权限需要新手势）
  stepCounter.stop(false)
  disarmSkip()
  // 摄像头是独立开关：切动作/重开不关摄像头，只按新动作重建计数规则
  if (live.value) buildCounter()
  else { counter.value?.interrupt(); counter.value = null }
  rafId = requestAnimationFrame(tick)
  // 课次开始也是节奏的一部分；浏览器在没有用户激活时会把这句静默拒掉，不报错
  const spec = isStepsMode.value ? `目标 ${exercise.value.targetMinutes} 分钟` : nextSetSpec.value
  speak(`开始${exercise.value.name}，第 1 组，${spec}`)
}

function leave() {
  cancelAnimationFrame(rafId)
  status.value = 'idle'
  stopSpeech()
  stopCamera()
  router.push('/')
}

onBeforeRouteUpdate((to, from) => {
  if (to.query.planDate !== from.query.planDate || to.query.planItemId !== from.query.planItemId) showModePicker()
})

onUnmounted(() => {
  counter.value?.interrupt()
  cancelAnimationFrame(rafId)
  cancelAnimationFrame(tweenRaf)
  disarmSkip()
})
</script>

<style scoped>
.execution-page{max-width:1400px;margin:auto}
.page-header{display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:20px;gap:16px}
.kick{display:inline-flex;align-items:center;gap:8px}.kick i{width:14px;height:1px;background:var(--pole-movement);display:block}
.page-header h1{font-size:28px;margin:7px 0 5px}
.page-header p{color:var(--color-text-muted);font-size:13px;margin:0}
.page-header .queue-progress{margin-top:8px;font-weight:600}
.guide-picker h2{font-size:18px;margin:0 0 12px}
.guide-queue{margin:0 0 14px;padding-left:22px;color:var(--color-text-secondary);line-height:1.65}
.guide-actions{display:flex;gap:10px;flex-wrap:wrap}
.guide-picker p,.voice-status{font-size:13px;color:var(--color-text-muted);line-height:1.6}
.voice-status{margin:0 0 12px}
.chip{padding:7px 13px;border-radius:999px;font-size:12px;font-weight:600;color:var(--pole-movement-strong);background:var(--pole-movement-soft);transition:all var(--motion-fast)}
.chip.active{background:var(--pole-movement);color:var(--color-on-accent)}
.chip:hover:enabled{transform:translateY(-1px);box-shadow:var(--shadow-sm)}
.chip:disabled{opacity:.45;cursor:not-allowed}

/* 计数条：横贯两栏，放两块画面上面 */
.count-strip{display:grid;grid-template-columns:1fr 1.5fr 1fr;gap:14px;margin-bottom:14px}
.strip-cell{padding:14px 18px;border-radius:var(--radius-md);background:var(--color-card);border:1px solid var(--color-divider)}
.strip-label{display:block;font-size:11px;color:var(--color-text-muted)}
.strip-num{font-family:var(--font-num);font-size:40px;font-weight:600;letter-spacing:-.03em;line-height:1.15;font-variant-numeric:tabular-nums;color:var(--color-ink)}
.strip-num i{font-style:normal;font-size:15px;color:var(--color-text-muted);letter-spacing:0;margin-left:2px}
.strip-cell.primary .strip-num{color:var(--pole-movement)}
.strip-bar{height:5px;background:var(--color-divider);border-radius:6px;overflow:hidden;margin-top:8px}
.strip-fill{height:100%;background:linear-gradient(90deg,var(--pole-movement),var(--pole-movement-strong));border-radius:6px;transition:width var(--motion-slow) var(--easing-ease-out)}
.strip-dots{display:grid;gap:4px;margin-top:9px}
.strip-dots span{height:4px;border-radius:2px;background:var(--color-divider)}
.strip-dots span.done{background:var(--pole-movement);animation:scaleIn var(--motion-base) var(--easing-spring) both}
.strip-sub{margin:9px 0 0;font-size:12px;color:var(--color-text-secondary)}
.counting-controls{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;padding:14px 18px;margin-bottom:16px;border:1px solid var(--color-divider);border-radius:var(--radius-md);background:var(--color-card)}
.counting-sources,.manual-count-buttons{display:flex;flex-wrap:wrap;gap:8px}
.counting-controls p{flex-basis:100%;margin:0;font-size:12px;line-height:1.6;color:var(--color-text-secondary)}
.counting-controls button{min-height:44px}
.manual-count-buttons button{padding:8px 18px;border-radius:var(--radius-sm);background:var(--pole-movement-soft);color:var(--pole-movement-strong);font-weight:700}
.manual-count-buttons button:disabled{opacity:.45;cursor:not-allowed}

/* 双栏：左演示，右摄像头，同屏 */
.stage-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:6px}
.stage-grid.timer-only{grid-template-columns:1fr}
.pane{padding:0!important;overflow:hidden;display:flex;flex-direction:column}
.pane-head{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:12px 18px;border-bottom:1px solid var(--color-divider)}
.pane-title{font-size:13px;font-weight:700;color:var(--color-ink)}
.pane-note{font-size:11px;color:var(--color-text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pane-body{padding:14px;background:var(--color-neutral-soft);flex:1;display:flex}
.pane-foot{padding:10px 18px;font-size:11px;line-height:1.6;color:var(--color-text-muted);text-align:center;border-top:1px solid var(--color-divider)}

/* 取景框：镜头画面本来就是暗的，用深底比浅灰底更像"正在看摄像头"；
   高度跟视口走，别让 4:5 把整页拉到两千像素高 */
.demo-frame{height:min(58vh,540px);background:radial-gradient(120% 100% at 50% 0%,#263038 0%,#14191d 55%,#0c1013 100%);border-radius:var(--radius-md);position:relative;overflow:hidden;display:grid;place-items:center;width:100%}
.demo-video{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#0d1418}
.demo-video-caption{position:absolute;left:16px;right:16px;bottom:76px;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 12px;border-radius:9px;background:rgba(9,17,20,.78);color:#f2f5f5;font-size:12px;line-height:1.4}
.demo-video-caption a{flex:none;color:#b9dfd8;text-decoration:underline}
.demo-video-count{position:absolute;top:72px;left:16px;display:flex;align-items:center;gap:10px;padding:7px 12px;border-radius:9px;background:rgba(9,17,20,.78);color:#f2f5f5;font-size:14px;font-weight:700}
.frame-sheen{position:absolute;inset:0;border-radius:16px;opacity:.45;pointer-events:none}
.stage-overlay{position:absolute;top:16px;left:16px;right:16px;display:flex;justify-content:space-between;gap:10px}
.badge-group{display:flex;gap:8px;flex-wrap:wrap}
/* 常驻组数徽标：跟练时无论页面滚到哪里，画面里始终能看到"第几组、已完成几组" */
.set-badge{color:var(--color-text-secondary);border-left-color:var(--color-divider)}
.confidence-badge,.phase-badge{padding:8px 12px;border-radius:10px;font-size:12px;font-weight:600;background:var(--surface-glass-strong);backdrop-filter:blur(8px);box-shadow:var(--shadow-sm)}
.confidence-badge.high{color:var(--color-success);border-left:3px solid var(--color-success)}
.confidence-badge.medium{color:var(--color-caution);border-left:3px solid var(--color-caution)}
.confidence-badge.low{color:var(--color-danger);border-left:3px solid var(--color-danger)}
.phase-badge{color:var(--pole-movement-strong);border-left:3px solid var(--pole-movement)}
.stage-live{position:absolute;left:16px;right:16px;bottom:16px;margin:0;padding:10px 14px;border-radius:12px;background:rgba(255,255,255,.92);backdrop-filter:blur(8px);font-size:13px;font-weight:600;color:#15181b;text-align:center;box-shadow:var(--shadow-sm)}
/* F17 休息页：面板盖住画面但 pointer-events:none，点击只会落到按钮上；倒计时数字不做循环动画 */
.rest-overlay{position:absolute;inset:0;display:grid;place-items:center;padding:20px;pointer-events:none;background:rgba(10,14,17,.58);backdrop-filter:blur(2px)}
.rest-panel{width:min(360px,100%);text-align:center;color:#f2f4f6;display:grid;gap:12px}
.rest-kick{font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:rgba(242,244,246,.72)}
.rest-count{font-family:var(--font-num);font-size:72px;font-weight:600;line-height:1;letter-spacing:-.04em;font-variant-numeric:tabular-nums}
.rest-count small{font-size:18px;font-weight:500;margin-left:6px;color:rgba(242,244,246,.7)}
.rest-next{padding:12px 14px;border-radius:12px;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.16)}
.rest-next strong{display:block;font-size:14px}
.rest-next p{margin:6px 0 0;font-size:12px;line-height:1.65;color:rgba(242,244,246,.78);text-align:left}
.rest-actions{display:flex;gap:10px;justify-content:center}
.rest-actions button{pointer-events:auto;min-height:44px;padding:0 18px;border-radius:12px;font-size:13px;font-weight:700;transition:all var(--motion-fast)}
.rest-actions button:hover{transform:translateY(-1px)}
.rest-skip{background:var(--pole-movement);color:var(--color-on-accent)}
.rest-skip.armed{background:var(--color-caution)}
.rest-stop{background:rgba(255,255,255,.14);color:#fff;box-shadow:inset 0 0 0 1px rgba(255,255,255,.22)}
.rest-note{font-size:11px;color:rgba(242,244,246,.6)}
/* F18 计时/计步面板：与取景框同底色的居中面板，地板动作不假装能画站立剪影 */
.hold-panel,.steps-panel{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:24px;text-align:center;color:#f2f4f6}
.hold-kick{font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:rgba(242,244,246,.72)}
.hold-count{font-family:var(--font-num);font-size:88px;font-weight:600;line-height:1;letter-spacing:-.04em;font-variant-numeric:tabular-nums}
.hold-count small{font-size:20px;font-weight:500;margin-left:8px;color:rgba(242,244,246,.7)}
.hold-howto{margin:0;max-width:40ch;font-size:14px;line-height:1.8;color:rgba(242,244,246,.88)}
.hold-note,.steps-note{font-size:11px;color:rgba(242,244,246,.6);line-height:1.6;max-width:44ch}
.steps-meta{margin:0;font-family:var(--font-num);font-size:14px;color:rgba(242,244,246,.85)}
.steps-panel .cam-main-btn{min-height:44px}

/* 摄像头栏：未开启/连接中/出错都是同一块深底上的说明层 */
.cam-frame{position:relative;height:min(58vh,540px);background:#0d1f2c;border-radius:var(--radius-md);overflow:hidden;display:grid;place-items:center;width:100%}
.cam-feed,.cam-overlay{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transform:scaleX(-1)}
.cam-overlay{pointer-events:none}
.cam-idle{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:20px;text-align:center;color:rgba(242,244,246,.85)}
.cam-idle p{margin:0;font-size:13px;line-height:1.7;max-width:36ch}
.cam-idle small{font-size:11px;color:rgba(242,244,246,.6);line-height:1.6}
.cam-idle .cam-error{background:rgba(138,90,0,.28);color:#ffd9a8;border-radius:10px;padding:9px 12px;font-size:12px;max-width:40ch}
.cam-main-btn{min-height:40px;padding:0 18px;border-radius:11px;font-size:13px;font-weight:700;background:var(--pole-movement);color:var(--color-on-accent);transition:all var(--motion-fast)}
.cam-main-btn:hover{transform:translateY(-1px);box-shadow:var(--shadow-sm)}
.cam-main-btn.ghost{background:transparent;color:rgba(242,244,246,.85);box-shadow:inset 0 0 0 1px rgba(255,255,255,.28)}
.cam-angles{position:absolute;left:12px;right:12px;bottom:54px;margin:0;text-align:center;font-family:var(--font-num);font-size:12px;color:rgba(242,244,246,.88);background:rgba(13,31,44,.55);backdrop-filter:blur(6px);border-radius:9px;padding:7px 10px;pointer-events:none}
.cam-calib{position:absolute;left:50%;transform:translateX(-50%);bottom:12px;font-size:12px;font-weight:700;color:#fff;background:rgba(255,255,255,.14);box-shadow:inset 0 0 0 1px rgba(255,255,255,.28);padding:8px 14px;border-radius:999px;min-height:36px;transition:all var(--motion-fast)}
.cam-calib:hover:not(:disabled){background:rgba(255,255,255,.22)}
.cam-calib:disabled{opacity:.5;cursor:not-allowed}

.stage-controls{display:flex;justify-content:center;gap:12px;padding:16px 0}
.ctrl-btn{width:52px;height:52px;border-radius:50%;display:grid;place-items:center;transition:all var(--motion-fast)}
.ctrl-btn.secondary{background:var(--pole-movement-soft);color:var(--pole-movement-strong)}
.ctrl-btn.secondary:hover:enabled{background:var(--pole-movement);color:var(--color-on-accent);transform:scale(1.08)}
.ctrl-btn.danger{background:var(--color-danger-soft);color:var(--color-danger)}
.ctrl-btn.danger:hover:enabled{background:var(--color-danger);color:var(--color-on-danger)}
.ctrl-btn:disabled{opacity:.4;cursor:not-allowed}

.after-area{max-width:760px;margin:0 auto;width:100%}
.actions-card h3{font-size:16px;margin-bottom:8px}
.actions-card p{font-size:13px;color:var(--color-text-secondary);margin-bottom:16px;line-height:1.6}
.actions-card :deep(button){width:100%;margin-bottom:8px}
.correct-form{display:flex;gap:8px;margin-bottom:8px}
.correct-form input{flex:1;min-width:0;padding:0 12px;height:36px;border:1px solid var(--color-border);border-radius:11px;font-size:14px;color:var(--color-ink);background:var(--surface-field)}
.correct-form :deep(button){width:auto;margin-bottom:0;padding:0 18px}
.summary-list{display:grid;gap:9px;list-style:none;padding:0;margin:0 0 14px}
.summary-list li{display:flex;justify-content:space-between;font-size:13px;color:var(--color-text-secondary);animation:slideInUp var(--motion-base) var(--easing-spring) both}
.summary-list b{color:var(--color-ink)}
.stored-note{font-size:12px;color:var(--pole-movement-strong)}
.feedback{border-top:1px solid var(--color-divider);margin-top:14px;padding-top:14px;text-align:left}
.feedback h4{font-size:14px;color:var(--color-ink);margin-bottom:12px}
.field{margin-bottom:12px}
.field-label{display:block;font-size:12px;color:var(--color-text-muted);margin-bottom:6px}
.rpe-row{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px}
.feedback .rpe-chip{width:auto;min-width:34px;height:34px;padding:0 8px;border-radius:10px;margin-bottom:0;background:var(--color-neutral-soft);color:var(--color-text-secondary);font-size:13px;font-weight:700;transition:all var(--motion-fast)}
.feedback .rpe-chip:hover{background:var(--pole-movement-soft);color:var(--pole-movement-strong);transform:translateY(-1px)}
.feedback .rpe-chip.active{background:var(--pole-movement);color:var(--color-on-accent)}
.field small{display:block;font-size:11px;color:var(--color-text-muted);line-height:1.6}
.check{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--color-text-secondary);margin-bottom:12px;cursor:pointer}
.check input{width:16px;height:16px;accent-color:var(--pole-movement)}
.feedback input[type=text],.feedback textarea{width:100%;padding:10px 12px;border:1px solid var(--color-border);border-radius:11px;font-size:13px;font-family:inherit;color:var(--color-ink);background:var(--surface-field);resize:vertical}
.feedback-saved{font-size:13px;color:var(--pole-movement-strong);border-top:1px solid var(--color-divider);margin:14px 0 0;padding-top:14px;text-align:left}
.execution-page :deep(.base-button:focus-visible){box-shadow:0 0 0 3px color-mix(in srgb,var(--pole-movement) 32%,transparent)}
.execution-page button:focus-visible,.execution-page a:focus-visible,.execution-page input:focus-visible,.execution-page select:focus-visible,.execution-page textarea:focus-visible{outline-color:var(--pole-movement)}

@media(max-width:1024px){
  .stage-grid{grid-template-columns:1fr}
  .count-strip{grid-template-columns:1fr 1.4fr 1fr}
}
/* 手机：摄像头缩成演示画面右上角的小框（PiP），其余内容单列 */
@media(max-width:767px){
  .page-header{align-items:flex-start}
  .page-header h1{font-size:22px}
  .stage-grid{display:block;position:relative}
  .pane-demo{margin-bottom:12px}
  .pane-cam{position:absolute;top:8px;right:8px;width:min(138px,40vw);z-index:7;box-shadow:var(--shadow-md);border-radius:var(--radius-md)}
  .pane-cam .pane-head,.pane-cam .pane-foot{display:none}
  .pane-cam .pane-body{padding:6px}
  .pane-cam .cam-frame{height:calc(min(138px,40vw)*1.5)}
  .pane-cam .cam-angles,.pane-cam .cam-calib{display:none}
  .pane-cam .cam-idle{padding:6px;gap:5px}
  .pane-cam .cam-idle p{font-size:10px}
  /* 错误文案在小窗里压紧，别把按钮挤出 overflow:hidden 的取景框 */
  .pane-cam .cam-idle .cam-error{font-size:9.5px;line-height:1.5;padding:6px 8px;max-width:none}
  .pane-cam .cam-main-btn{min-height:28px;padding:0 8px;font-size:10.5px}
  .stage-overlay{flex-direction:column;align-items:flex-start;gap:6px}
  .count-strip{grid-template-columns:1fr 1.4fr}
  .count-strip .strip-cell:last-child{display:none}
  .after-area{max-width:none}
}
</style>
