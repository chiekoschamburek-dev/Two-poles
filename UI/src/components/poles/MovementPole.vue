<template>
  <PoleShell
    pole="movement"
    title="运动"
    eyebrow="左极 · MOVEMENT"
    :chip="weekChip"
    :chip-tone="weekChipTone"
    :tabs="tabs"
    :model-value="tab"
    tabs-label="运动视图"
    @update:model-value="setTab"
    @open-bridge="emit('open-bridge')"
  >
    <template #lead>
      <span class="lead-k">{{ kicker }}</span>
      <h3 v-if="mainItem">
        {{ mainItem.exerciseName }}
        <em>{{ totalMinutes }}</em><span class="unit">分钟</span>
      </h3>
      <h3 v-else>今日休息</h3>
      <p v-if="mainItem">
        {{ timeline.length }} 段 · {{ venueLabel }} · {{ equipLabel }}<template v-if="restrictLabel"> · 避开{{ restrictLabel }}</template>
      </p>
      <p v-else>{{ notice.gateNote || '不安排训练，也不影响后续；有活动就记录一笔。' }}</p>
    </template>

    <template #actions>
      <BaseButton v-if="followable" size="sm" :icon="Play" @click="start">开始跟练</BaseButton>
      <RouterLink v-else to="/plan" class="ghost-action">看计划 <ArrowRight :size="13" /></RouterLink>
      <RouterLink to="/plan" class="text-action">完整计划</RouterLink>
    </template>

    <!-- ——— 今日 ——— -->
    <section
      v-if="tab === 'today'"
      id="movement-panel-today"
      class="panel"
      role="tabpanel"
      aria-labelledby="movement-tab-today"
    >
      <RouterLink v-if="!store.hasProfile" to="/onboarding" class="setup-line">
        <span class="setup-ic"><Sparkles :size="14" /></span>
        <span class="setup-copy">
          <strong>还没建档</strong>
          <small>填几项可用时间、器材与需要避开的，两侧的推荐才会按你的情况收窄。</small>
        </span>
        <ArrowRight :size="13" />
      </RouterLink>

      <BaseCard variant="flush" class="block">
        <div class="block-head">
          <span class="micro">今天的安排</span>
          <span class="head-meta">{{ totalMinutes }} min · {{ timeline.length }} 段</span>
        </div>

        <ol v-if="timeline.length" class="steps">
          <li v-for="(row, i) in timeline" :key="row.id" :class="{ done: row.completed }">
            <span class="step-idx">{{ String(i + 1).padStart(2, '0') }}</span>
            <span class="step-rail" aria-hidden="true"></span>
            <div class="step-main">
              <strong>{{ row.exerciseName }}</strong>
              <small>{{ row.detail }}</small>
            </div>
            <span class="step-dur">{{ row.plannedDuration ?? 0 }}<i>min</i></span>
            <StatusBadge v-if="row.locked" variant="neutral">锁定</StatusBadge>
            <StatusBadge v-else-if="row.completed" variant="success">已完成</StatusBadge>
          </li>
        </ol>

        <div v-else class="empty">
          <span class="empty-ic"><Moon :size="17" /></span>
          <div>
            <strong>{{ notice.gateNote ? '这次没有自动推荐' : '今天没有安排训练' }}</strong>
            <p>{{ notice.gateNote || '这一天不安排训练，也不影响后续计划。想动一动就随手记一笔。' }}</p>
          </div>
        </div>

        <p v-if="lastSame" class="fine-line">
          上次同类：{{ shortDate(new Date(`${lastSame.date}T00:00:00`)) }} · RPE {{ lastSame.rpe ?? '—' }}
        </p>
      </BaseCard>

      <div class="metric-grid">
        <div class="metric">
          <span class="micro">本周完成</span>
          <b>{{ week.completedSessions }}<em>/{{ plannedDays }}</em></b>
          <small>场</small>
        </div>
        <div class="metric">
          <span class="micro">本周时长</span>
          <b>{{ week.totalDuration }}</b>
          <small>min</small>
        </div>
        <div class="metric">
          <span class="micro">本周负荷</span>
          <b>{{ week.totalLoad ?? '—' }}</b>
          <small>{{ week.totalLoad === null ? '缺 RPE 不计' : 'AU' }}</small>
        </div>
      </div>

      <BaseCard variant="flush" class="block">
        <div class="block-head">
          <span class="micro">接下来</span>
          <RouterLink to="/plan" class="head-link">完整计划 <ArrowRight :size="12" /></RouterLink>
        </div>
        <div v-if="upcoming.length" class="up-list">
          <div v-for="u in upcoming" :key="u.iso" class="up-row">
            <span class="up-date">{{ u.label }}</span>
            <span class="up-name">{{ u.names }}</span>
            <span class="up-min">{{ u.minutes }} min</span>
          </div>
        </div>
        <p v-else class="empty-line">接下来 7 天都没有安排训练。可以在完整计划页手工加一项。</p>
      </BaseCard>

      <p class="fine-line">训练记录来自跟练与反馈；未记录不等于没练。</p>
    </section>

    <!-- ——— 本周 ——— -->
    <section
      v-else-if="tab === 'week'"
      id="movement-panel-week"
      class="panel"
      role="tabpanel"
      aria-labelledby="movement-tab-week"
    >
      <BaseCard variant="flush" class="block">
        <div class="block-head">
          <span class="micro">本周 · {{ weekRange }}</span>
          <RouterLink to="/plan" class="head-link">完整计划 <ArrowRight :size="12" /></RouterLink>
        </div>

        <div class="week-rail">
          <button
            v-for="(cell, i) in weekCells"
            :key="cell.iso"
            type="button"
            class="day"
            :class="{ on: selected === cell.iso, today: cell.isToday, rest: !cell.plannedCount }"
            :aria-pressed="selected === cell.iso"
            :aria-label="`${cell.label} ${cell.monthDay}，${cell.plannedCount ? `安排 ${cell.plannedCount} 项` : '休息日'}`"
            @click="selected = cell.iso"
          >
            <span class="wd">{{ WEEK_LABELS[i] }}</span>
            <b>{{ cell.day }}</b>
            <span class="day-dots" aria-hidden="true">
              <i v-for="n in Math.min(cell.plannedCount, 3)" :key="n" :class="{ done: n <= cell.completedCount }"></i>
              <i v-if="!cell.plannedCount" class="rest-dot"></i>
            </span>
            <small>{{ cell.plannedMinutes ? `${cell.plannedMinutes} min` : '休' }}</small>
          </button>
        </div>

        <div class="day-detail">
          <div class="detail-head">
            <strong>{{ selectedCell.label }} {{ selectedCell.monthDay }}</strong>
            <span>{{ selectedCell.plannedMinutes ? `${selectedCell.plannedMinutes} 分钟` : '休息日' }}</span>
          </div>
          <ul v-if="selectedCell.items.length" class="mini-items">
            <li v-for="item in selectedCell.items" :key="item.id">
              <span class="mini-name">{{ item.exerciseName }}</span>
              <small>{{ item.plannedSets && item.plannedReps ? `${item.plannedSets} 组 × ${item.plannedReps} 次` : (item.note || '') }}</small>
              <em>{{ item.plannedDuration ?? 0 }} min</em>
              <StatusBadge v-if="item.locked" variant="neutral">锁定</StatusBadge>
              <StatusBadge v-else-if="item.completed" variant="success">已完成</StatusBadge>
            </li>
          </ul>
          <p v-else class="empty-line">这一天没有安排训练。休息日不影响后续计划。</p>
        </div>
      </BaseCard>

      <BaseCard variant="flush" class="block">
        <div class="block-head">
          <span class="micro">每日负荷 · 只算有 RPE 的场次</span>
          <span class="head-meta">{{ week.totalLoad === null ? '—' : `${week.totalLoad} AU` }}</span>
        </div>

        <div class="load-bars">
          <div v-for="bar in loadBars" :key="bar.label" class="load-col">
            <span class="load-v">{{ bar.value ?? '—' }}</span>
            <div class="load-track">
              <i :class="{ none: bar.value === null }" :style="{ height: `${bar.px}px` }"></i>
            </div>
            <span class="load-d">{{ bar.label }}</span>
          </div>
        </div>
        <p class="fine-line">
          {{ hasLoad ? '负荷 = 时长 × RPE；缺 RPE 的一天整天不出数，不按 0 补齐。' : '本周还没有带 RPE 的训练记录，负荷保持空白而不是 0。' }}
        </p>

        <div v-if="lowShare !== null" class="split-line">
          <span class="micro">近 28 天强度分布</span>
          <span class="split-bar" aria-hidden="true"><i :style="{ width: `${lowShare}%` }"></i></span>
          <span class="split-num">低 {{ lowShare }}% · 高 {{ 100 - lowShare }}%</span>
        </div>
        <p v-if="acwrNote" class="fine-line">{{ acwrNote }}</p>
      </BaseCard>

      <p class="fine-line">计划与记录只统计这台设备上的数据；未记录不等于没练。</p>
    </section>

    <!-- ——— 记录 ——— -->
    <section
      v-else
      id="movement-panel-log"
      class="panel"
      role="tabpanel"
      aria-labelledby="movement-tab-log"
    >
      <BaseCard variant="flush" class="block">
        <div class="block-head">
          <span class="micro">最近训练记录</span>
          <span class="head-meta">{{ store.sessions.length }} 条</span>
        </div>

        <ul v-if="recentSessions.length" class="session-list">
          <li v-for="s in recentSessions" :key="s.id">
            <span class="s-date">{{ weekLabel(s.date) }}</span>
            <div class="s-main">
              <strong>{{ s.exerciseName }}</strong>
              <small>
                {{ s.actualDuration ?? '—' }} min · RPE {{ s.rpe ?? '—' }}
                <template v-if="s.discomfort"> · 报了不适</template>
              </small>
            </div>
            <StatusBadge :variant="s.completionStatus === 'completed' ? 'success' : s.completionStatus === 'partial' ? 'warning' : 'neutral'">
              {{ statusLabel(s.completionStatus) }}
            </StatusBadge>
          </li>
        </ul>

        <div v-else class="empty">
          <span class="empty-ic"><Dumbbell :size="17" /></span>
          <div>
            <strong>还没有训练记录</strong>
            <p>跟练结束后会写回这里；没有记录不等于没练。</p>
          </div>
        </div>
      </BaseCard>

      <div class="inline-actions">
        <!-- 记录页不绑定"今天主项"：没有可跟练项时也能进跟练页自己挑一个动作 -->
        <BaseButton size="sm" :icon="Play" @click="router.push('/execution')">去跟练</BaseButton>
        <RouterLink to="/report" class="text-action">本周周报 <ArrowRight :size="13" /></RouterLink>
      </div>
      <p class="fine-line">RPE 是自评；空着就留空，不按 0 处理。</p>
    </section>

    <template #foot>
      <span class="foot-mark"><PoleMark pole="nutrition" :size="20" /></span>
      <div class="foot-copy">
        <span class="micro">另一极 · 饮食</span>
        <small>{{ nutritionLine }}</small>
      </div>
      <button type="button" class="foot-btn" @click="emit('focus-other')">
        去看看 <ArrowRight :size="13" />
      </button>
    </template>
  </PoleShell>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowRight, Dumbbell, Moon, Play, Sparkles } from 'lucide-vue-next'
