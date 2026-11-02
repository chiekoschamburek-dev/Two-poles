<template>
  <div class="execution-page">
    <div class="page-header">
      <div>
        <span class="micro kick"><i></i>Camera guided training</span>
        <h1>{{ exercise.name }} · 第 {{ displaySet }} 组</h1>
        <p>左侧跟随演示动作，右侧开启摄像头后由端侧关键点计数；画面只在本机，不上传</p>
        <div class="exercise-switch">
          <button
            v-for="opt in demoExercises"
            :key="opt.name"
            class="chip"
            :class="{ active: opt.name === exercise.name }"
            @click="selectExercise(opt.name)"
          >{{ opt.name }} · {{ opt.name === exercise.name ? exerciseChipLabel(exercise) : exerciseChipLabel(opt) }}</button>
        </div>
      </div>
      <BaseButton variant="secondary" :icon="X" @click="leave">结束</BaseButton>
    </div>

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
          <div class="strip-num">{{ displayReps }}<i>/{{ exercise.repsPerSet }}</i></div>
          <div class="strip-dots" :style="{ gridTemplateColumns: 'repeat(' + Math.min(exercise.repsPerSet, 10) + ', 1fr)' }">
            <span v-for="n in exercise.repsPerSet" :key="n" :class="{ done: n <= displayReps }"></span>
          </div>
        </template>
        <template v-else-if="isTimeMode">
          <span class="strip-label">本组保持</span>
          <div class="strip-num">{{ holdLeft }}<i>秒</i></div>
          <div class="strip-bar"><div class="strip-fill" :style="{ width: holdProgress + '%' }"></div></div>
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

    <div class="stage-grid">
      <!-- 左：演示动作（始终播放；摄像头开启时剪影同步被识别到的阶段） -->
      <BaseCard class="pane pane-demo glass animate-slide-in-up">
        <div class="pane-head">
          <span class="pane-title">演示动作</span>
          <span class="pane-note">跟随示意节奏</span>
        </div>
        <div class="pane-body">
          <div class="demo-frame">
            <template v-if="isRepsMode">
            <div class="skeleton-overlay">
              <!-- 3/4 视角的人体。三个要点：
                   1) 远侧四肢压暗、近侧提亮，躯干与头用渐变做出体积，不再是平涂剪影；
                   2) 每个关节都是一个 <g>（髋/膝/踝、肩/肘），下蹲是腿真的折起来，不是整张图压扁；
                   3) 骨线、关节点、哑铃跟四肢同组，所以会跟着关节一起动。 -->
              <svg class="figure" :class="[stageClass, figureKind]" viewBox="0 0 560 760" aria-hidden="true">
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
            </template>
            <!-- F18 计时保持型：保持倒计时 + 动作要领，地板动作不假装能画站立剪影 -->
            <div v-else-if="isTimeMode" class="hold-panel">
              <span class="hold-kick">保持</span>
              <div class="hold-count" aria-hidden="true">{{ holdLeft }}<small>秒</small></div>
              <p class="hold-howto">{{ exerciseHowto }}</p>
              <small class="hold-note">倒计时结束自动进入下一组；姿势自查可开右侧摄像头</small>
            </div>
            <!-- F18 计步型：步数 / 步频 + 传感器状态；不可用时如实降级为手动计时 -->
            <div v-else class="steps-panel">
              <span class="hold-kick">计步</span>
              <div class="hold-count" aria-hidden="true">{{ stepCounter.steps.value }}<small>步</small></div>
              <p class="steps-meta">{{ stepsMeta }}</p>
              <button v-if="stepCounter.status.value === 'idle'" type="button" class="cam-main-btn" @click="startSteps">开启计步</button>
              <small class="steps-note">{{ stepsNote }}</small>
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
        <div class="pane-foot">{{ demoHint }}</div>
      </BaseCard>

      <!-- 右：实时摄像头（独立开关，与演示同屏） -->
      <BaseCard class="pane pane-cam glass animate-slide-in-up">
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
              <button v-if="store.privacy.cameraEnabled" type="button" class="cam-main-btn" @click="startCamera">开启摄像头</button>
              <small v-else>摄像头已在设置中关闭；到「设置 → 隐私」可重新打开</small>
            </div>
            <div v-else-if="cameraConnecting" class="cam-idle">
              <p>{{ pose.startingStage.value === 'camera' ? '正在请求摄像头权限…' : '相机已连接，正在加载端侧姿态模型（首次约 5.5 MB）…' }}</p>
              <button type="button" class="cam-main-btn ghost" @click="stopCamera">取消</button>
            </div>
            <div v-else-if="camErrored" class="cam-idle">
              <p class="cam-error" role="alert">{{ pose.errorMessage.value }}</p>
              <button v-if="store.privacy.cameraEnabled" type="button" class="cam-main-btn" @click="startCamera">重试</button>
              <button type="button" class="cam-main-btn ghost" @click="stopCamera">关闭</button>
            </div>
            <template v-else-if="live">
              <div class="cam-angles" aria-hidden="true">膝 {{ pose.kneeAngle ?? '—' }}° · 髋 {{ pose.hipAngle ?? '—' }}° · 肘 {{ pose.elbowAngle ?? '—' }}°</div>
              <button
                class="cam-calib"
                :disabled="calibrating || !counter"
                @click="runCalibrate"
              >{{ calibrating ? '校准中…' : counter ? '校准机位' : '该动作无计数规则' }}</button>
            </template>
          </div>
        </div>
        <div class="pane-foot">{{ camHint }}</div>
      </BaseCard>
    </div>

    <div class="stage-controls">
      <button class="ctrl-btn secondary" :aria-label="paused ? '继续' : '暂停'" :disabled="finished" @click="togglePause">
        <Pause v-if="!paused" :size="20" /><Play v-else :size="20" />
      </button>
      <button class="ctrl-btn secondary" aria-label="跳过本组" :disabled="finished" @click="skipSet">
        <SkipForward :size="20" />
      </button>
      <button class="ctrl-btn danger" aria-label="结束并记录" :disabled="finished" @click="stopAndRecord">
        <Square :size="18" />
      </button>
    </div>

    <div class="after-area">
      <BaseCard v-if="!finished" class="actions-card animate-slide-in-up">
        <h3>完成后记录</h3>
        <p v-if="isRepsMode">完成次数可以修正。看不清时暂停计数，不输出姿势安全结论。共 {{ exercise.sets }} 组，每组 {{ exercise.repsPerSet }} 次，组间休息 {{ exercise.restDuration / 1000 }} 秒。</p>
        <p v-else-if="isTimeMode">计时保持课次：每组保持 {{ exercise.holdSeconds }} 秒，倒计时结束自动进入下一组，不输出姿势安全结论。随时可暂停、跳过或结束并记录。</p>
        <p v-else>计步课次：目标 {{ exercise.targetMinutes }} 分钟。步数来自设备运动传感器（只读运动，不读位置），不可用时退回手动计时；距离不给估算值。随时可结束并记录。</p>
        <BaseButton v-if="isRepsMode" variant="secondary" size="sm" :icon="Edit3" @click="toggleEdit">手动修正</BaseButton>
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
          <li><span>完成组数</span><b>{{ closedSets }} / {{ exercise.sets }}</b></li>
          <li v-if="isRepsMode"><span>总次数</span><b>{{ totalReps }} / {{ exercise.sets * exercise.repsPerSet }}</b></li>
          <li v-else-if="isTimeMode"><span>类型</span><b>计时保持 · 每组 {{ exercise.holdSeconds }} 秒</b></li>
          <li v-else><span>总步数</span><b>{{ stepCounter.steps.value > 0 ? stepCounter.steps.value : '未计步（手动计时）' }}</b></li>
          <li v-if="isRepsMode"><span>平均置信度</span><b>{{ Math.round(averageConfidence * 100) }}%</b></li>
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
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { X, Pause, Play, SkipForward, Square, Camera, Edit3, FileText } from 'lucide-vue-next'
import BaseCard from '@/components/common/BaseCard.vue'
import BaseButton from '@/components/common/BaseButton.vue'
import { useAppStore } from '@/stores/app'
import { usePoseCamera } from '@/composables/usePoseCamera'
import { useRepCounter } from '@/composables/useRepCounter'
import { useSpeech } from '@/composables/useSpeech'
import { useStepCounter } from '@/composables/useStepCounter'
import { findExercise } from '@/services/exercises'
import type { DemoEvent, ExercisePhase } from '@/types/domain'
import {
  applyPlanOverrides,
  demoExercises,
  exerciseChipLabel,
  getDemoExercise,
  getPhaseText,
  getConfidenceLevel,
  readPlanOverrides,
  summarizeSession
} from '@/services/demoCameraService'

