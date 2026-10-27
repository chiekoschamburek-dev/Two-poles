<template>
  <div class="execution-page">
    <div class="page-header">
      <div>
        <span class="micro kick"><i></i>Camera guided training</span>
        <h1>{{ exercise.name }} · 第 {{ displaySet }} 组</h1>
        <p>{{ live ? '实时摄像头 · 画面只在本机，不上传' : mode === 'camera' ? '实时摄像头 · 正在连接' : '演示回放 · 摄像头原始画面默认不上传' }}</p>
        <div class="exercise-switch">
          <button
            v-for="opt in demoExercises"
            :key="opt.name"
            class="chip"
            :class="{ active: opt.name === exercise.name }"
            @click="selectExercise(opt.name)"
          >{{ opt.name }} · {{ opt.sets }}×{{ opt.repsPerSet }}</button>
        </div>
        <div class="source-switch">
          <button class="chip" :class="{ active: mode === 'demo' }" @click="switchMode('demo')">演示回放</button>
          <button class="chip" :class="{ active: mode === 'camera' }" :disabled="!store.privacy.cameraEnabled" @click="switchMode('camera')">实时摄像头</button>
          <button v-if="pose.errorMessage.value && store.privacy.cameraEnabled" class="chip retry" @click="retryCamera">重试摄像头</button>
          <span class="cam-note" aria-live="polite">{{ sourceNote }}</span>
        </div>
        <p v-if="pose.errorMessage.value" class="cam-error" role="alert">{{ pose.errorMessage.value }}</p>
      </div>
      <BaseButton variant="secondary" :icon="X" @click="leave">结束</BaseButton>
    </div>

    <div class="execution-grid">
      <BaseCard class="stage-card glass animate-slide-in-up">
        <div class="stage-container">
          <div class="demo-frame">
            <template v-if="mode === 'camera'">
              <video ref="videoRef" class="cam-feed" muted playsinline></video>
              <canvas ref="canvasRef" class="cam-overlay"></canvas>
            </template>
            <div v-else class="skeleton-overlay">
              <!-- 3/4 视角的人体。三个要点：
                   1) 远侧四肢压暗、近侧提亮，躯干与头用渐变做出体积，不再是平涂剪影；
                   2) 每个关节都是一个 <g>（髋/膝/踝、肩/肘），下蹲是腿真的折起来，不是整张图压扁；
                   3) 骨线、关节点、哑铃跟四肢同组，所以会跟着关节一起动。 -->
              <svg class="figure" :class="[stageClass, figureJoint]" viewBox="0 0 560 760" aria-hidden="true">
                <defs>
                  <linearGradient id="fxNear" gradientUnits="userSpaceOnUse" x1="150" y1="0" x2="430" y2="0">
                    <stop offset="0" stop-color="#626e79" />
                    <stop offset=".5" stop-color="#4b565f" />
                    <stop offset="1" stop-color="#333b43" />
                  </linearGradient>
                  <linearGradient id="fxFar" gradientUnits="userSpaceOnUse" x1="150" y1="0" x2="430" y2="0">
                    <stop offset="0" stop-color="#454f58" />
                    <stop offset=".55" stop-color="#39424a" />
                    <stop offset="1" stop-color="#262d33" />
                  </linearGradient>
                  <linearGradient id="fxTorso" gradientUnits="userSpaceOnUse" x1="240" y1="200" x2="330" y2="430">
                    <stop offset="0" stop-color="#5d6873" />
                    <stop offset=".45" stop-color="#48535d" />
                    <stop offset="1" stop-color="#2c343b" />
                  </linearGradient>
                  <radialGradient id="fxHead" cx=".34" cy=".28" r=".85">
                    <stop offset="0" stop-color="#727e89" />
                    <stop offset=".55" stop-color="#4f5a64" />
                    <stop offset="1" stop-color="#2c343b" />
                  </radialGradient>
                </defs>

                <ellipse class="shadow" cx="288" cy="714" rx="122" ry="11" />

                <g class="pelvis">
                  <!-- ——— 远侧腿 ——— -->
                  <g class="leg leg-far">
                    <g class="thigh">
                      <path class="limb" d="M306 414 L314 558" stroke="url(#fxFar)" stroke-width="46" />
                      <g class="shin">
                        <path class="limb" d="M314 558 L326 668" stroke="url(#fxFar)" stroke-width="34" />
                        <g class="foot">
                          <path class="limb" d="M326 668 L360 680" stroke="url(#fxFar)" stroke-width="22" />
                        </g>
                        <path class="bone" d="M314 558 L326 668" />
                        <circle class="joint" cx="326" cy="668" r="3.6" />
                      </g>
                      <path class="bone" d="M306 414 L314 558" />
                    </g>
                  </g>

                  <!-- ——— 躯干（含两只手臂与头） ——— -->
                  <g class="torso-g">
                    <!-- 远侧手臂 -->
                    <g class="arm arm-far">
                      <g class="upper">
                        <path class="limb" d="M330 204 L352 314" stroke="url(#fxFar)" stroke-width="38" />
                        <path class="bone" d="M330 204 L352 314" />
                      </g>
                      <g class="fore">
                        <path class="limb" d="M352 314 L360 426" stroke="url(#fxFar)" stroke-width="32" />
                        <path class="bone" d="M352 314 L360 426" />
                        <rect class="db" x="340" y="420" width="40" height="13" rx="6" />
                        <circle class="joint" cx="360" cy="426" r="4.2" />
                      </g>
                      <circle class="joint" cx="352" cy="314" r="4.4" />
                    </g>

                    <!-- 躯干本体：上宽下窄，左侧受光 -->
                    <path class="torso" d="M222 208 C242 194 312 192 334 204 C342 262 330 340 320 414
                                            C300 426 260 428 242 414 C230 340 216 266 222 208 Z" />

                    <!-- 脖子 + 头 -->
                    <path class="limb" d="M276 154 L280 206" stroke="url(#fxNear)" stroke-width="30" />
                    <ellipse class="head" cx="276" cy="118" rx="30" ry="34" />
                    <circle class="headring" cx="276" cy="118" r="42" />
                    <circle class="joint" cx="276" cy="118" r="4" />

                    <!-- 近侧手臂（最后画，压在最上面） -->
                    <g class="arm arm-near">
                      <g class="upper">
                        <path class="limb" d="M226 212 L200 322" stroke="url(#fxNear)" stroke-width="40" />
                        <path class="bone" d="M226 212 L200 322" />
                      </g>
                      <g class="fore">
                        <path class="limb" d="M200 322 L190 436" stroke="url(#fxNear)" stroke-width="34" />
                        <path class="bone" d="M200 322 L190 436" />
                        <rect class="db" x="170" y="430" width="40" height="13" rx="6" />
                        <circle class="joint" cx="190" cy="436" r="4.4" />
                      </g>
                      <circle class="joint" cx="200" cy="322" r="4.6" />
                    </g>
                  </g>

                  <!-- ——— 近侧腿（压在躯干下缘前面） ——— -->
                  <g class="leg leg-near">
                    <g class="thigh">
                      <path class="limb" d="M250 420 L236 566" stroke="url(#fxNear)" stroke-width="50" />
                      <g class="shin">
                        <path class="limb" d="M236 566 L226 678" stroke="url(#fxNear)" stroke-width="38" />
                        <g class="foot">
                          <path class="limb" d="M226 678 L192 690" stroke="url(#fxNear)" stroke-width="24" />
                        </g>
                        <path class="bone" d="M236 566 L226 678" />
                        <circle class="joint" cx="226" cy="678" r="3.8" />
                      </g>
                      <path class="bone" d="M250 420 L236 566" />
                    </g>
                  </g>

                  <!-- 骨架主干（画在最上层，和实时模式的骨架同色） -->
                  <g class="spine-g">
                    <path class="bone" d="M276 206 L280 418" />
                    <path class="bone soft" d="M226 212 L330 204" />
                    <path class="bone soft" d="M250 420 L306 414" />
                    <circle class="joint" cx="276" cy="206" r="4" />
                    <circle class="joint" cx="226" cy="212" r="4.6" />
                    <circle class="joint" cx="330" cy="204" r="4.6" />
                    <circle class="joint" cx="250" cy="420" r="4.8" />
                    <circle class="joint" cx="306" cy="414" r="4.8" />
                  </g>
                </g>
              </svg>
            </div>
            <div v-if="mode === 'demo' || live" class="stage-overlay">
              <span class="confidence-badge animate-fade-in" :class="confidenceClass" :key="confidenceClass">{{ confidenceText }}</span>
              <span class="phase-badge" :class="{ 'animate-pulse': status === 'resting' }">{{ phaseLabel }}</span>
            </div>
            <div class="frame-sheen gradient-shimmer" v-if="mode === 'demo' && !finished && !paused"></div>
            <p class="stage-live" aria-live="polite">{{ stageMessage }}</p>
          </div>
          <div class="stage-hint">{{ stageHint }}</div>
        </div>
        <div class="stage-controls">
          <button class="ctrl-btn secondary" :aria-label="paused ? '继续' : '暂停'" :disabled="finished || cameraConnecting" @click="togglePause">
            <Pause v-if="!paused" :size="20" /><Play v-else :size="20" />
          </button>
          <button class="ctrl-btn secondary" aria-label="跳过本组" :disabled="finished || cameraConnecting" @click="skipSet">
            <SkipForward :size="20" />
          </button>
          <button class="ctrl-btn danger" aria-label="结束并记录" :disabled="finished || cameraConnecting" @click="stopAndRecord">
            <Square :size="18" />
          </button>
        </div>
      </BaseCard>

      <div class="info-cards">
        <BaseCard class="count-card animate-slide-in-up">
          <div class="count-label">当前组数</div>
          <div class="count-big">{{ displaySet }} <span>/ {{ exercise.sets }}</span></div>
          <div class="count-progress"><div class="progress-fill" :style="{ width: setProgress + '%' }"></div></div>
        </BaseCard>

        <BaseCard class="count-card primary animate-slide-in-up">
          <div class="count-label">本组完成次数</div>
          <div class="count-big">{{ displayReps }} <span>/ {{ exercise.repsPerSet }}</span></div>
          <div class="reps-grid" :style="{ gridTemplateColumns: 'repeat(' + exercise.repsPerSet + ', 1fr)' }">
            <span v-for="n in exercise.repsPerSet" :key="n" :class="{ done: n <= displayReps }"></span>
          </div>
        </BaseCard>

        <BaseCard class="animate-slide-in-up">
          <div class="status-item">
            <Activity :size="18" class="status-icon" />
            <div><strong>{{ phaseLabel }}</strong><small>{{ message || '保持动作流畅' }}</small></div>
          </div>
          <div class="status-item">
            <Gauge :size="18" class="status-icon teal" />
            <div><strong>{{ live ? '关键点可见度' : '识别置信度' }}: {{ Math.round(shownConfidence * 100) }}%</strong><small>{{ confidenceText }}</small></div>
          </div>
          <div class="status-item" v-if="live">
            <Ruler :size="18" class="status-icon teal" />
            <div>
              <strong>膝 {{ pose.kneeAngle ?? '—' }}° · 髋 {{ pose.hipAngle ?? '—' }}° · 肘 {{ pose.elbowAngle ?? '—' }}°</strong>
              <small>取左侧关键点。{{ camJoint === 'knee' ? '计数看膝角' : '计数看肘角' }}，其余角度只作参考，不判断姿势是否标准。</small>
            </div>
          </div>
          <div v-if="live && counter" class="calib">
            <button class="calib-btn" :disabled="calibrating" @click="runCalibrate">{{ calibrating ? '校准中…' : '校准机位' }}</button>
            <small>{{ counter.calibratedNeutral !== null ? `起始位 ${counter.calibratedNeutral}°` : '未校准：用动作库默认阈值' }}</small>
          </div>
          <div class="status-item">
            <Timer :size="18" class="status-icon teal" />
            <div><strong>{{ Math.floor(elapsedMs / 1000) }}s</strong><small>已用时长</small></div>
          </div>
        </BaseCard>

        <BaseCard v-if="!finished" class="actions-card animate-slide-in-up">
          <h3>完成后记录</h3>
          <p>完成次数可以修正。看不清时暂停计数，不输出姿势安全结论。共 {{ exercise.sets }} 组，每组 {{ exercise.repsPerSet }} 次，组间休息 {{ exercise.restDuration / 1000 }} 秒。</p>
          <BaseButton variant="secondary" size="sm" :icon="Edit3" @click="toggleEdit">手动修正</BaseButton>
          <div v-if="editOpen" class="correct-form">
            <input v-model.number="editValue" type="number" min="0" :max="exercise.repsPerSet" aria-label="修正本组次数" />
            <BaseButton size="sm" @click="applyCorrection">确认</BaseButton>
          </div>
          <BaseButton variant="ghost" size="sm" :icon="FileText" @click="leave">放弃本次记录</BaseButton>
        </BaseCard>

        <BaseCard v-else class="actions-card summary animate-slide-in-up">
          <h3>本次已记录</h3>
          <ul class="summary-list">
            <li><span>动作</span><b>{{ exercise.name }}</b></li>
            <li><span>完成组数</span><b>{{ repsBySet.length }} / {{ exercise.sets }}</b></li>
            <li><span>总次数</span><b>{{ totalReps }} / {{ exercise.sets * exercise.repsPerSet }}</b></li>
            <li><span>平均置信度</span><b>{{ Math.round(averageConfidence * 100) }}%</b></li>
            <li><span>手动修正</span><b>{{ manualCorrections }} 次</b></li>
            <li><span>状态</span><b>{{ completionLabel }}</b></li>
            <li><span>RPE</span><b>{{ feedbackSaved ? (rpe === null ? '未记录' : rpe) : '待反馈' }}</b></li>
          </ul>

          <div v-if="!feedbackSaved" class="feedback">
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
          <p v-else class="feedback-saved">
            反馈{{ rpe === null && !discomfort ? '已跳过' : '已保存' }}：RPE {{ rpe === null ? '未记录' : rpe }} · {{ discomfort ? '有不适' : '无不适' }}
          </p>

          <p class="stored-note">{{ recordedNote }}</p>
          <BaseButton size="sm" :icon="Play" @click="restart">再练一遍</BaseButton>
          <BaseButton variant="secondary" size="sm" @click="leave">返回概览</BaseButton>
        </BaseCard>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { X, Pause, Play, SkipForward, Square, Activity, Gauge, Edit3, FileText, Timer, Ruler } from 'lucide-vue-next'