import BaseButton from '@/components/common/BaseButton.vue'
import BaseCard from '@/components/common/BaseCard.vue'
import StatusBadge from '@/components/common/StatusBadge.vue'
import PoleMark from './PoleMark.vue'
import PoleShell from './PoleShell.vue'
import { useAppStore } from '@/stores/app'
import type { DayFacts } from '@/services/bridgeRules'
import { buildDayPlan } from '@/services/planRules'
import { buildWeeklyReport, WEEK_LABELS, weekDates, weekStart } from '@/services/weekRules'
import { buildLoadSeries, intensitySplit, loadZone, LOAD_ZONE_TEXT } from '@/services/loadRules'
import { eyebrowDate, shortDate, toISODate } from '@/utils/time'
import type { PlanItem, TrainingSession } from '@/types/domain'

type View = 'today' | 'week' | 'log'

const props = defineProps<{
  /** 另一极今天的实际记录，用来写脚注里的"另一极"摘要 */
  nutrition: DayFacts
}>()

const emit = defineEmits<{
  (e: 'focus-other'): void
  (e: 'open-bridge'): void
}>()

const store = useAppStore()
const router = useRouter()
const now = new Date()
const today = toISODate(now)
const tab = ref<View>('today')
const selected = ref(today)

const tabs = [
  { id: 'today', label: '今日' },
  { id: 'week', label: '本周' },
  { id: 'log', label: '记录' }
]

