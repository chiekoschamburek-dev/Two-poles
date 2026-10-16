<template>
  <div class="page-wrap">
    <div class="page-head animate-slide-in-up">
      <div><span class="eyebrow">TRAINING PLAN</span><h1>训练计划</h1><p>把每一次完成，变成下一次更好的安排。</p></div>
      <BaseButton :icon="Plus" @click="newVersion">新建计划</BaseButton>
    </div>

    <div class="toolbar animate-slide-in-up" style="animation-delay:90ms">
      <div class="tabs" role="tablist">
        <button role="tab" :aria-selected="view === 'week'" :class="{ active: view === 'week' }" @click="view = 'week'">本周</button>
        <button role="tab" :aria-selected="view === 'cycle'" :class="{ active: view === 'cycle' }" @click="view = 'cycle'">四周周期</button>
      </div>
      <div class="version"><History :size="16" /> 当前版本 <strong>v{{ version }}</strong><ChevronDown :size="15" /></div>
    </div>

    <div v-if="view === 'week'" class="layout">
      <BaseCard class="calendar animate-slide-in-up" style="animation-delay:160ms">
        <div class="month">
          <button aria-label="上一月" @click="shiftMonth(-1)"><ChevronLeft :size="18" /></button>
          <strong>{{ monthLabel }}</strong>
          <button aria-label="下一月" @click="shiftMonth(1)"><ChevronRight :size="18" /></button>
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

      <BaseCard :key="selected" class="detail animate-slide-in-up" style="animation-delay:230ms">
        <div class="detail-head">
          <div><span class="eyebrow">{{ eyebrow }}</span><h2>{{ selectedDateLabel }}</h2></div>
          <StatusBadge :variant="planForSelected.length ? (isPast ? 'neutral' : 'info') : 'success'">
            {{ planForSelected.length ? (isPast ? '已过去' : '待完成') : '休息日' }}
          </StatusBadge>
        </div>

        <div class="detail-hero">
          <div class="detail-icon"><Dumbbell :size="24" /></div>
          <div><h3>{{ planForSelected.length ? planTitle : '今日休息' }}</h3><p>{{ planForSelected.length ? '按当前条件安排 · 可随时调整' : '不安排训练，也不影响后续计划' }}</p></div>
          <Lock v-if="planForSelected.some(i => i.locked)" :size="17" class="lock" />
        </div>

        <div v-for="item in planForSelected" :key="item.id" class="plan-item">
          <div class="item-icon"><component :is="iconFor(item.type)" :size="17" /></div>
          <div class="item-info">
            <strong>{{ displayName(item) }}</strong>
            <small>{{ item.note }}<em v-if="item.locked"> · 已锁定</em></small>
          </div>
          <span>{{ item.plannedDuration }} min</span>
        </div>

        <p v-if="!planForSelected.length" class="rest-note"><Moon :size="16" /> 这一天没有安排训练。它表示"未安排"，不代表没有活动。</p>

        <div class="detail-actions">
          <BaseButton :icon="Play" :disabled="!firstExercise" @click="start">开始跟练</BaseButton>
          <BaseButton variant="secondary" :icon="RefreshCw" :disabled="!firstExercise" @click="replaceFirst">替换动作</BaseButton>
        </div>
      </BaseCard>
    </div>

    <div v-else class="cycle">
      <BaseCard v-for="(phase, i) in cyclePhases" :key="phase.name" class="phase animate-slide-in-up" :class="{ current: phase.current }" :style="{ animationDelay: 160 + i * 90 + 'ms' }">
        <span class="phase-tag">{{ phase.current ? '当前' : '计划中' }}</span>
        <h3>{{ phase.name }}</h3>
        <p>{{ phase.note }}</p>
        <div class="load-bar"><i :style="{ width: phase.load + '%' }"></i></div>
        <small>训练负荷 {{ phase.load }}% · 第 {{ phase.weeks }}</small>
      </BaseCard>
    </div>

    <BaseCard class="version-card animate-slide-in-up" style="animation-delay:300ms">
      <div>
        <span class="eyebrow">PLAN HISTORY</span>
        <h3>{{ adjustResolved ? '调整建议已处理' : '有 1 条调整建议等待确认' }}</h3>
        <p>{{ adjustment.reason }}；已完成和锁定项目保持不变。</p>
      </div>
      <BaseButton v-if="!adjustResolved" variant="secondary" :icon="GitCompare" @click="adjustOpen = !adjustOpen">
        {{ adjustOpen ? '收起调整预览' : '查看调整预览' }}
      </BaseButton>
      <StatusBadge v-else variant="success">已接受</StatusBadge>
    </BaseCard>

    <BaseCard v-if="adjustOpen && !adjustResolved" class="adjust animate-scale-in">
      <div class="adjust-row">
        <div><span class="adjust-label">原安排</span><strong>{{ adjustment.from }}</strong><small>{{ adjustment.fromDetail }}</small></div>
        <ArrowRight :size="18" class="adjust-arrow" />
        <div><span class="adjust-label">建议改为</span><strong>{{ adjustment.to }}</strong><small>{{ adjustment.toDetail }}</small></div>
      </div>
      <p class="adjust-note">仅移动这一项，其他安排与已锁定项目不受影响；调整不会自动改写周期计划。</p>
      <div class="adjust-actions">
        <BaseButton size="sm" @click="acceptAdjustment">接受调整</BaseButton>
        <BaseButton variant="ghost" size="sm" @click="adjustOpen = false">保持原计划</BaseButton>
      </div>
    </BaseCard>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import {
  Plus, History, ChevronDown, ChevronLeft, ChevronRight, Dumbbell, Lock, Play, RefreshCw,
  GitCompare, ArrowRight, Moon, Flame, Wind, PersonStanding, StretchHorizontal, Activity
} from 'lucide-vue-next'
import BaseCard from '@/components/common/BaseCard.vue'
import BaseButton from '@/components/common/BaseButton.vue'
import StatusBadge from '@/components/common/StatusBadge.vue'
import { useAppStore } from '@/stores/app'
import type { AlternativeExercise, PlanItem, TrainingType } from '@/types/domain'
import { eyebrowDate, monthCells, shortDate, toISODate } from '@/utils/time'
import { itemsFor as planItemsFor } from '@/services/planRules'

