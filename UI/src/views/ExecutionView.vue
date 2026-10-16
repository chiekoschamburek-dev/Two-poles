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
      </div>
      <BaseButton variant="secondary" :icon="X" @click="leave">结束</BaseButton>
    </div>

    <div class="execution-grid">
      <BaseCard class="stage-card glass">
        <div class="stage-container">
          <div class="demo-frame">
            <div class="skeleton-overlay">
              <svg viewBox="0 0 400 600" class="skeleton" :class="stageClass">
                <circle cx="200" cy="120" r="25" fill="#0a9b9d" />
                <circle cx="200" cy="170" r="8" fill="#0a9b9d" />
                <circle cx="200" cy="280" r="10" fill="#0a9b9d" />
                <circle cx="200" cy="410" r="10" fill="#0a9b9d" />
                <circle cx="200" cy="540" r="10" fill="#0a9b9d" />
                <circle cx="260" cy="210" r="8" fill="#0a9b9d" />
                <circle cx="280" cy="260" r="8" fill="#0a9b9d" />
                <line x1="200" y1="145" x2="200" y2="270" stroke="#0a9b9d" stroke-width="6" />
                <line x1="200" y1="280" x2="200" y2="400" stroke="#0a9b9d" stroke-width="6" />
                <line x1="200" y1="410" x2="200" y2="530" stroke="#0a9b9d" stroke-width="6" />
                <line x1="200" y1="180" x2="260" y2="210" stroke="#0a9b9d" stroke-width="5" />
                <line x1="260" y1="210" x2="280" y2="260" stroke="#0a9b9d" stroke-width="5" />
              </svg>
            </div>
            <div class="stage-overlay">
              <span class="confidence-badge" :class="confidenceClass">{{ confidenceText }}</span>
              <span class="phase-badge">{{ phaseLabel }}</span>
            </div>
            <p class="stage-live" aria-live="polite">{{ message }}</p>
          </div>
          <div class="stage-hint">关键点示意图 · 实际使用时在本地处理</div>
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
        <BaseCard class="count-card">
          <div class="count-label">当前组数</div>
          <div class="count-big">{{ displaySet }} <span>/ {{ exercise.sets }}</span></div>
          <div class="count-progress"><div class="progress-fill" :style="{ width: setProgress + '%' }"></div></div>
        </BaseCard>

        <BaseCard class="count-card primary">
          <div class="count-label">本组完成次数</div>
          <div class="count-big">{{ reps }} <span>/ {{ exercise.repsPerSet }}</span></div>
          <div class="reps-grid" :style="{ gridTemplateColumns: 'repeat(' + exercise.repsPerSet + ', 1fr)' }">
            <span v-for="n in exercise.repsPerSet" :key="n" :class="{ done: n <= reps }"></span>
          </div>
        </BaseCard>

        <BaseCard>
          <div class="status-item">
            <Activity :size="18" class="status-icon" />
            <div><strong>{{ phaseLabel }}</strong><small>{{ message || '保持动作流畅' }}</small></div>
          </div>
          <div class="status-item">
            <Gauge :size="18" class="status-icon teal" />
            <div><strong>置信度: {{ Math.round(confidence * 100) }}%</strong><small>{{ confidenceText }}</small></div>
          </div>
          <div class="status-item">
            <Timer :size="18" class="status-icon teal" />
            <div><strong>{{ Math.floor(elapsedMs / 1000) }}s</strong><small>已用时长</small></div>
          </div>
        </BaseCard>

        <BaseCard v-if="!finished" class="actions-card">
          <h3>完成后记录</h3>
          <p>完成次数可以修正。看不清时暂停计数，不输出姿势安全结论。共 {{ exercise.sets }} 组，每组 {{ exercise.repsPerSet }} 次，组间休息 {{ exercise.restDuration / 1000 }} 秒。</p>
          <BaseButton variant="secondary" size="sm" :icon="Edit3" @click="toggleEdit">手动修正</BaseButton>
          <div v-if="editOpen" class="correct-form">
            <input v-model.number="editValue" type="number" min="0" :max="exercise.repsPerSet" aria-label="修正本组次数" />
            <BaseButton size="sm" @click="applyCorrection">确认</BaseButton>
          </div>
          <BaseButton variant="ghost" size="sm" :icon="FileText" @click="leave">放弃本次记录</BaseButton>
        </BaseCard>

        <BaseCard v-else class="actions-card summary">
          <h3>本次已记录</h3>
          <ul class="summary-list">
            <li><span>动作</span><b>{{ exercise.name }}</b></li>
            <li><span>完成组数</span><b>{{ repsBySet.length }} / {{ exercise.sets }}</b></li>
            <li><span>总次数</span><b>{{ totalReps }} / {{ exercise.sets * exercise.repsPerSet }}</b></li>
            <li><span>平均置信度</span><b>{{ Math.round(averageConfidence * 100) }}%</b></li>
            <li><span>手动修正</span><b>{{ manualCorrections }} 次</b></li>
            <li><span>状态</span><b>{{ completionLabel }}</b></li>
          </ul>
          <p class="stored-note">{{ recordedNote }}</p>
          <BaseButton size="sm" :icon="Play" @click="restart">再练一遍</BaseButton>
          <BaseButton variant="secondary" size="sm" @click="leave">返回概览</BaseButton>
        </BaseCard>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { X, Pause, Play, SkipForward, Square, Activity, Gauge, Edit3, FileText, Timer } from 'lucide-vue-next'