import BaseCard from '@/components/common/BaseCard.vue'
import BaseButton from '@/components/common/BaseButton.vue'
import { useAppStore } from '@/stores/app'
import { usePoseCamera } from '@/composables/usePoseCamera'
import { useRepCounter } from '@/composables/useRepCounter'
import { findExercise } from '@/services/exercises'
import type { DemoEvent, ExercisePhase } from '@/types/domain'
import {
  demoExercises,
  getDemoExercise,
  getPhaseText,
  getConfidenceLevel,
  summarizeSession
} from '@/services/demoCameraService'

const route = useRoute()
const router = useRouter()
const store = useAppStore()

const exercise = ref(getDemoExercise(route.query.exercise as string))
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
const rpe = ref<number | null>(null)
const discomfort = ref(false)
const reasonText = ref('')
const notesText = ref('')
const feedbackSaved = ref(false)
const pose = usePoseCamera()
const mode = ref<'demo' | 'camera'>('demo')
const videoRef = ref<HTMLVideoElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)

/** F05：实时摄像头分支用关键点角度驱动状态机计数；演示回放仍走预设时间线 */
const counter = ref<ReturnType<typeof useRepCounter> | null>(null)
const camJoint = ref<'knee' | 'elbow'>('knee')
const calibrating = ref(false)
/** session-RPE 量表含 0 档：0 表示几乎不费力 */
const RPE_SCALE = Array.from({ length: 11 }, (_, i) => i)
/** 用户手工修正过本组次数后，状态机不再回写 reps */
let corrected = false

