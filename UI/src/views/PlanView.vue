<template>
  <div class="page-wrap">
    <div class="page-head animate-slide-in-up">
      <div><span class="eyebrow">TRAINING PLAN</span><h1>训练计划</h1><p>把每一次完成，变成下一次更好的安排。</p></div>
      <BaseButton :icon="Plus" @click="manualOpen = !manualOpen">{{ manualOpen ? '收起手工录入' : '手工录入一项' }}</BaseButton>
    </div>

    <div class="toolbar animate-slide-in-up">
      <div class="tabs" role="tablist">
        <button role="tab" :aria-selected="view === 'week'" :class="{ active: view === 'week' }" @click="view = 'week'">本周</button>
        <button role="tab" :aria-selected="view === 'cycle'" :class="{ active: view === 'cycle' }" @click="view = 'cycle'">四周周期</button>
      </div>
      <div class="version">
        <History :size="16" /> 当前版本 <strong>{{ plan ? `v${plan.version}` : '未生成' }}</strong>
        <span class="ver-mode">{{ plan ? (plan.mode === 'public' ? '大众模式' : '运动员模式') : currentLabel }}</span>
        <button class="regen" @click="regenerate">按新条件重生成</button>
      </div>
    </div>

    <p v-if="notice.gateNote" class="gate-note" role="status">{{ notice.gateNote }}</p>
    <p v-if="plan" class="ver-reason">v{{ plan.version }} 原因：{{ plan.reason }}<em v-if="planHistoryCount">· 本机另存 {{ planHistoryCount }} 个历史版本</em></p>
    <ul v-if="notice.conflicts.length" class="conflicts" role="status">
      <li v-for="c in notice.conflicts" :key="c">{{ c }}</li>
    </ul>

    <form v-if="manualOpen" class="manual animate-scale-in" @submit.prevent="saveManual">
      <label><span>日期</span><input v-model="manual.date" type="date" required /></label>
      <label><span>名称</span><input v-model="manual.name" type="text" maxlength="30" placeholder="例如：球场往返跑" required /></label>
      <label><span>时长（分钟）</span><input v-model.number="manual.minutes" type="number" min="1" max="240" required /></label>
      <span class="manual-tip">手工录入的项目标注为"不参与自动推荐"，保存会生成新版本。</span>
      <div class="manual-actions">
        <BaseButton size="sm" :icon="Plus" type="submit">保存为新版本</BaseButton>
        <BaseButton variant="ghost" size="sm" @click="manualOpen = false">取消</BaseButton>
      </div>
      <p v-if="manualError" class="manual-error" role="alert">{{ manualError }}</p>
    </form>

    <div v-if="view === 'week'" class="layout">
      <BaseCard class="calendar animate-slide-in-up">
        <div class="month">
          <button aria-label="上一月" @click="shiftMonth(-1)"><ChevronLeft :size="18" /></button>
          <strong>{{ monthLabel }}</strong>
          <button aria-label="下一月" :disabled="!canForward" @click="shiftMonth(1)"><ChevronRight :size="18" /></button>
        </div>
        <div class="weekdays"><span v-for="d in weekdays" :key="d">{{ d }}</span></div>
        <div class="calendar-grid">
          <template v-for="(day, i) in cells" :key="i">
            <span v-if="day === null" class="blank"></span>
            <button
              v-else
              :class="{ today: isToday(day), selected: isSelected(day), rest: !hasPlan(day) }"
              @click="select(day)"
            ><span>{{ day }}</span><i v-if="hasPlan(day)"></i></button>
          </template>
        </div>
        <div class="legend">
          <span><i class="dot plan"></i>计划训练</span>
          <span><i class="dot locked"></i>锁定项目</span>
          <span><i class="dot rest-dot"></i>休息日</span>
        </div>
      </BaseCard>

      <BaseCard :key="selected" class="detail animate-slide-in-up">
        <div class="detail-head">
          <div><span class="eyebrow">{{ eyebrow }}</span><h2>{{ selectedDateLabel }}</h2></div>
          <StatusBadge :variant="planForSelected.length ? (isPast ? 'neutral' : 'info') : 'success'">
            {{ planForSelected.length ? (isPast ? '已过去' : '待完成') : '休息日' }}
          </StatusBadge>
        </div>

        <div class="detail-hero">
          <div class="detail-icon"><Dumbbell :size="16" /></div>
          <div><h3>{{ planForSelected.length ? planTitle : '今日休息' }}</h3><p>{{ planForSelected.length ? '按当前条件安排 · 可锁定、替换或标记完成' : '不安排训练，也不影响后续计划' }}</p></div>
          <Lock v-if="planForSelected.some(i => i.locked)" :size="17" class="lock" />
        </div>

        <div v-for="item in planForSelected" :key="item.id" class="plan-item">
          <div class="item-icon"><component :is="iconFor(item.type)" :size="17" /></div>
          <div class="item-info">
            <strong>{{ item.exerciseName }}</strong>
            <small>{{ item.note }}<em v-if="item.locked"> · 已锁定</em><em v-if="item.completed"> · 已完成</em></small>
          </div>
          <span>{{ item.plannedDuration }} min</span>
          <div class="item-actions">
            <button class="mini" :aria-pressed="item.completed" :disabled="!plan" @click="toggleComplete(item)">{{ item.completed ? '撤销完成' : '标记完成' }}</button>
            <button class="mini" :aria-pressed="item.locked" :disabled="!plan" @click="toggleLock(item)">{{ item.locked ? '解锁' : '锁定' }}</button>
          </div>
        </div>

        <p v-if="!planForSelected.length" class="rest-note"><Moon :size="16" /> 这一天没有安排训练。它表示"未安排"，不代表没有活动。</p>

        <div v-if="replaceTargets.length" class="replace">
          <span class="replace-label">可替换候选（按你的器材、场地与"需要避开的"筛过，带原因）</span>
          <div v-for="row in replaceTargets" :key="row.item.id" class="replace-row">
            <strong>{{ row.item.exerciseName }}</strong>
            <button v-for="alt in row.alts" :key="alt.id" class="alt" @click="applyReplace(row.item, alt)">{{ alt.name }}<small>{{ alt.reason }}</small></button>
          </div>
        </div>
        <p v-else-if="planForSelected.length" class="replace-none">今天没有符合条件的替换候选：已锁定项目不参与替换，其余候选被器材、场地或"需要避开的"筛掉了。</p>

        <div class="detail-actions">
          <BaseButton
            :icon="Play"
            :disabled="!firstExercise"
            :title="firstExercise ? '用摄像头跟练这一项' : '今天的项目里没有摄像头能计数的动作（只有坐站训练 / 站姿弯举可跟练）'"
            @click="start"
          >开始跟练</BaseButton>
          <BaseButton variant="secondary" :icon="RefreshCw" :disabled="!replaceTargets.length" @click="showReplaceHelp">替换说明</BaseButton>
        </div>
      </BaseCard>
    </div>

    <div v-else class="cycle">
      <BaseCard v-for="phase in cyclePhases" :key="phase.name" class="phase animate-slide-in-up" :class="{ current: phase.current }">
        <span class="phase-tag">{{ phase.current ? '当前' : phase.past ? '已过' : '计划中' }}</span>
        <h3>{{ phase.name }}</h3>
        <p>{{ phase.note }}</p>
        <div class="load-bar"><i :style="{ width: phase.load === null ? '0' : phase.load + '%' }"></i></div>
        <small>{{ phase.load === null ? '负荷未记录（缺 RPE 或本周没有训练）' : `相对四周峰值负荷 ${phase.load}%` }} · {{ phase.weeks }}</small>
      </BaseCard>
      <p v-if="!cycleStart" class="cycle-note">四周周期以档案里的"周期开始"日期为起点。没填时这里只说明阶段划分，负荷一律标为"未记录"——不用示例数字冒充你的数据。</p>
    </div>

    <BaseCard class="version-card animate-slide-in-up">
      <div>
        <span class="eyebrow">PLAN HISTORY</span>
        <h3>{{ adjustment ? (adjustResolved ? '调整建议已处理' : '有 1 条调整建议等待确认') : '暂无待确认的调整' }}</h3>
        <p>{{ adjustment ? `${adjustment.reason}；已完成和锁定项目保持不变。` : '调整只在你的安排与实际可用时间冲突时提出，且不会自动改写周期目标。' }}</p>
      </div>
      <BaseButton v-if="adjustment && !adjustResolved" variant="secondary" :icon="GitCompare" @click="adjustOpen = !adjustOpen">
        {{ adjustOpen ? '收起调整预览' : '查看调整预览' }}
      </BaseButton>
      <StatusBadge v-else-if="adjustment" variant="success">已接受</StatusBadge>
      <StatusBadge v-else variant="neutral">无建议</StatusBadge>
    </BaseCard>

    <BaseCard v-if="adjustment && adjustOpen && !adjustResolved" class="adjust animate-scale-in">
      <div class="adjust-row">
        <div><span class="adjust-label">原安排</span><strong>{{ adjustment.from }}</strong><small>{{ adjustment.fromDetail }}</small></div>
        <ArrowRight :size="18" class="adjust-arrow" />
        <div><span class="adjust-label">建议改为</span><strong>{{ adjustment.to }}</strong><small>{{ adjustment.toDetail }}</small></div>
      </div>
      <p class="adjust-note">仅移动这一项，其他安排与已锁定项目不受影响；接受后生成新版本，旧版本留在本机历史里。</p>
      <div class="adjust-actions">
        <BaseButton size="sm" @click="acceptAdjustment">接受调整</BaseButton>
        <BaseButton variant="ghost" size="sm" @click="keepPlan">保持原计划</BaseButton>
      </div>
    </BaseCard>

    <BaseCard v-if="planHistoryCount" class="history animate-slide-in-up">
      <div class="card-head"><div><span class="eyebrow">VERSIONS</span><h3>本机计划历史</h3></div><span class="fine">{{ planHistoryCount }} 个版本</span></div>
      <ul class="verlist">
        <li v-for="h in recentHistory" :key="`${h.id}-v${h.version}`">
          <b>v{{ h.version }}</b><span>{{ h.mode === 'public' ? '大众' : '运动员' }}</span><em>{{ h.reason }}</em><small>{{ h.createdAt.slice(0, 16).replace('T', ' ') }}</small>
        </li>
      </ul>
    </BaseCard>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  Plus, History, ChevronLeft, ChevronRight, Dumbbell, Lock, Play, RefreshCw,
  GitCompare, ArrowRight, Moon, Flame, Wind, PersonStanding, StretchHorizontal, Activity
} from 'lucide-vue-next'
import BaseCard from '@/components/common/BaseCard.vue'
import BaseButton from '@/components/common/BaseButton.vue'
import StatusBadge from '@/components/common/StatusBadge.vue'
import { useAppStore } from '@/stores/app'
import type { AlternativeExercise, PlanItem, TrainingType } from '@/types/domain'
import { eyebrowDate, monthCells, shortDate, toISODate } from '@/utils/time'
import { buildDayPlan, alternativesFor } from '@/services/planRules'
import { findExercise } from '@/services/exercises'
import { weekDates, weekStart, buildWeeklyReport } from '@/services/weekRules'