const notice = computed(() => store.dayPlanNotice(now))
const items = computed<PlanItem[]>(() => notice.value.items)
const mainItem = computed(() => {
  const list = items.value
  if (!list.length) return null
  return [...list].sort((a, b) => (b.plannedDuration ?? 0) - (a.plannedDuration ?? 0))[0]
})
const totalMinutes = computed(() => items.value.reduce((sum, item) => sum + (item.plannedDuration ?? 0), 0))
const followable = computed(() => items.value.find(i => i.type === '坐站训练' || i.type === '站姿弯举') ?? null)

const timeline = computed(() => items.value.map(item => {
  const bits: string[] = []
  if (item.plannedSets && item.plannedReps) bits.push(`${item.plannedSets} 组 × ${item.plannedReps} 次`)
  if (item.note) bits.push(item.note)
  return {
    id: item.id,
    exerciseName: item.exerciseName,
    plannedDuration: item.plannedDuration,
    completed: item.completed,
    locked: item.locked,
    detail: bits.join(' · ') || `${item.plannedDuration ?? 0} 分钟`
  }
}))

const week = computed(() => buildWeeklyReport(store.sessions, store.meals, now, {
  profile: store.userProfile,
  mode: store.currentMode
}))
const weekRange = computed(() => {
  const start = weekStart(now)
  const end = new Date(start)
  end.setDate(start.getDate() + 6)
  return `${start.getMonth() + 1}.${start.getDate()} — ${end.getMonth() + 1}.${end.getDate()}`
})
const kicker = computed(() => {
  const p = store.userProfile
  const phase = store.isAthleteMode
    ? (p?.cyclePhase || '周期训练')
    : (p?.goal || '基础体能')
  return `${eyebrowDate(now)} · ${phase}`
})
const venueLabel = computed(() => store.userProfile?.availableVenues?.length
  ? store.userProfile.availableVenues.join(' / ')
  : '任意场地')