import BaseCard from '@/components/common/BaseCard.vue'
import BaseButton from '@/components/common/BaseButton.vue'
import { useAppStore } from '@/stores/app'
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

let setElapsed = 0
let restElapsed = 0
let eventIndex = 0
let lastTs = 0
let rafId = 0
let confidenceSum = 0
let confidenceCount = 0
let recorded = false

const confidenceLevel = computed(() => getConfidenceLevel(confidence.value))
const confidenceClass = computed(() => confidenceLevel.value.level)
const confidenceText = computed(() => confidenceLevel.value.text)

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
  store.addSession(
    summarizeSession({
      exercise: exercise.value,
      setsCompleted: repsBySet.value.length,
      repsBySet: repsBySet.value,
      averageConfidence: averageConfidence.value,
      manualCorrections: manualCorrections.value,
      elapsedMs: elapsedMs.value
    })
  )
  recordedNote.value = `已保存到本地记录（共 ${store.sessions.length} 条）`
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
  setIndex.value = 1
  reps.value = 0
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
onUnmounted(() => cancelAnimationFrame(rafId))
</script>

<style scoped>
.execution-page{max-width:1400px;margin:auto}
.page-header{display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:24px}
.eyebrow{font-size:11px;letter-spacing:.12em;color:var(--color-teal);font-weight:700}
.page-header h1{font-size:28px;margin:7px 0 5px}
.page-header p{color:var(--color-text-muted);font-size:13px;margin:0}
.exercise-switch{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap}
.chip{padding:7px 13px;border-radius:999px;font-size:12px;font-weight:600;color:var(--color-teal);background:#e8f7f5;transition:all var(--motion-fast)}
.chip.active{background:var(--gradient-teal);color:white}
.chip:hover{transform:translateY(-1px);box-shadow:var(--shadow-sm)}
.execution-grid{display:grid;grid-template-columns:1.4fr 1fr;gap:20px}
.stage-card{padding:0!important;overflow:hidden}
.stage-container{padding:24px;background:#f8fafb}
.demo-frame{aspect-ratio:4/5;background:linear-gradient(135deg,#e8f0f5,#eef7f9);border-radius:16px;position:relative;overflow:hidden;display:grid;place-items:center}
.skeleton-overlay{width:100%;height:100%;display:grid;place-items:center}
.skeleton{width:60%;height:90%;opacity:.85;filter:drop-shadow(0 2px 8px rgba(10,155,157,.25));transition:transform var(--motion-base) var(--easing-ease-out)}
.skeleton.down{transform:translateY(14px) scaleY(.94)}
.skeleton.up{transform:translateY(-6px)}
.skeleton.held{opacity:.5}
.skeleton.occluded{opacity:.28}
.skeleton circle{animation:pulse 2s ease-in-out infinite}
.skeleton line{animation:pulse 2s ease-in-out infinite}
.stage-overlay{position:absolute;top:16px;left:16px;right:16px;display:flex;justify-content:space-between;gap:10px}
.confidence-badge,.phase-badge{padding:8px 12px;border-radius:10px;font-size:12px;font-weight:600;background:rgba(255,255,255,.9);backdrop-filter:blur(8px);box-shadow:var(--shadow-sm)}
.confidence-badge.high{color:#2d7a50;border-left:3px solid #4caf50}
.confidence-badge.medium{color:#9a6a12;border-left:3px solid #ff9800}
.confidence-badge.low{color:#a53d3d;border-left:3px solid #f44336}
.phase-badge{color:var(--color-teal);border-left:3px solid var(--color-teal)}
.stage-live{position:absolute;left:16px;right:16px;bottom:16px;margin:0;padding:10px 14px;border-radius:12px;background:rgba(255,255,255,.9);backdrop-filter:blur(8px);font-size:13px;font-weight:600;color:var(--color-navy);text-align:center;box-shadow:var(--shadow-sm)}
.stage-hint{padding:12px 24px;font-size:11px;color:var(--color-text-muted);text-align:center;background:white;border-top:1px solid var(--color-border)}
.stage-controls{display:flex;justify-content:center;gap:12px;padding:20px;background:white}
.ctrl-btn{width:52px;height:52px;border-radius:50%;display:grid;place-items:center;transition:all var(--motion-fast)}
.ctrl-btn.secondary{background:#e8f7f5;color:var(--color-teal)}
.ctrl-btn.secondary:hover:enabled{background:var(--gradient-teal);color:white;transform:scale(1.08)}
.ctrl-btn.danger{background:#fde8e8;color:var(--color-danger)}
.ctrl-btn.danger:hover:enabled{background:var(--gradient-danger);color:white}
.ctrl-btn:disabled{opacity:.4;cursor:not-allowed}
.info-cards{display:grid;gap:18px}
.count-card{text-align:center;padding:22px!important}
.count-label{font-size:12px;color:var(--color-text-muted);margin-bottom:8px}
.count-big{font-size:42px;font-weight:700;color:var(--color-navy);line-height:1.2;margin-bottom:14px}
.count-big span{font-size:18px;color:var(--color-text-muted)}
.count-card.primary .count-big{background:var(--gradient-teal);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.count-progress{height:6px;background:#e8eef3;border-radius:10px;overflow:hidden}
.progress-fill{height:100%;background:var(--gradient-blue);border-radius:10px;transition:width var(--motion-slow) var(--easing-ease-out)}
.reps-grid{display:grid;gap:6px;margin-top:4px}
.reps-grid span{height:5px;background:#e8eef3;border-radius:3px}
.reps-grid span.done{background:var(--gradient-teal)}
.status-item{display:flex;align-items:flex-start;gap:12px;padding:12px 0;border-bottom:1px solid var(--color-divider)}
.status-item:last-child{border:0}
.status-icon{color:var(--color-text-secondary);margin-top:2px}
.status-icon.teal{color:var(--color-teal)}
.status-item strong,.status-item small{display:block}
.status-item strong{font-size:14px}
.status-item small{font-size:12px;color:var(--color-text-muted);margin-top:3px}
.actions-card h3{font-size:16px;margin-bottom:8px}
.actions-card p{font-size:13px;color:var(--color-text-secondary);margin-bottom:16px;line-height:1.6}
.actions-card :deep(button){width:100%;margin-bottom:8px}
.correct-form{display:flex;gap:8px;margin-bottom:8px}
.correct-form input{flex:1;min-width:0;padding:0 12px;height:36px;border:1px solid var(--color-border);border-radius:11px;font-size:14px;color:var(--color-navy);background:#fff}
.correct-form :deep(button){width:auto;margin-bottom:0;padding:0 18px}
.summary-list{display:grid;gap:9px;list-style:none;padding:0;margin:0 0 14px}
.summary-list li{display:flex;justify-content:space-between;font-size:13px;color:var(--color-text-secondary)}
.summary-list b{color:var(--color-navy)}
.stored-note{font-size:12px;color:var(--color-teal)}
@media(max-width:1024px){.execution-grid{grid-template-columns:1fr}.info-cards{grid-template-columns:repeat(2,1fr)}.actions-card{grid-column:1/-1}}
@media(max-width:767px){.page-header{align-items:flex-start}.page-header h1{font-size:22px}.info-cards{grid-template-columns:1fr}}
</style>