function buildCounter() {
  const cam = findExercise(exercise.value.name)?.camera
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
    const angle = camJoint.value === 'knee' ? pose.kneeAngle.value : pose.elbowAngle.value
    return angle === null ? null : { angle, visibility: pose.visibility.value }
  })
  store.showToast({
    type: ok ? 'success' : 'warning',
    title: ok ? '机位已校准' : '校准未完成',
    message: ok
      ? `阈值按你的起始姿势（${c.calibratedNeutral}°）设定，不是通用标准姿势判定`
      : '请让侧面全身完整入镜、光线稳定后重试',
    duration: 3500
  })
}

let setElapsed = 0
let restElapsed = 0
let eventIndex = 0
let lastTs = 0
let rafId = 0
let tweenRaf = 0
let confidenceSum = 0
let confidenceCount = 0
let recorded = false

const live = computed(() => mode.value === 'camera' && pose.status.value === 'live')
const cameraConnecting = computed(() => mode.value === 'camera' && pose.status.value === 'starting')
const stageMessage = computed(() => {
  if (mode.value === 'camera' && pose.status.value !== 'live') {
    if (pose.status.value === 'starting') {
      return pose.startingStage.value === 'camera'
        ? '正在请求摄像头权限…'
        : '相机已连接，正在加载姿态模型…'
    }
    return pose.errorMessage.value || '摄像头未就绪'
  }
  return message.value
})
const shownConfidence = computed(() => (live.value ? pose.visibility.value : confidence.value))
const confidenceLevel = computed(() => getConfidenceLevel(shownConfidence.value))
const confidenceClass = computed(() => confidenceLevel.value.level)
const confidenceText = computed(() => confidenceLevel.value.text)

