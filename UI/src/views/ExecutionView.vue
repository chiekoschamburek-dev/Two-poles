<template>
  <div class="execution-page">
    <div class="page-header">
      <div>
        <span class="eyebrow">CAMERA GUIDED TRAINING</span>
        <h1>{{ exercise.name }} · 第 {{ displaySet }} 组</h1>
        <p>演示模式 · 摄像头原始画面默认不上传</p>
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
          <span class="cam-note" aria-live="polite">{{ sourceNote }}</span>
        </div>
      </div>
      <BaseButton variant="secondary" :icon="X" @click="leave">结束</BaseButton>
    </div>

    <div class="execution-grid">
      <BaseCard class="stage-card glass animate-slide-in-up" style="animation-delay:90ms">
        <div class="stage-container">
          <div class="demo-frame">
            <template v-if="mode === 'camera'">
              <video ref="videoRef" class="cam-feed" muted playsinline></video>
              <canvas ref="canvasRef" class="cam-overlay"></canvas>
            </template>
            <div v-else class="skeleton-overlay">
              <svg viewBox="0 0 400 600" class="skeleton" :class="stageClass">
                <circle cx="200" cy="120" r="25" fill="var(--color-accent)" />
                <circle cx="200" cy="170" r="8" fill="var(--color-accent)" />
                <circle cx="200" cy="280" r="10" fill="var(--color-accent)" />
                <circle cx="200" cy="410" r="10" fill="var(--color-accent)" />
                <circle cx="200" cy="540" r="10" fill="var(--color-accent)" />
                <circle cx="260" cy="210" r="8" fill="var(--color-accent)" />
                <circle cx="280" cy="260" r="8" fill="var(--color-accent)" />
                <line x1="200" y1="145" x2="200" y2="270" stroke="var(--color-accent)" stroke-width="6" />
                <line x1="200" y1="280" x2="200" y2="400" stroke="var(--color-accent)" stroke-width="6" />
                <line x1="200" y1="410" x2="200" y2="530" stroke="var(--color-accent)" stroke-width="6" />
                <line x1="200" y1="180" x2="260" y2="210" stroke="var(--color-accent)" stroke-width="5" />
                <line x1="260" y1="210" x2="280" y2="260" stroke="var(--color-accent)" stroke-width="5" />
              </svg>
            </div>
            <div class="stage-overlay">
              <span class="confidence-badge animate-fade-in" :class="confidenceClass" :key="confidenceClass">{{ confidenceText }}</span>
              <span class="phase-badge" :class="{ 'animate-pulse': status === 'resting' }">{{ phaseLabel }}</span>
            </div>
            <div class="frame-sheen gradient-shimmer" v-if="mode === 'demo' && !finished && !paused"></div>
            <p class="stage-live" aria-live="polite">{{ message }}</p>
          </div>
          <div class="stage-hint">{{ stageHint }}</div>
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
      </BaseCard>

      <div class="info-cards">
        <BaseCard class="count-card animate-slide-in-up" style="animation-delay:150ms">
          <div class="count-label">当前组数</div>
          <div class="count-big">{{ displaySet }} <span>/ {{ exercise.sets }}</span></div>
          <div class="count-progress"><div class="progress-fill" :style="{ width: setProgress + '%' }"></div></div>
        </BaseCard>

        <BaseCard class="count-card primary animate-slide-in-up" style="animation-delay:210ms">
          <div class="count-label">本组完成次数</div>
          <div class="count-big">{{ displayReps }} <span>/ {{ exercise.repsPerSet }}</span></div>
          <div class="reps-grid" :style="{ gridTemplateColumns: 'repeat(' + exercise.repsPerSet + ', 1fr)' }">
            <span v-for="n in exercise.repsPerSet" :key="n" :class="{ done: n <= displayReps }"></span>
          </div>
        </BaseCard>

        <BaseCard class="animate-slide-in-up" style="animation-delay:270ms">
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
              <strong>膝 {{ pose.kneeAngle ?? '—' }}° · 髋 {{ pose.hipAngle ?? '—' }}°</strong>
              <small>肘 {{ pose.elbowAngle ?? '—' }}°（取左侧）· 实时角度仅供参考，不参与计数</small>
            </div>
          </div>
          <div class="status-item">
            <Timer :size="18" class="status-icon teal" />
            <div><strong>{{ Math.floor(elapsedMs / 1000) }}s</strong><small>已用时长</small></div>
          </div>
        </BaseCard>

        <BaseCard v-if="!finished" class="actions-card animate-slide-in-up" style="animation-delay:330ms">
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
              <span class="field-label">RPE 主观用力程度（1 轻 · 10 力竭）</span>
              <div class="rpe-row">
                <button
                  v-for="n in 10"
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
const shownConfidence = computed(() => (live.value ? pose.visibility.value : confidence.value))
const confidenceLevel = computed(() => getConfidenceLevel(shownConfidence.value))
const confidenceClass = computed(() => confidenceLevel.value.level)
const confidenceText = computed(() => confidenceLevel.value.text)