const equipLabel = computed(() => store.userProfile?.equipment?.length
  ? store.userProfile.equipment.join(' / ')
  : '无器材')
const restrictLabel = computed(() => store.userProfile?.restrictions?.join('、') ?? '')

interface WeekCell {
  iso: string
  day: number
  monthDay: string
  label: string
  isToday: boolean
  items: PlanItem[]
  plannedMinutes: number
  plannedCount: number
  completedCount: number
}

const weekCells = computed<WeekCell[]>(() => {
  const start = weekStart(now)
  return weekDates(start).map((d, i) => {
    const iso = toISODate(d)
    const plan = store.weekPlan(d)
    const list = plan
      ? plan.items.filter(item => item.date === iso)
      : buildDayPlan(d, store.userProfile, store.currentMode).items
    return {
      iso,
      day: d.getDate(),
      monthDay: `${d.getMonth() + 1}.${d.getDate()}`,
      label: `周${WEEK_LABELS[i]}`,
      isToday: iso === today,
      items: list,
      plannedMinutes: list.reduce((sum, item) => sum + (item.plannedDuration ?? 0), 0),
      plannedCount: list.length,
      completedCount: list.filter(item => item.completed).length
    }
  })
})
const selectedCell = computed(() => weekCells.value.find(cell => cell.iso === selected.value) ?? weekCells.value[0])