const sourceNote = computed(() => {
  if (cameraConnecting.value) {
    return pose.startingStage.value === 'camera'
      ? '正在请求摄像头权限…'
      : '相机已就绪，正在加载端侧姿态模型（首次约 5.5 MB）…'
  }
  if (live.value) {
    const where = pose.runsIn.value === 'main' ? ' · 推理回落主线程' : ''
    return `${pose.fps.value} FPS · ${pose.delegate.value === 'GPU' ? 'GPU' : 'CPU'} 推理${where} · 画面只在本机，不上传`
  }
  if (!store.privacy.cameraEnabled) return '摄像头已在设置中关闭，当前只有演示回放'
  return '按预设时间线回放，不需要摄像头'
})
const stageHint = computed(() => {
  if (cameraConnecting.value) {
    return pose.startingStage.value === 'camera'
      ? '等待摄像头授权…'
      : '相机已连接 · 正在准备端侧姿态模型…'
  }
  if (mode.value === 'camera' && !live.value) return pose.errorMessage.value || '摄像头未就绪'
  if (!live.value) return '关键点示意图 · 实际使用时在本地处理'
  const c = counter.value
  if (!c) return '识别：端侧关键点 · 该动作暂无计数规则，可用手工修正'
  return `识别：端侧关键点实时驱动计数（${camJoint.value === 'knee' ? '膝角' : '肘角'}）· 阈值 ${Math.round(c.lowThreshold)}° · ${c.calibratedNeutral !== null ? '已按你的机位校准' : '未校准，用规则默认阈值'}`
})