const sourceNote = computed(() => {
  if (pose.errorMessage.value) return pose.errorMessage.value
  if (mode.value === 'camera' && pose.status.value === 'starting') return '正在加载端侧模型（首次约 5.5 MB，请稍候）…'
  if (live.value) return `${pose.fps.value} FPS · 画面只在本机推理，不上传`
  if (!store.privacy.cameraEnabled) return '摄像头已在设置中关闭，当前只有演示回放'
  return '按预设时间线回放，不需要摄像头'
})
const stageHint = computed(() =>
  live.value
    ? '识别：MediaPipe 端侧实时关键点 · 计数：仍由演示时钟推进（两者尚未联动）'
    : '关键点示意图 · 实际使用时在本地处理'
)

async function switchMode(next: 'demo' | 'camera') {
  if (next === mode.value) return
  if (next === 'camera' && !store.privacy.cameraEnabled) return
  mode.value = next
  if (next === 'camera') {
    await nextTick()
    if (videoRef.value && canvasRef.value) {
      await pose.start(videoRef.value, canvasRef.value)
      if (pose.status.value !== 'live') mode.value = 'demo'
    }
  } else {
    pose.stop()
    pose.errorMessage.value = ''
  }
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
const totalReps = computed(() => repsBySet.value.reduce((sum, n) => sum + n, 0))
const averageConfidence = computed(() => (confidenceCount ? confidenceSum / confidenceCount : 0))
const completionLabel = computed(() => {
  const target = exercise.value.sets * exercise.value.repsPerSet
  return repsBySet.value.length >= exercise.value.sets && totalReps.value >= target ? '全部完成' : '部分完成'
})

function tick(ts: number) {
  if (!lastTs) lastTs = ts
  // 后台标签页回来时 ts 会一次性跳大，钳制增量以免事件被成批吞掉
  const dt = Math.min(ts - lastTs, 250)
  lastTs = ts

  if (!paused.value && status.value === 'playing') {
    elapsedMs.value += dt
    setElapsed += dt
    const events = exercise.value.setEvents
    while (eventIndex < events.length && events[eventIndex].time <= setElapsed) {
      applyEvent(events[eventIndex])
      eventIndex++
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
  editOpen.value = false
  store.showToast({ type: 'info', title: `本组次数已修正为 ${next}`, duration: 2000 })
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
  rafId = requestAnimationFrame(tick)
}

function leave() {
  router.push('/dashboard')
}

onMounted(() => restart())
onUnmounted(() => {
  cancelAnimationFrame(rafId)
  cancelAnimationFrame(tweenRaf)
})
</script>

<style scoped>
.execution-page{max-width:1400px;margin:auto}
.page-header{display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:24px}
.eyebrow{display:inline-flex;align-items:center;font-size:11px;letter-spacing:var(--tracking-eyebrow);color:var(--color-accent);font-weight:700}.eyebrow::before{content:'';width:6px;height:6px;border-radius:2px;background:var(--color-accent);transform:rotate(45deg);margin-right:8px}
.page-header h1{font-size:28px;margin:7px 0 5px}
.page-header p{color:var(--color-text-muted);font-size:13px;margin:0}
.exercise-switch{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap}
.source-switch{display:flex;align-items:center;gap:8px;margin-top:10px;flex-wrap:wrap}
.cam-note{font-size:12px;color:var(--color-text-muted)}
.cam-feed,.cam-overlay{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transform:scaleX(-1)}
.cam-feed{background:#0d1f2c}
.cam-overlay{pointer-events:none}
.chip{padding:7px 13px;border-radius:999px;font-size:12px;font-weight:600;color:var(--color-accent);background:var(--color-accent-soft);transition:all var(--motion-fast)}
.chip.active{background:var(--color-accent);color:white}
.chip:hover:enabled{transform:translateY(-1px);box-shadow:var(--shadow-sm)}
.chip:disabled{opacity:.45;cursor:not-allowed}
.execution-grid{display:grid;grid-template-columns:1.4fr 1fr;gap:20px}
.stage-card{padding:0!important;overflow:hidden}
.stage-container{padding:24px;background:var(--color-neutral-soft)}
.demo-frame{aspect-ratio:4/5;background:linear-gradient(135deg,var(--color-neutral-soft),var(--color-accent-soft));border-radius:16px;position:relative;overflow:hidden;display:grid;place-items:center}
.skeleton-overlay{width:100%;height:100%;display:grid;place-items:center}
.skeleton{width:60%;height:90%;opacity:.85;filter:drop-shadow(0 2px 8px rgba(10,155,157,.25));transition:transform var(--motion-base) var(--easing-ease-out)}
.skeleton.down{transform:translateY(14px) scaleY(.94)}
.skeleton.up{transform:translateY(-6px)}
.skeleton.held{opacity:.5}
.skeleton.occluded{opacity:.28}
.skeleton circle{animation:pulse 2s ease-in-out infinite}
.skeleton line{animation:pulse 2s ease-in-out infinite}
.frame-sheen{position:absolute;inset:0;border-radius:16px;opacity:.45;pointer-events:none}
.stage-overlay{position:absolute;top:16px;left:16px;right:16px;display:flex;justify-content:space-between;gap:10px}
.confidence-badge,.phase-badge{padding:8px 12px;border-radius:10px;font-size:12px;font-weight:600;background:rgba(255,255,255,.9);backdrop-filter:blur(8px);box-shadow:var(--shadow-sm)}
.confidence-badge.high{color:var(--color-success);border-left:3px solid var(--color-success)}
.confidence-badge.medium{color:var(--color-caution);border-left:3px solid var(--color-caution)}
.confidence-badge.low{color:var(--color-danger);border-left:3px solid var(--color-danger)}
.phase-badge{color:var(--color-accent);border-left:3px solid var(--color-accent)}
.stage-live{position:absolute;left:16px;right:16px;bottom:16px;margin:0;padding:10px 14px;border-radius:12px;background:rgba(255,255,255,.9);backdrop-filter:blur(8px);font-size:13px;font-weight:600;color:var(--color-ink);text-align:center;box-shadow:var(--shadow-sm)}
.stage-hint{padding:12px 24px;font-size:11px;color:var(--color-text-muted);text-align:center;background:linear-gradient(180deg,#fff,var(--color-neutral-soft));border-top:1px solid var(--color-divider)}
.stage-controls{display:flex;justify-content:center;gap:12px;padding:20px;background:var(--color-neutral-soft)}
.ctrl-btn{width:52px;height:52px;border-radius:50%;display:grid;place-items:center;transition:all var(--motion-fast)}
.ctrl-btn.secondary{background:var(--color-accent-soft);color:var(--color-accent)}
.ctrl-btn.secondary:hover:enabled{background:var(--color-accent);color:white;transform:scale(1.08)}
.ctrl-btn.danger{background:var(--color-danger-soft);color:var(--color-danger)}
.ctrl-btn.danger:hover:enabled{background:var(--color-danger);color:white}
.ctrl-btn:disabled{opacity:.4;cursor:not-allowed}
.info-cards{display:grid;gap:18px}
.count-card{text-align:center;padding:22px!important}
.count-label{font-size:12px;color:var(--color-text-muted);margin-bottom:8px}
.count-big{font-family:var(--font-display);font-size:46px;font-weight:700;letter-spacing:-.04em;line-height:1.2;margin-bottom:14px;font-variant-numeric:tabular-nums;color:var(--color-ink)}
.count-big span{font-size:18px;color:var(--color-text-muted);-webkit-text-fill-color:currentColor;letter-spacing:0}
.count-card.primary .count-big{background:var(--color-accent);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.count-progress{height:6px;background:var(--color-divider);border-radius:10px;overflow:hidden;box-shadow:inset 0 1px 2px rgba(21,24,27,.1)}
.progress-fill{height:100%;background:linear-gradient(90deg,var(--color-accent),var(--color-accent-strong));border-radius:10px;box-shadow:0 0 10px rgba(45,123,184,.5);transition:width var(--motion-slow) var(--easing-ease-out)}
.reps-grid{display:grid;gap:6px;margin-top:4px}
.reps-grid span{height:5px;background:var(--color-divider);border-radius:3px}
.reps-grid span.done{background:var(--color-accent);animation:scaleIn var(--motion-base) var(--easing-spring) both}
.status-item{display:flex;align-items:flex-start;gap:12px;padding:12px 0;border-bottom:1px solid var(--color-divider)}
.status-item:last-child{border:0}
.status-icon{color:var(--color-text-secondary);margin-top:2px}
.status-icon.teal{color:var(--color-accent)}
.status-item strong,.status-item small{display:block}
.status-item strong{font-size:14px}
.status-item small{font-size:12px;color:var(--color-text-muted);margin-top:3px}
.actions-card h3{font-size:16px;margin-bottom:8px}
.actions-card p{font-size:13px;color:var(--color-text-secondary);margin-bottom:16px;line-height:1.6}
.actions-card :deep(button){width:100%;margin-bottom:8px}
.correct-form{display:flex;gap:8px;margin-bottom:8px}
.correct-form input{flex:1;min-width:0;padding:0 12px;height:36px;border:1px solid var(--color-border);border-radius:11px;font-size:14px;color:var(--color-ink);background:#fff}
.correct-form :deep(button){width:auto;margin-bottom:0;padding:0 18px}
.summary-list{display:grid;gap:9px;list-style:none;padding:0;margin:0 0 14px}
.summary-list li{display:flex;justify-content:space-between;font-size:13px;color:var(--color-text-secondary);animation:slideInUp var(--motion-base) var(--easing-spring) both}
.summary-list li:nth-child(2){animation-delay:70ms}
.summary-list li:nth-child(3){animation-delay:140ms}
.summary-list li:nth-child(4){animation-delay:210ms}
.summary-list li:nth-child(5){animation-delay:280ms}
.summary-list li:nth-child(6){animation-delay:350ms}
.summary-list b{color:var(--color-ink)}
.stored-note{font-size:12px;color:var(--color-accent)}
.feedback{border-top:1px solid var(--color-divider);margin-top:14px;padding-top:14px;text-align:left}
.feedback h4{font-size:14px;color:var(--color-ink);margin-bottom:12px}
.field{margin-bottom:12px}
.field-label{display:block;font-size:12px;color:var(--color-text-muted);margin-bottom:6px}
.rpe-row{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px}
.feedback .rpe-chip{width:auto;min-width:34px;height:34px;padding:0 8px;border-radius:10px;margin-bottom:0;background:var(--color-neutral-soft);color:var(--color-text-secondary);font-size:13px;font-weight:700;transition:all var(--motion-fast)}
.feedback .rpe-chip:hover{background:var(--color-accent-soft);color:var(--color-accent);transform:translateY(-1px)}
.feedback .rpe-chip.active{background:var(--color-accent);color:white}
.field small{display:block;font-size:11px;color:var(--color-text-muted);line-height:1.6}
.check{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--color-text-secondary);margin-bottom:12px;cursor:pointer}
.check input{width:16px;height:16px;accent-color:var(--color-accent)}
.feedback input[type=text],.feedback textarea{width:100%;padding:10px 12px;border:1px solid var(--color-border);border-radius:11px;font-size:13px;font-family:inherit;color:var(--color-ink);background:#fff;resize:vertical}
.feedback-saved{font-size:13px;color:var(--color-accent);border-top:1px solid var(--color-divider);margin:14px 0 0;padding-top:14px;text-align:left}
@media(max-width:1024px){.execution-grid{grid-template-columns:1fr}.info-cards{grid-template-columns:repeat(2,1fr)}.actions-card{grid-column:1/-1}}
@media(max-width:767px){.page-header{align-items:flex-start}.page-header h1{font-size:22px}.info-cards{grid-template-columns:1fr}}
</style>