const route = useRoute()
const router = useRouter()
const store = useAppStore()

const planOverride = readPlanOverrides(route.query as Record<string, unknown>)
const activePlanItemId = ref<string | undefined>(planOverride.planItemId)
const exercise = ref(applyPlanOverrides(getDemoExercise(route.query.exercise as string), planOverride))
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
/** F19：只播节奏与计时（组数/次数/休息），不做动作纠错；开关在设置页，默认关 */
const { speak } = useSpeech()
/** F18 计步：DeviceMotion 过峰检测；不支持/被拒/无传感器时如实降级为手动计时 */
const stepCounter = useStepCounter()
/** 双栏同屏：演示一直播放；摄像头是独立开关，开启后由端侧关键点接管计数 */
const camRequested = ref(false)
const videoRef = ref<HTMLVideoElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)

/** F05：实时摄像头分支用关键点角度驱动状态机计数；演示回放仍走预设时间线 */
const counter = ref<ReturnType<typeof useRepCounter> | null>(null)
const camJoint = ref<'knee' | 'elbow'>('knee')
const calibrating = ref(false)
/** session-RPE 量表含 0 档：0 表示几乎不费力 */
const RPE_SCALE = Array.from({ length: 11 }, (_, i) => i)
/** 用户手工修正过（或摄像头中途计过）本组次数后，时间线不再回写 reps */
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