const router = useRouter()
const store = useAppStore()

const now = new Date()
const weekdays = ['一', '二', '三', '四', '五', '六', '日']
const version = ref(2)
const view = ref<'week' | 'cycle'>('week')
const cursor = ref({ year: now.getFullYear(), month: now.getMonth() })
const selected = ref(toISODate(now))
const overrides = ref<Record<string, string>>({})
const adjustOpen = ref(false)
const adjustResolved = ref(false)

const icons: Partial<Record<TrainingType, typeof Wind>> = {
  动态热身: Wind,
  坐站训练: PersonStanding,
  站姿弯举: Flame,
  舒缓整理: StretchHorizontal,
  跑步: Activity,
  其他: Dumbbell
}

function itemsFor(d: Date): PlanItem[] {
  return planItemsFor(d, version.value)
}

const cells = computed(() => monthCells(cursor.value.year, cursor.value.month))
const monthLabel = computed(() => `${cursor.value.year} 年 ${cursor.value.month + 1} 月`)
const dateOf = (day: number) => new Date(cursor.value.year, cursor.value.month, day)
const isoOf = (day: number) => toISODate(dateOf(day))
const hasPlan = (day: number) => itemsFor(dateOf(day)).length > 0
const isToday = (day: number) => isoOf(day) === toISODate(now)
const isSelected = (day: number) => isoOf(day) === selected.value

const selectedDate = computed(() => new Date(`${selected.value}T00:00:00`))
const planForSelected = computed(() => itemsFor(selectedDate.value))
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

function isTodayValue(iso: string) {
  return iso === toISODate(now)
}

function iconFor(type: TrainingType) {
  return icons[type] || Dumbbell
}

function displayName(item: PlanItem) {
  return overrides.value[item.id] || item.exerciseName
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

function replaceFirst() {
  const item = planForSelected.value.find(i => i.alternatives?.length && !i.locked)
  if (!item) {
    store.showToast({ type: 'info', title: '今天没有可替换的动作', message: '已锁定项目不会被替换', duration: 2500 })
    return
  }
  const alts = item.alternatives as AlternativeExercise[]
  const current = overrides.value[item.id]
  const nextIndex = current ? (alts.findIndex(a => a.name === current) + 1) % alts.length : 0
  const next = alts[nextIndex]
  overrides.value = { ...overrides.value, [item.id]: next.name }
  store.showToast({ type: 'success', title: `已替换为${next.name}`, message: next.reason, duration: 2500 })
}

function newVersion() {
  version.value++
  store.showToast({ type: 'success', title: `已创建 v${version.value} 草稿`, message: '原版本继续保留，可对比后再生效', duration: 3000 })
}

const nextSaturday = computed(() => {
  const d = new Date(now)
  d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7))
  return d
})

const adjustment = computed(() => {
  const sat = nextSaturday.value
  const sun = new Date(sat)
  sun.setDate(sat.getDate() + 1)
  return {
    reason: `${shortDate(sat)} 可用时间缩短`,
    from: shortDate(sat),
    fromDetail: '舒缓整理 · 4 min',
    to: shortDate(sun),
    toDetail: '舒缓整理 · 4 min（原样搬移）'
  }
})