/** 以本机已存的周计划为准：模型计划可能是 5 天，不能再用规则模板的 3 天当分母 */
const plannedDays = computed(() => weekCells.value.filter(cell => cell.plannedCount > 0).length)
const weekChip = computed(() => plannedDays.value
  ? `${week.value.completedSessions}/${plannedDays.value} 场`
  : '本周无安排')
const weekChipTone = computed<'' | 'ok' | 'part'>(() => {
  if (!plannedDays.value) return ''
  if (week.value.completedSessions >= plannedDays.value) return 'ok'
  return week.value.completedSessions > 0 ? 'part' : ''
})

const loadBars = computed(() => {
  const values = week.value.loadByDay
  const max = Math.max(1, ...values.map(v => v ?? 0))
  return values.map((value, i) => ({
    label: WEEK_LABELS[i],
    value,
    px: value === null ? 2 : Math.max(6, Math.round((value / max) * 52))
  }))
})
const hasLoad = computed(() => week.value.totalLoad !== null)

const isAthlete = computed(() => store.isAthleteMode)
const loadSeries = computed(() => buildLoadSeries(store.sessions, now))
const split = computed(() => intensitySplit(store.sessions, { since: loadSeries.value.points[0]?.date }))
const lowShare = computed(() => split.value.lowShare === null ? null : Math.round(split.value.lowShare * 100))
const acwrNote = computed(() => {
  if (!isAthlete.value) return ''
  const zone = loadZone(loadSeries.value.acwr)
  if (loadSeries.value.acwr === null) {
    return `ACWR 还需 ${loadSeries.value.daysNeeded} 天样本，暂不给比值。`
  }
  return `近 28 天 ACWR ${loadSeries.value.acwr} · ${LOAD_ZONE_TEXT[zone]}`
})

const upcoming = computed(() => {
  const out: { iso: string; label: string; names: string; minutes: number }[] = []
  for (let i = 1; i <= 7 && out.length < 3; i++) {
    const d = new Date(now)
    d.setDate(now.getDate() + i)
    const dayNotice = store.dayPlanNotice(d)
    if (!dayNotice.items.length) continue
    out.push({
      iso: toISODate(d),
      label: `${WEEK_LABELS[(d.getDay() + 6) % 7]} ${d.getMonth() + 1}/${d.getDate()}`,
      names: dayNotice.items.map(item => item.exerciseName).join(' · '),
      minutes: dayNotice.items.reduce((sum, item) => sum + (item.plannedDuration ?? 0), 0)
    })
  }
  return out
})

const lastSame = computed(() => {
  const name = mainItem.value?.exerciseName
  if (!name) return null
  return [...store.sessions]
    .filter(s => s.exerciseName === name)
    .sort((a, b) => b.date.localeCompare(a.date))[0] ?? null
})

const recentSessions = computed(() => [...store.sessions]
  .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
  .slice(0, 8))

const nutritionLine = computed(() => {
  const n = props.nutrition
  if (!n.recordedSlots) return '今天还没记录 · 点这里去看'
  const missing = n.missing.length
    ? ` · 还缺 ${n.missing.slice(0, 2).join('、')}${n.missing.length > 2 ? ' 等' : ''}`
    : ' · 八类都出现过'
  return `${n.recordedSlots}/3 餐 · 覆盖 ${n.coverage.length}/8 类${missing}`
})