// ——— 摄像头开关（与演示同屏，不再互斥） ———
const live = computed(() => camRequested.value && pose.status.value === 'live')
const cameraConnecting = computed(() => camRequested.value && pose.status.value === 'starting')
const camErrored = computed(() => camRequested.value && ['denied', 'error', 'unsupported'].includes(pose.status.value))

async function startCamera() {
  if (!store.privacy.cameraEnabled || camRequested.value) return
  camRequested.value = true
  await nextTick()
  if (!videoRef.value || !canvasRef.value) {
    camRequested.value = false
    pose.errorMessage.value = '摄像头画面容器没有准备好，请重试。'
    return
  }
  await pose.start(videoRef.value, canvasRef.value)
  if (!camRequested.value) return
  if (pose.status.value === 'live') onCameraLive()
}

function onCameraLive() {
  buildCounter()
  // 中途接入：已完成的组与已用时长保留，当前组交给端侧计数，从 0 重新计
  if (!finished.value && status.value === 'playing') {
    reps.value = 0
    corrected = false
    counter.value?.reset('摄像头已接入：请回到起始姿势开始计数')
    store.showToast({ type: 'success', title: '摄像头已接入', message: '本组改由端侧关键点计数，从 0 开始', duration: 3000 })
  }
}

function stopCamera() {
  if (!camRequested.value) return
  camRequested.value = false
  pose.stop()
  pose.errorMessage.value = ''
  counter.value = null
  if (!finished.value && status.value === 'playing') {
    if (reps.value > 0) {
      // 摄像头计到的次数保留：时间线不再回写次数，本组仍按演示节奏走到完成
      corrected = true
    } else {
      // 一次都没计到：演示时间线回到本组开头重放
      eventIndex = 0
      setElapsed = 0
    }
  }
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
const exerciseHowto = computed(() => findExercise(exercise.value.name)?.howto ?? '按动作要领保持姿势')
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
  isTimeMode.value ? `保持 ${exercise.value.holdSeconds} 秒` : `每组 ${exercise.value.repsPerSet} 次`
)
/** 预显的起始姿势：动作库要领 + 按课次类型给站位/口径提示 */
const startPoseHint = computed(() => {
  const lib = findExercise(exercise.value.name)
  const station = isTimeMode.value
    ? '计时保持课次：按上面要领摆好姿势，保持到倒计时结束'
    : isStepsMode.value
      ? '计步课次：步数由设备运动传感器负责；开启摄像头仅供自查姿态'
      : lib?.camera
        ? `左侧面向镜头、全身完整入镜，${lib.camera.joint === 'knee' ? '左膝' : '左肘'}保持清晰`
        : '该动作没有摄像头计数规则，开启摄像头可跟随节奏，次数可用手工修正'
  return [lib?.howto, station].filter(Boolean).join('；')
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
  const within = Math.min(reps.value / exercise.value.repsPerSet, 1)
  return ((displaySet.value - 1 + within) / exercise.value.sets) * 100
})
const phaseLabel = computed(() => {
  if (finished.value) return '已完成'
  if (status.value === 'resting') return '组间休息'
  if (paused.value) return '已暂停'
  if (isTimeMode.value) return '保持姿势'
  if (isStepsMode.value) return stepCounter.status.value === 'active' ? '计步中' : '计时中'
  return getPhaseText(phase.value, exercise.value.kind)
})
const stageClass = computed(() =>
  paused.value || status.value === 'resting' ? 'held' : phase.value
)
/** 演示剪影姿态类别：弯举看肘、坐站/台阶/热身看膝、肩环绕看肩、提踵看踵 */
const figureKind = computed(() => exercise.value.kind)
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
const jointLabel = computed(() => (camJoint.value === 'knee' ? '膝角' : '肘角'))