async function switchMode(next: 'demo' | 'camera') {
  if (next === mode.value) return
  if (next === 'camera' && !store.privacy.cameraEnabled) return
  if (next === 'camera') {
    mode.value = 'camera'
    counter.value = null
    await nextTick()
    if (!videoRef.value || !canvasRef.value) {
      mode.value = 'demo'
      pose.errorMessage.value = '摄像头画面容器没有准备好，请重试。'
      return
    }
    await pose.start(videoRef.value, canvasRef.value)
    if (mode.value !== 'camera') return
    if (pose.status.value === 'live') {
      restart()
    } else {
      mode.value = 'demo'
      counter.value = null
      restart()
    }
    return
  }
  pose.stop()
  pose.errorMessage.value = ''
  counter.value = null
  mode.value = 'demo'
  restart()
}

async function retryCamera() {
  if (!store.privacy.cameraEnabled) return
  pose.stop()
  pose.errorMessage.value = ''
  mode.value = 'demo'
  await nextTick()
  await switchMode('camera')
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
const setProgress = computed(() => {
  const within = Math.min(reps.value / exercise.value.repsPerSet, 1)
  return ((displaySet.value - 1 + within) / exercise.value.sets) * 100
})
const phaseLabel = computed(() => {
  if (finished.value) return '已完成'
  if (status.value === 'resting') return '组间休息'
  if (paused.value) return '已暂停'
  return getPhaseText(phase.value)
})
const stageClass = computed(() =>
  paused.value || status.value === 'resting' ? 'held' : phase.value
)
/** 演示剪影按动作切姿态：弯举看肘、坐站看膝。和计数用的 camJoint 分开——演示模式下也要对 */
const figureJoint = computed(() => findExercise(exercise.value.name)?.camera?.joint ?? 'knee')
const totalReps = computed(() => repsBySet.value.reduce((sum, n) => sum + n, 0))
const averageConfidence = computed(() => (confidenceCount ? confidenceSum / confidenceCount : 0))
const completionLabel = computed(() => {
  const target = exercise.value.sets * exercise.value.repsPerSet
  return repsBySet.value.length >= exercise.value.sets && totalReps.value >= target ? '全部完成' : '部分完成'
})

function tick(ts: number) {
  // 相机正在授权/加载模型时不继续演示时间线，避免两套计数混在一起
  if (mode.value === 'camera' && !live.value) {
    if (!finished.value) rafId = requestAnimationFrame(tick)
    return
  }
  if (!lastTs) lastTs = ts
  // 后台标签页回来时 ts 会一次性跳大，钳制增量以免事件被成批吞掉
  const dt = Math.min(ts - lastTs, 250)
  lastTs = ts

  if (!paused.value && status.value === 'playing') {
    elapsedMs.value += dt
    setElapsed += dt
    if (live.value && counter.value) {
      const c = counter.value
      const angle = camJoint.value === 'knee' ? pose.kneeAngle.value : pose.elbowAngle.value
      const res = c.feed(angle, pose.visibility.value, ts)
      if (res.counted) {
        store.showToast({ type: 'success', title: `第 ${c.count} 次`, message: '关键点回到起始位，计为一次', duration: 1200 })
      }
      confidence.value = pose.visibility.value
      confidenceSum += pose.visibility.value
      confidenceCount++
      phase.value = res.phase
      if (res.gate) message.value = res.gate
      if (!corrected) reps.value = Math.min(c.count, exercise.value.repsPerSet)
      if (c.count >= exercise.value.repsPerSet && !corrected) {
        message.value = '本组次数已达标'
        finishSet()
      }
    } else {
      const events = exercise.value.setEvents
      while (eventIndex < events.length && events[eventIndex].time <= setElapsed) {
        applyEvent(events[eventIndex])
        eventIndex++
      }
    }
  } else if (!paused.value && status.value === 'resting') {
    elapsedMs.value += dt
    restElapsed += dt
    message.value = `组间休息 ${Math.max(Math.ceil((exercise.value.restDuration - restElapsed) / 1000), 0)} 秒`
    if (restElapsed >= exercise.value.restDuration) startNextSet()
  }

  if (!finished.value) rafId = requestAnimationFrame(tick)
}

function applyEvent(event: DemoEvent) {
  if (event.count !== undefined) reps.value = event.count
  if (event.confidence > 0) {
    confidenceSum += event.confidence
    confidenceCount++
    confidence.value = event.confidence
  }
  phase.value = event.state
  if (event.message) message.value = event.message
  if (event.state === 'complete') finishSet()
}

function closeCurrentSet() {
  if (repsBySet.value.length < setIndex.value) repsBySet.value.push(reps.value)
}

function finishSet() {
  closeCurrentSet()
  if (setIndex.value < exercise.value.sets) {
    status.value = 'resting'
    restElapsed = 0
  } else {
    complete()
  }
}

function startNextSet() {
  setIndex.value++
  reps.value = 0
  eventIndex = 0
  setElapsed = 0
  corrected = false
  counter.value?.reset('新一组开始：请回到起始姿势')
  status.value = 'playing'
  message.value = `第 ${setIndex.value} 组开始`
}

function skipSet() {
  closeCurrentSet()
  if (setIndex.value < exercise.value.sets) {
    startNextSet()
    store.showToast({ type: 'info', title: `已跳到第 ${setIndex.value} 组`, duration: 2000 })
  } else {
    complete()
  }
}

function stopAndRecord() {
  closeCurrentSet()
  complete()
}

function complete() {
  if (finished.value) return
  finished.value = true
  status.value = 'idle'
  phase.value = 'complete'
  message.value = '训练完成'
  record()
}

function record() {
  if (recorded || !repsBySet.value.length) return
  recorded = true
  const session = store.addSession(
    summarizeSession({
      exercise: exercise.value,
      setsCompleted: repsBySet.value.length,
      repsBySet: repsBySet.value,
      averageConfidence: averageConfidence.value,
      manualCorrections: manualCorrections.value,
      elapsedMs: elapsedMs.value
    })
  )
  recordedId.value = session.id
  recordedNote.value = `已保存到本地记录（共 ${store.sessions.length} 条）`
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
  const next = Math.max(0, Math.min(editValue.value, exercise.value.repsPerSet))
  if (next !== reps.value) manualCorrections.value++
  reps.value = next
  corrected = true
  editOpen.value = false
  store.showToast({ type: 'info', title: `本组次数已修正为 ${next}`, message: '计数与修正值分别保留，不覆盖模型计数', duration: 2200 })
}

function togglePause() {
  if (finished.value) return
  paused.value = !paused.value
  if (paused.value) lastTs = 0
  message.value = paused.value ? '已暂停' : '继续训练'
}

function selectExercise(name: string) {
  exercise.value = getDemoExercise(name)
  router.replace({ path: '/execution', query: { exercise: name } })
  restart()
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
  eventIndex = 0
  lastTs = 0
  confidenceSum = 0
  confidenceCount = 0
  recorded = false
  corrected = false
  if (live.value) buildCounter()
  rafId = requestAnimationFrame(tick)
}

function leave() {
  router.push('/')
}

onMounted(() => restart())
onUnmounted(() => {
  cancelAnimationFrame(rafId)
  cancelAnimationFrame(tweenRaf)
})
</script>

<style scoped>
.execution-page{max-width:1400px;margin:auto}
.page-header{display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:20px;gap:16px}
.kick{display:inline-flex;align-items:center;gap:8px}.kick i{width:14px;height:1px;background:var(--pole-movement);display:block}
.page-header h1{font-size:28px;margin:7px 0 5px}
.page-header p{color:var(--color-text-muted);font-size:13px;margin:0}
.exercise-switch{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap}
.source-switch{display:flex;align-items:center;gap:8px;margin-top:10px;flex-wrap:wrap}
.cam-note{font-size:12px;color:var(--color-text-muted)}
.chip.retry{background:var(--color-card);color:var(--color-caution);box-shadow:inset 0 0 0 1px rgba(138,90,0,.28)}
.cam-error{margin:9px 0 0;padding:8px 11px;border-radius:8px;background:var(--color-caution-soft);color:var(--color-caution);font-size:12px;line-height:1.65}
.cam-feed,.cam-overlay{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transform:scaleX(-1)}
.cam-feed{background:#0d1f2c}
.cam-overlay{pointer-events:none}
.chip{padding:7px 13px;border-radius:999px;font-size:12px;font-weight:600;color:var(--pole-movement-strong);background:var(--pole-movement-soft);transition:all var(--motion-fast)}
.chip.active{background:var(--pole-movement);color:var(--color-on-accent)}
.chip:hover:enabled{transform:translateY(-1px);box-shadow:var(--shadow-sm)}
.chip:disabled{opacity:.45;cursor:not-allowed}
.execution-grid{display:grid;grid-template-columns:1.4fr 1fr;gap:20px}
.stage-card{padding:0!important;overflow:hidden}
.stage-container{padding:24px;background:var(--color-neutral-soft)}
/* 取景框：镜头画面本来就是暗的，用深底比浅灰底更像"正在看摄像头"；
   高度跟视口走，别让 4:5 把整页拉到两千像素高 */
.demo-frame{height:min(64vh,580px);background:radial-gradient(120% 100% at 50% 0%,#263038 0%,#14191d 55%,#0c1013 100%);border-radius:var(--radius-md);position:relative;overflow:hidden;display:grid;place-items:center}
/* 骨架配色见下方 .figure 段（3/4 视角 + 关节层级） */
/* 人物：远侧压暗、近侧提亮，躯干与头用渐变做体积；关节各是一个 <g>，动作靠转关节而不是压扁整张图 */
.skeleton-overlay{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:14px 0 74px}
.figure{height:100%;width:auto;max-width:100%;overflow:visible;transition:opacity var(--motion-base) var(--easing-ease-out)}
.figure.held{opacity:.55}
.figure.occluded{opacity:.3}

.figure .limb{fill:none;stroke-linecap:round}
.figure .torso{fill:url(#fxTorso)}
.figure .head{fill:url(#fxHead)}
/* 近侧肢体压一层投影，把它从躯干上"抬"起来，否则前臂贴在胸口会糊成一块 */
.figure .arm-near,.figure .leg-near{filter:drop-shadow(0 1px 3px rgba(0,0,0,.45))}
.figure .shadow{fill:rgba(0,0,0,.42);transform-box:view-box;transform-origin:288px 714px;transition:transform 460ms var(--easing-ease-out)}

/* 姿态叠加 */
.figure .bone{fill:none;stroke:var(--brand-pole-a-dark);stroke-width:2.2;stroke-linecap:round;opacity:.92}
.figure .bone.soft{opacity:.32}
.figure .joint{fill:var(--brand-pole-a-dark)}
.figure .headring{fill:none;stroke:color-mix(in srgb,var(--brand-pole-a-dark) 40%,transparent);stroke-width:1.6;stroke-dasharray:3 8}
.figure .db{fill:#2c363e;stroke:var(--brand-pole-a-dark);stroke-width:1.4}
/* 坐站训练不握器械：只在弯举这类肘主导的动作里画哑铃 */
.figure.knee .db{display:none}

/* ——— 关节：每个 <g> 一个转轴（transform-box:view-box 让坐标就是画布坐标） ——— */
.figure .pelvis,
.figure .thigh,
.figure .shin,
.figure .foot,
.figure .torso-g,
.figure .upper,
.figure .fore{transform-box:view-box;transition:transform 460ms cubic-bezier(.34,1.2,.64,1)}
.figure .pelvis{transform-origin:280px 714px}
.figure .torso-g{transform-origin:280px 418px}
.figure .leg-far .thigh{transform-origin:306px 414px}
.figure .leg-near .thigh{transform-origin:250px 420px}
.figure .leg-far .shin{transform-origin:314px 558px}
.figure .leg-near .shin{transform-origin:236px 566px}
.figure .leg-far .foot{transform-origin:326px 668px}
.figure .leg-near .foot{transform-origin:226px 678px}
.figure .arm-far .upper{transform-origin:330px 204px}
.figure .arm-far .fore{transform-origin:352px 314px}
.figure .arm-near .upper{transform-origin:226px 212px}
.figure .arm-near .fore{transform-origin:200px 322px}

/* 弯举：前臂绕肘转、肩略抬；远侧滞后一点，两根手臂不再是同步的杆 */
.figure.up.elbow .arm-near .fore{transform:rotate(-168deg)}
.figure.up.elbow .arm-far .fore{transform:rotate(-152deg)}
.figure.up.elbow .arm-near .upper{transform:rotate(-7deg)}
.figure.up.elbow .arm-far .upper{transform:rotate(-4deg)}

/* 坐站：骨盆沉降 + 大腿前折并缩短（透视）+ 小腿回收 + 脚掌压平 */
.figure.knee.down .pelvis{transform:translate(-8px,46px)}
.figure.knee.down .thigh{transform:rotate(15deg) scaleY(.73)}
.figure.knee.down .shin{transform:rotate(-32deg)}
.figure.knee.down .foot{transform:rotate(30deg)}
.figure.knee.down .torso-g{transform:rotate(5deg)}
/* 下蹲时手臂前摆作配重，静止垂着会显得像木偶 */
.figure.knee.down .arm-near .upper{transform:rotate(14deg)}
.figure.knee.down .arm-far .upper{transform:rotate(9deg)}
.figure.knee.down .shadow{transform:scale(1.06)}
.frame-sheen{position:absolute;inset:0;border-radius:16px;opacity:.45;pointer-events:none}
.stage-overlay{position:absolute;top:16px;left:16px;right:16px;display:flex;justify-content:space-between;gap:10px}
.confidence-badge,.phase-badge{padding:8px 12px;border-radius:10px;font-size:12px;font-weight:600;background:var(--surface-glass-strong);backdrop-filter:blur(8px);box-shadow:var(--shadow-sm)}
.confidence-badge.high{color:var(--color-success);border-left:3px solid var(--color-success)}
.confidence-badge.medium{color:var(--color-caution);border-left:3px solid var(--color-caution)}
.confidence-badge.low{color:var(--color-danger);border-left:3px solid var(--color-danger)}
.phase-badge{color:var(--pole-movement-strong);border-left:3px solid var(--pole-movement)}
.stage-live{position:absolute;left:16px;right:16px;bottom:16px;margin:0;padding:10px 14px;border-radius:12px;background:rgba(255,255,255,.92);backdrop-filter:blur(8px);font-size:13px;font-weight:600;color:#15181b;text-align:center;box-shadow:var(--shadow-sm)}
.stage-hint{padding:12px 24px;font-size:11px;color:var(--color-text-muted);text-align:center;background:var(--color-card);border-top:1px solid var(--color-divider)}
.stage-controls{display:flex;justify-content:center;gap:12px;padding:20px;background:var(--color-neutral-soft)}
.ctrl-btn{width:52px;height:52px;border-radius:50%;display:grid;place-items:center;transition:all var(--motion-fast)}
.ctrl-btn.secondary{background:var(--pole-movement-soft);color:var(--pole-movement-strong)}
.ctrl-btn.secondary:hover:enabled{background:var(--pole-movement);color:var(--color-on-accent);transform:scale(1.08)}
.ctrl-btn.danger{background:var(--color-danger-soft);color:var(--color-danger)}
.ctrl-btn.danger:hover:enabled{background:var(--color-danger);color:var(--color-on-danger)}
.ctrl-btn:disabled{opacity:.4;cursor:not-allowed}
.info-cards{display:grid;gap:18px}
.count-card{text-align:center;padding:22px!important}
.count-label{font-size:12px;color:var(--color-text-muted);margin-bottom:8px}
.count-big{font-family:var(--font-num);font-size:64px;font-weight:600;letter-spacing:-.045em;line-height:1;margin-bottom:14px;font-variant-numeric:tabular-nums;color:var(--color-ink)}
.count-big span{font-size:18px;color:var(--color-text-muted);-webkit-text-fill-color:currentColor;letter-spacing:0}
.count-card.primary .count-big{color:var(--pole-movement)}
.count-progress{height:6px;background:var(--color-divider);border-radius:10px;overflow:hidden;box-shadow:inset 0 1px 2px rgba(21,24,27,.1)}
.progress-fill{height:100%;background:linear-gradient(90deg,var(--pole-movement),var(--pole-movement-strong));border-radius:10px;box-shadow:0 0 10px color-mix(in srgb,var(--pole-movement) 45%,transparent);transition:width var(--motion-slow) var(--easing-ease-out)}
.reps-grid{display:grid;gap:6px;margin-top:4px}
.reps-grid span{height:5px;background:var(--color-divider);border-radius:3px}
.reps-grid span.done{background:var(--pole-movement);animation:scaleIn var(--motion-base) var(--easing-spring) both}
.status-item{display:flex;align-items:flex-start;gap:12px;padding:12px 0;border-bottom:1px solid var(--color-divider)}
.status-item:last-child{border:0}
.status-icon{color:var(--color-text-secondary);margin-top:2px}
.status-icon.teal{color:var(--pole-movement)}
.status-item strong,.status-item small{display:block}
.status-item strong{font-size:14px}
.status-item small{font-size:12px;color:var(--color-text-muted);margin-top:3px}
.calib{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:2px 0 4px}
.calib-btn{font-size:12px;font-weight:700;color:var(--pole-movement-strong);background:var(--pole-movement-soft);padding:9px 14px;border-radius:10px;min-height:44px;transition:all var(--motion-fast)}
.calib-btn:hover:not(:disabled){background:var(--pole-movement-line)}
.calib-btn:disabled{opacity:.55;cursor:progress}
.calib small{font-size:11px;color:var(--color-text-muted)}
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
@media(max-width:1024px){.execution-grid{grid-template-columns:1fr}.info-cards{grid-template-columns:repeat(2,1fr)}.actions-card{grid-column:1/-1}}
@media(max-width:767px){.page-header{align-items:flex-start}.page-header h1{font-size:22px}.info-cards{grid-template-columns:1fr}}
</style>