function setTab(value: string) {
  if (value === 'today' || value === 'week' || value === 'log') tab.value = value
}

function start() {
  if (!followable.value) return
  router.push({ path: '/execution', query: { exercise: followable.value.exerciseName } })
}

function weekLabel(iso: string) {
  const d = new Date(`${iso}T00:00:00`)
  return `${d.getMonth() + 1}.${d.getDate()} 周${WEEK_LABELS[(d.getDay() + 6) % 7]}`
}

function statusLabel(status: TrainingSession['completionStatus']) {
  return status === 'completed' ? '完成' : status === 'partial' ? '部分' : '跳过'
}
</script>

<style scoped>
.panel {
  display: grid;
  gap: 10px;
}

.block {
  min-width: 0;
}
.setup-line {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 9px 11px;
  border: 1px solid var(--pole-line);
  border-radius: var(--radius-lg);
  background: var(--pole-soft);
  color: var(--color-ink);
  transition: border-color var(--motion-fast);
}
.setup-line:hover {
  border-color: var(--pole-color);
}
.setup-ic {
  flex: none;
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: var(--radius-sm);
  background: var(--pole-color);
  color: var(--color-on-accent);
}
.setup-copy {
  flex: 1;
  min-width: 0;
}
.setup-copy strong {
  display: block;
  font-size: 12px;
  font-weight: 600;
}
.setup-copy small {
  display: block;
  margin-top: 1px;
  font-size: 10.5px;
  line-height: 1.45;
  color: var(--color-text-secondary);
}
.setup-line > :deep(svg) {
  flex: none;
  color: var(--pole-strong);
}
.setup-ic :deep(svg) {
  color: var(--color-on-accent);
}
.block-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 11px 14px 9px;
  border-bottom: 1px solid var(--hair-soft);
}
.head-meta {
  font-family: var(--font-num);
  font-size: 10.5px;
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.head-link {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 11px;
  font-weight: 600;
  color: var(--pole-strong);
  white-space: nowrap;
}
.head-link:hover {
  text-decoration: underline;
}

/* ——— 今日时间轴 ——— */
.steps {
  list-style: none;
  margin: 0;
  padding: 4px 14px 6px;
}
.steps li {
  position: relative;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 9px 0;
  border-bottom: 1px dashed var(--color-divider);
}
.steps li:last-child {
  border-bottom: 0;
}
.step-idx {
  flex: none;
  width: 22px;
  font-family: var(--font-num);
  font-size: 10px;
  font-weight: 600;
  color: var(--pole-strong);
  font-variant-numeric: tabular-nums;
}
.step-rail {
  flex: none;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  border: 1.4px solid var(--pole-line);
  background: var(--color-card);
}
.steps li.done .step-rail {
  background: var(--pole-color);
  border-color: var(--pole-color);
}
.step-main {
  flex: 1;
  min-width: 0;
}
.step-main strong {
  display: block;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.step-main small {
  display: block;
  margin-top: 1px;
  font-size: 11px;
  line-height: 1.45;
  color: var(--color-text-muted);
}
.step-dur {
  flex: none;
  font-family: var(--font-num);
  font-size: 11.5px;
  color: var(--color-text-secondary);
  font-variant-numeric: tabular-nums;
}
.step-dur i {
  margin-left: 2px;
  font-style: normal;
  font-size: 9.5px;
  color: var(--color-text-muted);
}

.empty {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 14px;
}
.empty-ic {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  flex: none;
  border-radius: var(--radius-sm);
  background: var(--pole-soft);
  color: var(--pole-strong);
}
.empty strong {
  display: block;
  font-size: 13px;
  color: var(--color-ink);
}
.empty p {
  margin: 4px 0 0;
  font-size: 11.5px;
  line-height: 1.65;
  color: var(--color-text-muted);
}

.metric-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-card);
  overflow: hidden;
}
.metric {
  padding: 10px 12px 11px;
  min-width: 0;
}
.metric + .metric {
  border-left: 1px solid var(--hair-soft);
}
.metric b {
  display: block;
  margin-top: 5px;
  font-family: var(--font-num);
  font-size: 25px;
  line-height: 1;
  font-weight: 600;
  color: var(--color-ink);
  letter-spacing: -0.04em;
  font-variant-numeric: tabular-nums;
}
.metric b em {
  font-style: normal;
  font-size: 13px;
  color: var(--color-text-muted);
}
.metric small {
  display: block;
  margin-top: 3px;
  font-family: var(--font-num);
  font-size: 9.5px;
  color: var(--color-text-muted);
  letter-spacing: 0.06em;
}