const stageMessage = computed(() => message.value)
const shownConfidence = computed(() => (live.value ? pose.visibility.value : confidence.value))
const confidenceLevel = computed(() => getConfidenceLevel(shownConfidence.value))
const confidenceClass = computed(() => confidenceLevel.value.level)
const confidenceText = computed(() => confidenceLevel.value.text)

const demoHint = computed(() => {
  if (isTimeMode.value) return '计时保持课次：按要领保持姿势，倒计时结束自动进入下一组'
  if (isStepsMode.value) return '计步课次：步数来自设备运动传感器，不可用时如实退回手动计时'
  return live.value
    ? '摄像头开启中：剪影跟随端侧识别到的动作阶段'
    : '按预设时间线回放，不需要摄像头；骨架为关键点示意图'
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
    if (!c) return '识别：端侧关键点 · 该动作暂无计数规则，本组按演示节奏计次，可用手工修正'
    return `识别：端侧关键点实时驱动计数（${jointLabel.value}）· 阈值 ${Math.round(c.lowThreshold)}° · ${c.calibratedNeutral !== null ? '已按你的机位校准' : '未校准，用规则默认阈值'}`
  }
  return '开启后画面只在本机做姿态推理，不上传、不落盘'
})

function tick(ts: number) {
  if (!lastTs) lastTs = ts
  // 后台标签页回来时 ts 会一次性跳大，钳制增量以免事件被成批吞掉
  const dt = Math.min(ts - lastTs, 250)
  lastTs = ts

  if (!paused.value && status.value === 'playing') {
    elapsedMs.value += dt
    if (isRepsMode.value && live.value && counter.value) {
      // 摄像头计数接管：演示时间线时钟冻结在原地，关掉摄像头后从原点继续
      const c = counter.value
      const angle = camJoint.value === 'knee' ? pose.kneeAngle.value : pose.elbowAngle.value
      const res = c.feed(angle, pose.visibility.value, ts)
      if (res.counted) {
        store.showToast({ type: 'success', title: `第 ${c.count} 次`, message: '关键点回到起始位，计为一次', duration: 1200 })
        speak(String(c.count))
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
    } else if (isRepsMode.value) {
      // 演示时间线推进计数；无计数规则的动作在摄像头开启时也走这里
      setElapsed += dt
      const events = exercise.value.setEvents
      while (eventIndex < events.length && events[eventIndex].time <= setElapsed) {
        applyEvent(events[eventIndex])
        eventIndex++
      }
    } else if (isTimeMode.value) {
      // F18 计时保持：setElapsed 就是本组已保持的时长
      setElapsed += dt
      const remainMs = Math.max((exercise.value.holdSeconds ?? 0) * 1000 - setElapsed, 0)
      holdLeft.value = Math.ceil(remainMs / 1000)
      message.value = `保持 ${holdLeft.value} 秒`
      if (!holdFiveSaid && remainMs <= 5000) {
        holdFiveSaid = true
        speak('还剩 5 秒')
      }
      if (remainMs <= 0) finishSet()
    } else {
      // F18 计步：计步交给传感器（或手动计时），到目标时长自动完成
      const minutes = Math.floor(elapsedMs.value / 60_000)
      if (minutes >= minuteMark + 5) {
        minuteMark += 5
        speak(`已 ${minuteMark} 分钟`)
      }
      if (elapsedMs.value >= targetMs.value) {
        message.value = '达到目标时长'
        closeCurrentSet()
        complete()
      }
    }
  } else if (!paused.value && status.value === 'resting') {
    elapsedMs.value += dt
    restElapsed += dt
    const remaining = Math.max(Math.ceil((exercise.value.restDuration - restElapsed) / 1000), 0)
    restLeft.value = remaining
    message.value = `组间休息 ${remaining} 秒`
    if (!restFiveSaid && remaining <= 5) {
      restFiveSaid = true
      speak('组间剩 5 秒')
    }
    if (restElapsed >= exercise.value.restDuration) startNextSet()
  }

  if (!finished.value) rafId = requestAnimationFrame(tick)
}

function applyEvent(event: DemoEvent) {
  if (event.count !== undefined) {
    // 摄像头中途计过（corrected）或用户手工修正过时，时间线只负责节奏与完成事件
    if (!corrected) reps.value = event.count
    if (event.state !== 'complete' && !corrected) speak(String(event.count))
  }
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
  if (closedSets.value < setIndex.value) {
    closedSets.value++
    // 只有计次型有每组次数明细；计时型组就是保持满一次
    if (isRepsMode.value) repsBySet.value.push(reps.value)
  }
}

function finishSet() {
  closeCurrentSet()
  if (setIndex.value < exercise.value.sets) {
    status.value = 'resting'
    restElapsed = 0
    restFiveSaid = false
    holdFiveSaid = false
    restLeft.value = Math.ceil(exercise.value.restDuration / 1000)
    speak('本组完成')
  } else {
    complete()
  }
}

function startNextSet() {
  disarmSkip()
  setIndex.value++
  reps.value = 0
  eventIndex = 0
  setElapsed = 0
  corrected = false
  holdFiveSaid = false
  holdLeft.value = exercise.value.holdSeconds ?? 0
  counter.value?.reset('新一组开始：请回到起始姿势')
  status.value = 'playing'
  message.value = `第 ${setIndex.value} 组开始`
  speak(isTimeMode.value ? `第 ${setIndex.value} 组开始，保持 ${holdLeft.value} 秒` : `第 ${setIndex.value} 组开始`)
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
  disarmSkip()
  if (isStepsMode.value) {
    // 停监听但保留已计步数，摘要要用
    stepCounter.stop()
    speak(stepCounter.steps.value > 0 ? `训练完成，共 ${stepCounter.steps.value} 步` : '训练完成')
  } else {
    speak('训练完成')
  }
  record()
}

function record() {
  if (recorded || (!repsBySet.value.length && !closedSets.value)) return
  recorded = true
  const session = store.addSession(
    summarizeSession({
      exercise: exercise.value,
      planItemId: activePlanItemId.value,
      setsCompleted: closedSets.value,
      repsBySet: repsBySet.value,
      steps: isStepsMode.value ? stepCounter.steps.value : undefined,
      averageConfidence: averageConfidence.value,
      manualCorrections: manualCorrections.value,
      elapsedMs: elapsedMs.value
    })
  )
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
  speak(paused.value ? '已暂停' : '继续训练')
}

function selectExercise(name: string) {
  activePlanItemId.value = undefined
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
  rafId = requestAnimationFrame(tick)
  // 课次开始也是节奏的一部分；浏览器在没有用户激活时会把这句静默拒掉，不报错
  if (isTimeMode.value) speak(`第 1 组开始，保持 ${holdLeft.value} 秒`)
  else if (isStepsMode.value) speak(`开始${exercise.value.name}，目标 ${exercise.value.targetMinutes} 分钟`)
  else speak('第 1 组开始')
}

function leave() {
  router.push('/')
}

onMounted(() => restart())
onUnmounted(() => {
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
.exercise-switch{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap}
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

/* 双栏：左演示，右摄像头，同屏 */
.stage-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:6px}
.pane{padding:0!important;overflow:hidden;display:flex;flex-direction:column}
.pane-head{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:12px 18px;border-bottom:1px solid var(--color-divider)}
.pane-title{font-size:13px;font-weight:700;color:var(--color-ink)}
.pane-note{font-size:11px;color:var(--color-text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pane-body{padding:14px;background:var(--color-neutral-soft);flex:1;display:flex}
.pane-foot{padding:10px 18px;font-size:11px;line-height:1.6;color:var(--color-text-muted);text-align:center;border-top:1px solid var(--color-divider)}

/* 取景框：镜头画面本来就是暗的，用深底比浅灰底更像"正在看摄像头"；
   高度跟视口走，别让 4:5 把整页拉到两千像素高 */
.demo-frame{height:min(58vh,540px);background:radial-gradient(120% 100% at 50% 0%,#263038 0%,#14191d 55%,#0c1013 100%);border-radius:var(--radius-md);position:relative;overflow:hidden;display:grid;place-items:center;width:100%}
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
/* 坐站/台阶/热身类不握器械：只在弯举与划船这类肘主导的动作里画哑铃 */
.figure.knee .db,.figure.shoulder .db,.figure.calf .db{display:none}

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

/* 弯举：计数语义里 'down' 是弯起（肘角变小），前臂绕肘卷起来；远侧滞后一点，两根手臂不再是同步的杆 */
.figure.down.elbow .arm-near .fore{transform:rotate(-168deg)}
.figure.down.elbow .arm-far .fore{transform:rotate(-152deg)}
.figure.down.elbow .arm-near .upper{transform:rotate(-7deg)}
.figure.down.elbow .arm-far .upper{transform:rotate(-4deg)}

/* 肩环绕：'up' 是手臂上举过顶的一段圆弧 */
.figure.up.shoulder .arm-near .upper{transform:rotate(-118deg)}
.figure.up.shoulder .arm-far .upper{transform:rotate(-100deg)}
.figure.up.shoulder .arm-near .fore{transform:rotate(-14deg)}
.figure.up.shoulder .arm-far .fore{transform:rotate(-9deg)}

/* 提踵：'up' 是脚跟提起，身体整体升高一点，投影收紧 */
.figure.up.calf .pelvis{transform:translate(0,-12px)}
.figure.up.calf .shadow{transform:scale(.94)}

/* 坐站/台阶：骨盆沉降 + 大腿前折并缩短（透视）+ 小腿回收 + 脚掌压平 */
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