const router = useRouter()
const store = useAppStore()

const now = new Date()
const weekdays = ['一', '二', '三', '四', '五', '六', '日']
const view = ref<'week' | 'cycle'>('week')
const cursor = ref({ year: now.getFullYear(), month: now.getMonth() })
const selected = ref(toISODate(now))
const adjustOpen = ref(false)
const adjustResolved = ref(false)
const manualOpen = ref(false)
const manual = ref({ date: toISODate(now), name: '', minutes: 20 })
const manualError = ref('')

const icons: Partial<Record<TrainingType, typeof Wind>> = {
  动态热身: Wind,
  坐站训练: PersonStanding,
  站姿弯举: Flame,
  舒缓整理: StretchHorizontal,
  跑步: Activity,
  其他: Dumbbell
}

const currentLabel = computed(() => (store.isAthleteMode ? '运动员模式' : '大众模式'))
const selectedDate = computed(() => new Date(`${selected.value}T00:00:00`))
const plan = computed(() => store.weekPlan(selectedDate.value))
const planHistoryCount = computed(() => store.planHistory.length)
const recentHistory = computed(() => [...store.planHistory].reverse().slice(0, 6))
const notice = computed(() => store.dayPlanNotice(selectedDate.value))

/** 已存的周计划优先（含锁定与完成状态）；该周还没有计划时只做实时预览，不落盘 */
function itemsOn(d: Date): PlanItem[] {
  const p = store.weekPlan(d)
  if (p) return p.items.filter(i => i.date === toISODate(d))
  return buildDayPlan(d, store.userProfile, store.currentMode).items
}