function acceptAdjustment() {
  adjustResolved.value = true
  adjustOpen.value = false
  store.showToast({ type: 'success', title: '已接受调整', message: `${adjustment.value.to} 已加入整理安排`, duration: 3000 })
}

const cyclePhases = computed(() => {
  const labels = ['基础准备', '强度建立', '量化提升', '减量与测试']
  const notes = ['打稳节奏，动作质量优先', '加入一段节奏训练', '接近专项强度', '恢复为主，安排一次测试']
  const loads = [55, 72, 88, 40]
  return labels.map((name, i) => ({
    name,
    note: notes[i],
    load: loads[i],
    weeks: `${i * 7 + 1}–${(i + 1) * 7} 天`,
    current: i === 1
  }))
})
</script>

<style scoped>
.page-wrap{max-width:var(--content-max-width);margin:auto}
.page-head{display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:26px}
.eyebrow{display:inline-flex;align-items:center;font-size:11px;letter-spacing:var(--tracking-eyebrow);color:var(--color-accent);font-weight:700}.eyebrow::before{content:'';width:6px;height:6px;border-radius:2px;background:var(--color-accent);transform:rotate(45deg);margin-right:8px}
.page-head h1{font-size:34px;margin:9px 0;color:var(--color-ink)}.page-head p{color:var(--color-text-secondary);margin:0}
.toolbar{display:flex;justify-content:space-between;align-items:center;margin-bottom:18px}
.tabs{padding:4px;background:var(--color-neutral-soft);border-radius:13px;display:flex;box-shadow:inset 0 1px 3px rgba(21,24,27,.09)}
.tabs button{padding:9px 20px;border-radius:9px;color:var(--color-text-secondary);font-size:13px;transition:all var(--motion-base) var(--easing-spring)}
.tabs button.active{background:linear-gradient(180deg,#fff,var(--color-card));color:var(--color-accent);font-weight:700;box-shadow:0 1px 2px rgba(21,24,27,.08),0 4px 10px -4px rgba(21,24,27,.16)}
.version{display:flex;align-items:center;gap:7px;font-size:13px;color:var(--color-text-secondary);padding:9px 13px;background:rgba(255,255,255,.86);border:1px solid rgba(220,229,237,.85);border-radius:11px;box-shadow:var(--inner-light)}
.version strong{color:var(--color-accent)}
.layout{display:grid;grid-template-columns:1.05fr 1fr;gap:20px}
.calendar{padding:22px}
.month{display:flex;align-items:center;justify-content:space-between;margin-bottom:20px}
.month strong{font-size:18px;color:var(--color-ink)}
.month button{width:32px;height:32px;border-radius:9px;color:var(--color-text-secondary);display:grid;place-items:center;transition:all var(--motion-fast)}
.month button:hover{background:var(--color-accent-soft);color:var(--color-accent)}
.weekdays,.calendar-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:6px;text-align:center}
.weekdays{font-size:11px;color:var(--color-text-muted);margin-bottom:8px}
.calendar-grid button{height:58px;border-radius:12px;position:relative;color:var(--color-text-secondary);font-size:13px;font-variant-numeric:tabular-nums;transition:all var(--motion-fast) var(--easing-ease-out)}
.calendar-grid .blank{height:58px}
.calendar-grid button:hover{background:var(--color-accent-soft);transform:translateY(-1px)}
.calendar-grid button.today{background:var(--color-accent);color:white;font-weight:700;box-shadow:var(--shadow-card-lg),inset 0 1px 0 rgba(255,255,255,.35)}
.calendar-grid button.selected:not(.today){background:linear-gradient(150deg,var(--color-accent-soft),var(--color-neutral-soft));color:var(--color-accent);font-weight:700;box-shadow:inset 0 0 0 1px rgba(15,118,110,.28);animation:scaleIn var(--motion-fast) var(--easing-spring)}
.calendar-grid button.rest{color:var(--color-neutral)}
.calendar-grid i{position:absolute;width:5px;height:5px;border-radius:50%;background:var(--color-accent);bottom:8px;left:50%;transform:translateX(-50%)}
.calendar-grid .today i{background:white}
.legend{display:flex;gap:16px;margin-top:22px;font-size:11px;color:var(--color-text-secondary)}
.legend span{display:flex;align-items:center;gap:5px}
.dot{display:inline-block;width:7px;height:7px;border-radius:50%}
.dot.plan{background:var(--color-accent)}.dot.locked{background:var(--color-accent-strong)}.dot.rest-dot{background:var(--color-neutral)}
.detail-head{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px}
.detail-head h2{font-size:24px;margin-top:7px}
.detail-hero{display:flex;align-items:center;gap:12px;padding:16px;border-radius:16px;background:var(--color-accent-soft);box-shadow:inset 0 1px 0 #fff,0 0 0 1px rgba(15,118,110,.1);margin-bottom:14px}
.detail-icon{width:45px;height:45px;border-radius:13px;color:white;background:var(--color-accent);display:grid;place-items:center;box-shadow:var(--shadow-accent),inset 0 1px 0 rgba(255,255,255,.4)}
.detail-hero h3{font-size:17px}.detail-hero p{font-size:12px;color:var(--color-text-secondary);margin:4px 0 0}
.detail-hero .lock{margin-left:auto;color:var(--color-accent-strong)}
.plan-item{display:flex;align-items:center;gap:11px;padding:13px 10px;margin:0 -10px;border-bottom:1px solid var(--color-divider);border-radius:12px;transition:background var(--motion-fast) var(--easing-ease-out),transform var(--motion-fast) var(--easing-ease-out)}
.plan-item:hover{background:linear-gradient(90deg,var(--color-accent-soft),var(--color-neutral-soft));transform:translateX(3px)}
.item-icon{width:34px;height:34px;border-radius:10px;background:linear-gradient(140deg,var(--color-accent-soft),var(--color-neutral-soft));color:var(--color-accent);display:grid;place-items:center;flex:none;box-shadow:inset 0 1px 0 #fff,0 0 0 1px rgba(15,118,110,.1);transition:transform var(--motion-base) var(--easing-spring)}
.plan-item:hover .item-icon{transform:scale(1.08) rotate(-6deg)}
.item-info{flex:1}.item-info strong,.item-info small{display:block}
.item-info strong{font-size:14px}.item-info small{font-size:12px;color:var(--color-text-muted);margin-top:2px}
.item-info em{font-style:normal;color:var(--color-accent)}
.plan-item>span{font-size:12px;color:var(--color-text-secondary)}
.rest-note{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--color-text-secondary);padding:14px 0}
.detail-actions{display:flex;gap:10px;margin-top:20px}
.cycle{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}
.phase{padding:20px;position:relative}
.phase.current{border-color:transparent;box-shadow:var(--shadow-card),inset 0 1px 0 #fff,0 0 0 1px rgba(15,118,110,.3)}
.phase-tag{position:absolute;top:16px;right:16px;font-size:11px;color:var(--color-accent);font-weight:700}
.phase h3{font-size:17px;margin-bottom:6px}
.phase p{font-size:12px;color:var(--color-text-secondary);margin:0 0 14px;line-height:1.6}
.load-bar{height:6px;background:var(--color-divider);border-radius:10px;overflow:hidden;box-shadow:inset 0 1px 2px rgba(21,24,27,.1)}
.load-bar i{display:block;height:100%;background:linear-gradient(90deg,var(--color-accent),var(--color-accent-strong));border-radius:10px;box-shadow:0 0 10px rgba(45,123,184,.5)}
.phase small{display:block;margin-top:8px;font-size:11px;color:var(--color-text-muted)}
.version-card{margin-top:20px;display:flex;align-items:center;justify-content:space-between;gap:16px}
.version-card h3{font-size:17px;margin:5px 0}.version-card p{font-size:13px;color:var(--color-text-secondary);margin:0}
.adjust{margin-top:16px}
.adjust-row{display:flex;align-items:center;gap:20px;flex-wrap:wrap}
.adjust-row>div{flex:1;min-width:180px}
.adjust-label{display:block;font-size:11px;color:var(--color-text-muted);margin-bottom:4px}
.adjust-row strong{display:block;font-size:15px;color:var(--color-ink)}
.adjust-row small{display:block;font-size:12px;color:var(--color-text-secondary);margin-top:3px}
.adjust-arrow{color:var(--color-accent)}
.adjust-note{font-size:12px;color:var(--color-text-secondary);margin:14px 0}
.adjust-actions{display:flex;gap:10px}
.adjust-actions :deep(button){width:auto;padding:0 20px}
@media(max-width:900px){.layout{grid-template-columns:1fr}.cycle{grid-template-columns:repeat(2,1fr)}}
@media(max-width:767px){.page-head h1{font-size:26px}.page-head :deep(button){display:none}.toolbar{align-items:flex-start;gap:12px;flex-wrap:wrap}.version{margin-left:auto}.calendar-grid button,.calendar-grid .blank{height:46px}.legend{gap:8px;font-size:10px}.version-card{align-items:flex-start;gap:15px;flex-direction:column}.version-card :deep(button){width:100%}.cycle{grid-template-columns:1fr}}
</style>