.up-list {
  display: grid;
  padding: 2px 14px 6px;
}
.up-row {
  display: grid;
  grid-template-columns: 58px minmax(0, 1fr) auto;
  align-items: baseline;
  gap: 9px;
  padding: 7px 0;
  border-bottom: 1px dashed var(--color-divider);
}
.up-row:last-child {
  border-bottom: 0;
}
.up-date {
  font-family: var(--font-num);
  font-size: 10.5px;
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
}
.up-name {
  font-size: 12px;
  color: var(--color-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.up-min {
  font-family: var(--font-num);
  font-size: 10.5px;
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
}

/* ——— 本周 ——— */
.week-rail {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 3px;
  padding: 9px 12px 6px;
}
.day {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 6px 2px 5px;
  border-radius: var(--radius-sm);
  border: 1px solid transparent;
  color: var(--color-text-secondary);
  transition: background var(--motion-fast), border-color var(--motion-fast);
}
.day:hover {
  background: var(--color-neutral-soft);
}
.day.on {
  background: var(--pole-soft);
  border-color: var(--pole-line);
  color: var(--pole-strong);
}
.day.today b {
  color: var(--pole-strong);
}
.day b {
  font-family: var(--font-num);
  font-size: 13px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.wd,
.day small {
  font-family: var(--font-num);
  font-size: 9.5px;
  color: var(--color-text-muted);
  letter-spacing: 0.04em;
}
.day-dots {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
  min-height: 5px;
}
.day-dots i {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--pole-line);
}
.day-dots i.done {
  background: var(--pole-color);
}
.day-dots i.rest-dot {
  background: transparent;
  box-shadow: inset 0 0 0 1px var(--hair-strong);
}

.day-detail {
  border-top: 1px solid var(--hair-soft);
  padding: 9px 14px 10px;
}
.detail-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}
.detail-head strong {
  font-size: 12.5px;
  color: var(--color-ink);
}
.detail-head span {
  font-family: var(--font-num);
  font-size: 10.5px;
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
}
.mini-items {
  list-style: none;
  margin: 5px 0 0;
  padding: 0;
}
.mini-items li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 0;
  border-bottom: 1px dashed var(--color-divider);
  flex-wrap: wrap;
}
.mini-items li:last-child {
  border-bottom: 0;
}
.mini-name {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--color-ink);
}
.mini-items small {
  font-size: 10.5px;
  color: var(--color-text-muted);
}
.mini-items em {
  margin-left: auto;
  font-style: normal;
  font-family: var(--font-num);
  font-size: 10.5px;
  color: var(--color-text-secondary);
  font-variant-numeric: tabular-nums;
}