const cells = computed(() => monthCells(cursor.value.year, cursor.value.month))
const monthLabel = computed(() => `${cursor.value.year} 年 ${cursor.value.month + 1} 月`)
const dateOf = (day: number) => new Date(cursor.value.year, cursor.value.month, day)
const isoOf = (day: number) => toISODate(dateOf(day))
const hasPlan = (day: number) => itemsOn(dateOf(day)).length > 0
const isToday = (day: number) => isoOf(day) === toISODate(now)
const isSelected = (day: number) => isoOf(day) === selected.value
const canForward = computed(() => {
  const next = new Date(cursor.value.year, cursor.value.month + 1, 1)
  return next <= new Date(now.getFullYear(), now.getMonth() + 3, 1)
})

const planForSelected = computed(() => itemsOn(selectedDate.value))
const selectedDateLabel = computed(() =>
  isTodayValue(selected.value) ? '今天的训练' : `${shortDate(selectedDate.value)} 的训练`
)
const eyebrow = computed(() => eyebrowDate(selectedDate.value).toUpperCase())
const isPast = computed(() => selected.value < toISODate(now))
const planTitle = computed(() => (planForSelected.value.some(i => i.type === '坐站训练') ? '无器械基础体能' : '今日安排'))
const firstExercise = computed(() => {
  const target = planForSelected.value.find(i => i.type === '坐站训练' || i.type === '站姿弯举')
  return target ? target.exerciseName : ''
})

/** F04：候选来自动作库，按器材、场地、时长与"需要避开的"过滤，并带可解释原因 */
const replaceTargets = computed(() =>
  planForSelected.value
    .filter(i => !i.locked)
    .map(i => {
      const origin = findExercise(i.exerciseName)
      if (!origin) return null
      const alts = alternativesFor(origin, store.userProfile).slice(0, 2)
      return alts.length ? { item: i, alts } : null
    })
    .filter((r): r is { item: PlanItem; alts: AlternativeExercise[] } => r !== null)
)

/** 只有真实冲突才提建议：某天计划总时长超过档案里最大的可用时间块 */
const adjustment = computed(() => {
  if (adjustResolved.value) return null
  const budget = Math.max(0, ...(store.userProfile?.availableTimes ?? []).map(t => parseInt(t, 10)).filter(n => Number.isFinite(n)))
  if (!budget) return null
  const total = planForSelected.value.reduce((s, i) => s + (i.plannedDuration ?? 0), 0)
  if (total <= budget) return null
  const item = planForSelected.value.find(i => !i.locked && !i.completed)
  if (!item) return null
  const next = new Date(`${item.date}T00:00:00`)
  next.setDate(next.getDate() + 1)
  const nextIso = toISODate(next)
  return {
    itemId: item.id,
    date: item.date,
    to: nextIso,
    reason: `${shortDate(new Date(`${item.date}T00:00:00`))} 共安排 ${total} 分钟，超过你档案里最大的可用时间 ${budget} 分钟`,
    from: shortDate(new Date(`${item.date}T00:00:00`)),
    fromDetail: `${item.exerciseName} · ${item.plannedDuration ?? 0} min`,
    toDetail: `${item.exerciseName} · ${item.plannedDuration ?? 0} min（原样搬到 ${shortDate(next)}）`
  }
})

const cycleStart = computed(() => store.userProfile?.cycleStartDate ?? '')
const cyclePhases = computed(() => {
  const labels = ['基础准备', '强度建立', '量化提升', '减量与测试']
  const notes = ['打稳节奏，动作质量优先', '加入一段节奏训练', '接近专项强度', '恢复为主，安排一次测试']
  const start = cycleStart.value ? new Date(`${cycleStart.value}T00:00:00`) : null
  const loads = labels.map((_, i) => {
    if (!start) return null
    const ref = new Date(start)
    ref.setDate(start.getDate() + i * 7)
    return buildWeeklyReport(store.sessions, store.meals, ref, { profile: store.userProfile, mode: store.currentMode }).totalLoad
  })
  const peak = Math.max(0, ...loads.filter((l): l is number => l !== null))
  const activeIndex = start ? Math.floor(Math.max(0, now.getTime() - start.getTime()) / 604800000) : -1
  return labels.map((name, i) => {
    const load = loads[i]
    const weekRef = start ? new Date(start.getTime() + i * 604800000) : null
    const first = weekRef ? weekDates(weekStart(weekRef))[0] : null
    return {
      name,
      note: notes[i],
      load: load === null || !peak ? null : Math.round((load / peak) * 100),
      weeks: first ? `${first.getMonth() + 1}月${first.getDate()} 日起 7 天` : `第 ${i * 7 + 1}–${(i + 1) * 7} 天`,
      current: start ? i === activeIndex && activeIndex <= 3 : false,
      past: start ? i < activeIndex : false
    }
  })
})