.load-bars {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 10px 14px 2px;
}
.load-col {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  min-width: 0;
}
.load-v {
  font-family: var(--font-num);
  font-size: 9.5px;
  color: var(--color-text-secondary);
  font-variant-numeric: tabular-nums;
}
.load-track {
  display: flex;
  align-items: flex-end;
  height: 54px;
  width: 100%;
  max-width: 26px;
}
.load-track i {
  display: block;
  width: 100%;
  border-radius: 2px 2px 0 0;
  background: var(--pole-color);
}
.load-track i.none {
  background: repeating-linear-gradient(45deg, var(--hair-strong) 0 2px, transparent 2px 5px);
}
.load-d {
  font-family: var(--font-num);
  font-size: 9.5px;
  color: var(--color-text-muted);
  letter-spacing: 0.06em;
}

.split-line {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px 0;
  border-top: 1px solid var(--hair-soft);
  margin-top: 6px;
}
.split-bar {
  flex: 1;
  height: 5px;
  border-radius: 3px;
  background: repeating-linear-gradient(90deg, var(--pole-color) 0 1px, transparent 1px 3px);
  overflow: hidden;
}
.split-bar i {
  display: block;
  height: 100%;
  background: var(--pole-color);
  opacity: 0.9;
}
.split-num {
  font-family: var(--font-num);
  font-size: 9.5px;
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

/* ——— 记录 ——— */
.session-list {
  list-style: none;
  margin: 0;
  padding: 0 14px;
}
.session-list li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 0;
  border-bottom: 1px dashed var(--color-divider);
}
.session-list li:last-child {
  border-bottom: 0;
}
.s-date {
  flex: none;
  width: 62px;
  font-family: var(--font-num);
  font-size: 10px;
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
}
.s-main {
  flex: 1;
  min-width: 0;
}
.s-main strong {
  display: block;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--color-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.s-main small {
  display: block;
  margin-top: 1px;
  font-size: 10.5px;
  color: var(--color-text-muted);
}

.inline-actions {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  padding: 2px 2px 0;
}

.fine-line {
  margin: 0;
  padding: 2px 2px 0;
  font-size: 10.5px;
  line-height: 1.6;
  color: var(--color-text-muted);
}
.empty-line {
  margin: 0;
  padding: 8px 14px 12px;
  font-size: 11.5px;
  line-height: 1.65;
  color: var(--color-text-muted);
}

.head-link,
.text-action {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--pole-strong);
}
.text-action {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  min-height: 32px;
  padding: 0 4px;
  white-space: nowrap;
}
.text-action:hover,
.head-link:hover {
  text-decoration: underline;
}
.ghost-action {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 34px;
  padding: 0 11px;
  border-radius: var(--radius-base);
  border: 1px solid var(--pole-line);
  color: var(--pole-strong);
  background: var(--pole-soft);
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}

/* ——— 脚注：另一极摘要 ——— */
.foot-mark {
  flex: none;
  display: grid;
  place-items: center;
}
.foot-copy {
  flex: 1;
  min-width: 0;
}
.foot-copy .micro {
  display: block;
  color: var(--color-text-muted);
}
.foot-copy small {
  display: block;
  margin-top: 1px;
  font-size: 11px;
  color: var(--color-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.foot-btn {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  min-height: 30px;
  padding: 0 9px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--hair-strong);
  color: var(--color-text-secondary);
  font-size: 11.5px;
  font-weight: 600;
  white-space: nowrap;
  transition: border-color var(--motion-fast), color var(--motion-fast);
}
.foot-btn:hover {
  border-color: var(--pole-color);
  color: var(--pole-strong);
}

@media (max-width: 1279px) {
  .lead-copy :deep(p) { max-width: 34ch; }
}
@media (max-width: 767px) {
  .metric b { font-size: 22px; }
  .week-rail { padding: 8px 6px 4px; }
  .day b { font-size: 12px; }
  .load-bars { gap: 4px; padding-left: 8px; padding-right: 8px; }
  .block-head { padding-left: 11px; padding-right: 11px; }
  .steps { padding-left: 11px; padding-right: 11px; }
  .session-list, .up-list { padding-left: 11px; padding-right: 11px; }
  .s-date { width: 54px; }
}
</style>