function isTodayValue(iso: string) {
  return iso === toISODate(now)
}

function iconFor(type: TrainingType) {
  return icons[type] || Dumbbell
}

function shiftMonth(step: number) {
  const d = new Date(cursor.value.year, cursor.value.month + step, 1)
  cursor.value = { year: d.getFullYear(), month: d.getMonth() }
}

function select(day: number) {
  selected.value = isoOf(day)
}

function start() {
  if (!firstExercise.value) return
  router.push({ path: '/execution', query: { exercise: firstExercise.value } })
}

function showReplaceHelp() {
  store.showToast({
    type: 'info',
    title: '替换都按你的条件筛过',
    message: '每个候选带原因；已锁定项目不会被替换。',
    duration: 3000
  })
}

function applyReplace(item: PlanItem, alt: AlternativeExercise) {
  if (!plan.value) return
  store.acceptAdjustment(plan.value.id, [{
    itemId: item.id,
    type: 'changed',
    oldValue: { exerciseName: item.exerciseName, note: item.note },
    newValue: { exerciseName: alt.name, note: `替换自「${item.exerciseName}」：${alt.reason}`, plannedReps: alt.reps ?? item.plannedReps }
  }], `替换「${item.exerciseName}」为「${alt.name}」`)
}

function toggleLock(item: PlanItem) {
  if (!plan.value) return
  store.toggleItemLock(plan.value.id, item.id)
}

function toggleComplete(item: PlanItem) {
  if (!plan.value) return
  store.markItemCompleted(plan.value.id, item.id, !item.completed)
}

function acceptAdjustment() {
  const a = adjustment.value
  if (!a || !plan.value) return
  store.acceptAdjustment(plan.value.id, [{
    itemId: a.itemId,
    type: 'changed',
    oldValue: { date: a.date },
    newValue: { date: a.to }
  }], a.reason)
  adjustResolved.value = true
  adjustOpen.value = false
}

function keepPlan() {
  if (!plan.value) return
  store.rejectAdjustment(plan.value.id)
  adjustResolved.value = true
  adjustOpen.value = false
}

function saveManual() {
  manualError.value = ''
  if (!manual.value.name.trim()) {
    manualError.value = '请填写名称。'
    return
  }
  if (!Number.isFinite(manual.value.minutes) || manual.value.minutes < 1 || manual.value.minutes > 240) {
    manualError.value = '时长要在 1–240 分钟之间。'
    return
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(manual.value.date)) {
    manualError.value = '请选择日期。'
    return
  }
  const p = store.ensureWeekPlan(new Date(`${manual.value.date}T00:00:00`))
  store.addManualItem(p.id, {
    date: manual.value.date,
    exerciseName: manual.value.name.trim(),
    minutes: Math.round(manual.value.minutes)
  })
  manual.value = { date: manual.value.date, name: '', minutes: 20 }
  manualOpen.value = false
}

function regenerate() {
  store.regenerateWeekPlan(selectedDate.value)
}

// 停在某一周时确保该周在当前模式下有计划版本（只在本机落盘）
watch(
  () => [toISODate(weekStart(selectedDate.value)), store.currentMode].join('|'),
  () => {
    if (!store.weekPlan(selectedDate.value)) store.ensureWeekPlan(selectedDate.value)
  },
  { immediate: true }
)
</script>

<style scoped>
.page-wrap{max-width:var(--content-max-width);margin:auto}
/* 小标签统一成 .micro 的样子：短横线 + 10px 大字距，不再用那枚旋转 45° 的小方块 */
.eyebrow{display:inline-flex;align-items:center;gap:8px;font-family:var(--font-num);font-size:10px;letter-spacing:var(--tracking-micro);text-transform:uppercase;color:var(--color-text-muted);font-weight:600}
.eyebrow::before{content:'';width:14px;height:1px;background:var(--color-accent);margin-right:0}
.page-head{display:flex;justify-content:space-between;align-items:flex-end;gap:24px;padding:18px 0 16px}
.page-head h1{font-size:36px;letter-spacing:-.03em;margin:9px 0 0;color:var(--color-ink)}
.page-head p{color:var(--color-text-muted);font-size:12.5px;margin:8px 0 0}
.toolbar{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:12px;padding-bottom:12px;border-bottom:1px solid var(--color-divider)}
.tabs{display:flex;gap:2px;padding:3px;background:var(--color-neutral-soft);border-radius:var(--radius-sm)}
.tabs button{padding:7px 16px;border-radius:5px;color:var(--color-text-muted);font-size:12.5px;font-weight:500;transition:background var(--motion-fast),color var(--motion-fast)}
.tabs button.active{background:var(--color-card);color:var(--color-ink);font-weight:600;box-shadow:var(--shadow-sm)}
.version{display:flex;align-items:center;gap:8px;font-family:var(--font-num);font-size:12px;color:var(--color-text-muted);font-variant-numeric:tabular-nums}
.version strong{color:var(--color-ink);font-weight:600}
.ver-mode{font-size:10.5px;letter-spacing:.04em;padding:2px 6px;border:1px solid var(--color-border);border-radius:var(--radius-sm);color:var(--color-text-secondary)}
.regen{font-size:11.5px;font-weight:600;color:var(--color-accent);background:var(--color-accent-soft);padding:5px 10px;border-radius:var(--radius-sm);min-height:28px;border:1px solid var(--color-accent-line);transition:border-color var(--motion-fast)}
.regen:hover{border-color:var(--color-accent)}
.gate-note{font-size:12.5px;color:var(--color-caution);background:var(--color-caution-soft);border-radius:var(--radius-sm);padding:10px 12px;margin:0 0 10px;line-height:1.65;box-shadow:inset 3px 0 0 var(--color-caution)}
.ver-reason{font-size:11.5px;color:var(--color-text-muted);margin:0 0 12px;line-height:1.6}
.ver-reason em{font-style:normal;margin-left:6px}
.conflicts{margin:0 0 14px;padding:10px 12px 10px 28px;border-radius:var(--radius-sm);background:var(--color-neutral-soft);font-size:12px;color:var(--color-text-secondary);line-height:1.7}
.conflicts li{margin:2px 0}
.manual{display:grid;gap:12px;padding:16px;border-radius:var(--radius-lg);background:var(--color-card);border:1px solid var(--color-border);box-shadow:var(--inner-light);margin-bottom:14px}
.manual label{display:grid;gap:5px;font-size:11px;color:var(--color-text-muted)}
.manual input{padding:9px 11px;border:1px solid var(--color-border);border-radius:var(--radius-sm);font-size:13px;font-family:inherit;color:var(--color-ink);background:var(--surface-field)}
.manual-tip{font-size:11.5px;color:var(--color-text-muted);line-height:1.6}
.manual-actions{display:flex;gap:8px;flex-wrap:wrap}
.manual-error{font-size:12.5px;color:var(--color-danger);background:var(--color-danger-soft);border-radius:var(--radius-sm);padding:9px 12px;margin:0}
.layout{display:grid;grid-template-columns:1.05fr 1fr;gap:14px;align-items:start}
/* 日历：月份头、7 列网格、图例三段；格子只在选中/今天才上色，其余留白 */
.calendar{--card-pad:0 0 14px}
.month{display:flex;align-items:center;justify-content:space-between;padding:12px 18px 10px;border-bottom:1px solid var(--hair-soft);margin-bottom:12px}
.month strong{font-family:var(--font-num);font-size:15px;font-weight:600;color:var(--color-ink);font-variant-numeric:tabular-nums}
.month button{width:28px;height:28px;border-radius:var(--radius-sm);color:var(--color-text-secondary);display:grid;place-items:center;border:1px solid var(--hair-strong);transition:border-color var(--motion-fast),color var(--motion-fast)}
.month button:hover:enabled{border-color:var(--color-ink);color:var(--color-ink)}
.month button:disabled{opacity:.35;cursor:not-allowed}
.weekdays,.calendar-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:4px;text-align:center}
.weekdays{padding:0 14px;font-family:var(--font-num);font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--color-text-muted);margin-bottom:6px}
.calendar-grid{padding:0 14px}
.calendar-grid button{height:46px;border-radius:var(--radius-sm);position:relative;color:var(--color-text-secondary);font-family:var(--font-num);font-size:12.5px;font-variant-numeric:tabular-nums;transition:background var(--motion-fast),color var(--motion-fast)}
.calendar-grid .blank{height:46px}
.calendar-grid button:hover:enabled{background:var(--color-neutral-soft);color:var(--color-ink)}
.calendar-grid button.today{background:var(--color-accent);color:var(--color-on-accent);font-weight:700}
.calendar-grid button.selected:not(.today){background:var(--color-accent-soft);color:var(--color-accent-strong);font-weight:700;box-shadow:inset 0 0 0 1px var(--color-accent-line)}
.calendar-grid button.rest:not(.today){color:var(--hair-strong)}
.calendar-grid i{position:absolute;width:4px;height:4px;border-radius:50%;background:var(--color-accent);bottom:6px;left:50%;transform:translateX(-50%)}
.calendar-grid .today i{background:var(--color-on-accent)}
.legend{display:flex;gap:16px;margin:12px 18px 0;padding-top:10px;border-top:1px solid var(--hair-soft);font-size:10.5px;color:var(--color-text-muted)}
.legend span{display:flex;align-items:center;gap:5px}
.dot{display:inline-block;width:6px;height:6px;border-radius:50%}
.dot.plan{background:var(--color-accent)}.dot.locked{background:var(--color-accent-strong)}.dot.rest-dot{background:transparent;box-shadow:inset 0 0 0 1px var(--hair-strong)}
.detail{--card-pad:0 0 18px}
.detail-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:13px 20px 11px;border-bottom:1px solid var(--hair-soft);margin-bottom:0}
.detail-head h2{font-family:var(--font-num);font-size:19px;font-weight:600;letter-spacing:-.02em;margin-top:5px}
/* 当日摘要：一条发丝线 + 一个小方块图标，不再是整块浅绿 */
.detail-hero{display:flex;align-items:center;gap:12px;padding:13px 20px;border-bottom:1px dashed var(--color-divider)}
.detail-icon{width:32px;height:32px;border-radius:var(--radius-sm);color:var(--color-accent);background:var(--color-accent-soft);display:grid;place-items:center;flex:none}
.detail-hero h3{font-size:14.5px;font-weight:600}.detail-hero p{font-size:11.5px;color:var(--color-text-muted);margin:3px 0 0}
.detail-hero .lock{margin-left:auto;color:var(--color-text-muted)}
/* 计划项：账本行，hover 只改底色，不做位移和图标旋转 */
.plan-item{display:flex;align-items:center;gap:11px;padding:11px 20px;border-bottom:1px solid var(--hair-soft);transition:background var(--motion-fast);flex-wrap:wrap}
.plan-item:hover{background:var(--color-neutral-soft)}
.item-icon{width:28px;height:28px;border-radius:var(--radius-sm);background:var(--color-neutral-soft);color:var(--color-text-secondary);display:grid;place-items:center;flex:none}
.item-info{flex:1;min-width:150px}.item-info strong,.item-info small{display:block}
.item-info strong{font-size:13.5px;font-weight:600;color:var(--color-ink)}.item-info small{font-size:11.5px;color:var(--color-text-muted);margin-top:2px;line-height:1.5}
.item-info em{font-style:normal;color:var(--color-accent)}
.plan-item>span{font-family:var(--font-num);font-size:11.5px;color:var(--color-text-secondary);font-variant-numeric:tabular-nums;white-space:nowrap}
.item-actions{display:flex;gap:5px;flex-wrap:wrap}
.mini{font-size:11px;padding:4px 9px;min-height:26px;border-radius:var(--radius-sm);background:transparent;border:1px solid var(--hair-strong);color:var(--color-text-muted);transition:border-color var(--motion-fast),color var(--motion-fast),background var(--motion-fast)}
.mini:hover:enabled{border-color:var(--color-ink);color:var(--color-ink)}
.mini[aria-pressed="true"]{background:var(--color-accent);border-color:var(--color-accent);color:var(--color-on-accent)}
.mini:disabled{opacity:.4;cursor:not-allowed}
.rest-note{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--color-text-muted);padding:14px 20px}
.replace{margin:2px 20px 0;padding-top:12px;border-top:1px solid var(--hair-soft);display:grid;gap:9px}
.replace-label{font-family:var(--font-num);font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--color-text-muted)}
.replace-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.replace-row strong{font-size:12.5px;color:var(--color-ink);font-weight:600;margin-right:2px}
.alt{display:grid;gap:2px;text-align:left;font-size:12px;font-weight:600;color:var(--color-text-secondary);background:var(--color-card);padding:6px 10px;border-radius:var(--radius-sm);min-height:40px;border:1px solid var(--hair-strong);transition:border-color var(--motion-fast),color var(--motion-fast)}
.alt small{font-size:10px;font-weight:400;color:var(--color-text-muted)}
.alt:hover{border-color:var(--color-accent);color:var(--color-accent)}
.replace-none{font-size:11.5px;color:var(--color-text-muted);margin:10px 20px 0;line-height:1.6}
.detail-actions{display:flex;gap:8px;flex-wrap:wrap;margin:16px 20px 0;padding-top:14px;border-top:1px solid var(--hair-soft)}
.cycle{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}
.phase{position:relative;--card-pad:16px 16px 15px}
.phase.current{box-shadow:inset 0 0 0 1px var(--color-accent-line),var(--inner-light)}
.phase-tag{position:absolute;top:14px;right:14px;font-family:var(--font-num);font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:var(--color-text-muted);font-weight:600}
.phase.current .phase-tag{color:var(--color-accent)}
.phase h3{font-size:15px;margin-bottom:5px}
.phase p{font-size:11.5px;color:var(--color-text-muted);margin:0 0 12px;line-height:1.6}
.load-bar{height:4px;background:var(--color-divider);border-radius:2px;overflow:hidden}
.load-bar i{display:block;height:100%;background:var(--color-accent);border-radius:2px}
.phase small{display:block;margin-top:8px;font-size:10.5px;color:var(--color-text-muted);line-height:1.5}
.cycle-note{grid-column:1/-1;font-size:12px;color:var(--color-text-secondary);background:var(--color-neutral-soft);border-radius:var(--radius-sm);padding:11px 13px;margin:0;line-height:1.65}
.version-card{margin-top:14px;display:flex;align-items:center;justify-content:space-between;gap:16px}
.version-card h3{font-size:15px;margin:5px 0}.version-card p{font-size:12px;color:var(--color-text-muted);margin:0;line-height:1.6}
.adjust{margin-top:14px}
.adjust-row{display:flex;align-items:center;gap:20px;flex-wrap:wrap}
.adjust-row>div{flex:1;min-width:180px}
.adjust-label{display:block;font-family:var(--font-num);font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--color-text-muted);margin-bottom:4px}
.adjust-row strong{display:block;font-size:14px;color:var(--color-ink);font-weight:600}
.adjust-row small{display:block;font-size:11.5px;color:var(--color-text-muted);margin-top:3px}
.adjust-arrow{color:var(--color-text-muted)}
.adjust-note{font-size:11.5px;color:var(--color-text-muted);margin:13px 0;line-height:1.6}
.adjust-actions{display:flex;gap:8px;flex-wrap:wrap}
.adjust-actions :deep(button){width:auto;padding:0 18px}
.history{margin-top:14px}
.card-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px}
.card-head h3{font-size:15px;margin:5px 0 0}
.fine{font-family:var(--font-num);font-size:10.5px;color:var(--color-text-muted)}
.verlist{list-style:none;margin:0;padding:0;display:grid;gap:0}
.verlist li{display:flex;align-items:baseline;gap:10px;font-size:12px;color:var(--color-text-secondary);padding:8px 0;border-top:1px solid var(--hair-soft);flex-wrap:wrap}
.verlist b{font-family:var(--font-num);color:var(--color-ink);font-size:12px;font-weight:600}
.verlist em{font-style:normal;flex:1;min-width:180px;color:var(--color-text-muted)}
.verlist span{font-size:10.5px;color:var(--color-text-muted);padding:1px 5px;border:1px solid var(--color-border);border-radius:4px}
.verlist small{font-family:var(--font-num);font-size:10.5px;color:var(--color-text-muted);font-variant-numeric:tabular-nums}
@media(max-width:900px){.layout{grid-template-columns:1fr}.cycle{grid-template-columns:repeat(2,1fr)}}
@media(max-width:767px){.page-head{flex-direction:column;align-items:stretch;gap:12px;padding:14px 0 12px}.page-head h1{font-size:28px}.page-head :deep(button){display:none}.toolbar{align-items:center;gap:10px;flex-wrap:wrap}.version{margin-left:auto}.calendar-grid button,.calendar-grid .blank{height:42px}.legend{gap:10px;font-size:10px;margin:10px 14px 0}.version-card{align-items:stretch;gap:14px;flex-direction:column}.version-card :deep(button){width:100%}.cycle{grid-template-columns:1fr}}
</style>
