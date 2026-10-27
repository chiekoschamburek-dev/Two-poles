<template>
  <div class="page">
    <header class="lede">
      <div>
        <span class="micro kick"><i></i>Weekly report · 只统计被记录的部分</span>
        <h1>{{ rangeLabel }}<small>第 {{ weekNo }} 周</small></h1>
        <p>没记录的日子显示为「—」，不当作 0，也不当作没练。</p>
      </div>
      <div class="weeknav">
        <button aria-label="上一周" @click="shiftWeek(-1)"><ChevronLeft :size="16" /></button>
        <button class="today" @click="goToday">本周</button>
        <button aria-label="下一周" :disabled="isCurrentWeek" @click="shiftWeek(1)"><ChevronRight :size="16" /></button>
      </div>
    </header>

    <StatStrip :items="stats" />

    <p v-if="report.blockedByDiscomfort" class="safety" role="status">
      本周有训练报了不适：周报只保留事实记录，不给出加量建议。疼痛或明显不适请停止当前训练并寻求适当专业帮助。
    </p>

    <!-- 两张图：左负荷、右餐食结构 -->
    <div class="charts">
      <BaseCard variant="flush" class="chart-card">
        <div class="card-head">
          <div>
            <span class="micro">Load by day</span>
            <h2>每日负荷</h2>
          </div>
          <div class="legend">
            <span><i class="sw solid"></i>已计算</span>
            <span><i class="sw hatch"></i>缺 RPE</span>
            <span><i class="sw none"></i>未记录</span>
          </div>
        </div>

        <div class="plot" role="img" :aria-label="`每日训练负荷，${rangeLabel}`">
          <div v-for="(day, i) in dayStates" :key="day.iso" class="col">
            <span class="v" :class="{ dim: day.load === null }">{{ day.load === null ? '—' : day.load }}</span>
            <div class="bar" :class="barClass(day, i)" :style="{ height: barPx(day) + 'px' }"></div>
          </div>
        </div>
        <div class="days">
          <span v-for="(day, i) in dayStates" :key="day.iso" :class="{ today: isToday(day), planned: day.planned }">
            {{ WEEK_LABELS[i] }}<i v-if="day.planned" class="dot"></i>
          </span>
        </div>
        <p class="axis-note">圆点＝按你当前档案过滤后、该日计划应训练的日子；无档案时退回周一 / 周三 / 周五基础模板。</p>
      </BaseCard>

      <BaseCard variant="flush" class="chart-card">
        <div class="card-head">
          <div>
            <span class="micro">Meals</span>
            <h2>餐食结构</h2>
          </div>
          <span class="chip">{{ report.totalMeals ? `${report.recordedMeals} 条记录` : '未记录' }}</span>
        </div>

        <div class="matrix" role="img" aria-label="本周食物类别出现次数">
          <div v-for="c in categoryRows" :key="c.name" class="mx" :class="{ none: !c.count }">
            <span class="nm">{{ c.name }}</span>
            <span class="cells">
              <i v-for="n in 4" :key="n" :class="{ f: n <= c.level }"></i>
            </span>
            <span class="c">{{ c.count || '—' }}</span>
          </div>
        </div>
        <div v-if="missingCats.length" class="mx-foot">
          <span class="micro">本周没出现过</span>
          <span class="tags"><i v-for="c in missingCats" :key="c">{{ c }}</i></span>
        </div>
        <p class="axis-note">出现次数按记录条目累计，不代表分量或营养摄入量。</p>
      </BaseCard>
    </div>

    <!-- 账本 -->
    <BaseCard variant="flush" class="ledger-card">
      <div class="card-head">
        <div>
          <span class="micro">Sessions</span>
          <h2>本周训练记录 <em>{{ sessions.length }} 条 · 按时间</em></h2>
        </div>
        <span class="micro">RPE 为自评，空着就是不填</span>
      </div>

      <div v-if="sessions.length" class="table-wrap">
        <table>
          <thead>
            <tr><th>日期</th><th>动作</th><th>时长</th><th>次数 / 组</th><th>RPE</th><th>负荷</th><th>状态</th></tr>
          </thead>
          <tbody>
            <tr v-for="s in sessions" :key="s.id">
              <td class="d">{{ weekLabel(s.date) }}</td>
              <td class="name">{{ s.exerciseName }}</td>
              <td class="num">{{ s.actualDuration ?? '—' }} min</td>
              <td class="num">{{ s.actualReps ?? '—' }} 次 / {{ s.actualSets ?? '—' }} 组</td>
              <td class="num">{{ s.rpe ?? '—' }}</td>
              <td class="num">{{ loadOf(s) ?? '—' }}</td>
              <td>
                <StatusBadge :variant="s.completionStatus === 'completed' ? 'success' : s.completionStatus === 'partial' ? 'warning' : 'neutral'">
                  {{ statusText(s.completionStatus) }}
                </StatusBadge>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-else class="empty">
        <p>这一周还没有训练记录。负荷图保持空白，而不是画成 0。</p>
        <div class="empty-actions">
          <BaseButton size="sm" :icon="Play" @click="router.push('/execution')">去跟练</BaseButton>
          <BaseButton variant="secondary" size="sm" :icon="Utensils" @click="router.push('/meals')">记一餐</BaseButton>
        </div>
      </div>
    </BaseCard>

    <InsightCard class="quality" card-id="report-quality" eyebrow="DATA QUALITY" title="这份报告没说的三件事" tone="ink">
      <template #icon><ShieldCheck :size="20" /></template>
      <ul class="lims">
        <li v-for="q in report.dataQuality" :key="q">{{ q }}</li>
      </ul>
      <p class="ver">{{ report.ruleVersion }} · 数据只存本机浏览器（{{ store.sessions.length }} 条训练 / {{ store.meals.length }} 条餐食）</p>
    </InsightCard>

    <footer class="footnote">
      <span>负荷为自评口径（RPE × 时长），只用于自己和自己比。</span>
      <span class="micro">{{ report.ruleVersion }}</span>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { ChevronLeft, ChevronRight, Play, Utensils, ShieldCheck } from 'lucide-vue-next'
import BaseCard from '@/components/common/BaseCard.vue'
import BaseButton from '@/components/common/BaseButton.vue'
import StatusBadge from '@/components/common/StatusBadge.vue'
import StatStrip, { type StatItem } from '@/components/common/StatStrip.vue'
import InsightCard from '@/components/common/InsightCard.vue'
import { useAppStore } from '@/stores/app'
import type { TrainingSession } from '@/types/domain'
import { FOOD_CATEGORIES } from '@/services/mealRules'
import { WEEK_LABELS, buildWeeklyReport, loadOf, weekDates, weekStart } from '@/services/weekRules'
import { toISODate } from '@/utils/time'

const router = useRouter()
const store = useAppStore()

const now = new Date()
const refDate = ref(new Date(now.getFullYear(), now.getMonth(), now.getDate()))
const start = computed(() => weekStart(refDate.value))
const days = computed(() => weekDates(start.value))
const isCurrentWeek = computed(() => toISODate(weekStart(now)) === toISODate(start.value))
const todayIso = toISODate(now)

const rangeLabel = computed(() => {
  const a = days.value[0]
  const b = days.value[6]
  return `${a.getMonth() + 1}.${a.getDate()} — ${b.getMonth() + 1}.${b.getDate()}`
})
const weekNo = computed(() => {
  const t = new Date(Date.UTC(start.value.getFullYear(), start.value.getMonth(), start.value.getDate()))
  const day = t.getUTCDay() || 7
  t.setUTCDate(t.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1))
  return Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
})

const report = computed(() => buildWeeklyReport(store.sessions, store.meals, refDate.value, { profile: store.userProfile, mode: store.currentMode }))
const sessions = computed(() => {
  const iso = days.value.map(toISODate)
  return store.sessions.filter(s => iso.includes(s.date)).sort((a, b) => a.date.localeCompare(b.date))
})

/** 指标条：四格都是"这条数据说了什么 / 没说什么"，不是四个装饰色块 */
const stats = computed<StatItem[]>(() => {
  const r = report.value
  return [
    {
      label: '计划场次',
      value: r.completionRate === null ? '—' : r.plannedSessions,
      unit: r.completionRate === null ? '' : '场',
      hint: r.completionRate === null ? '这一周没有安排，不计算完成率' : '按你档案过滤后的安排'
    },
    {
      label: '有记录场次',
      value: r.completedSessions,
      unit: '场',
      hint: r.completionRate === null ? '未记录不等于没练' : `完成率 ${Math.round((r.completionRate ?? 0) * 100)}% · 未记录不计入分母`,
      tone: r.completedSessions ? 'accent' : 'default'
    },
    {
      label: '总时长',
      value: r.totalDuration,
      unit: 'min',
      hint: '来自实际记录，不含估算'
    },
    {
      label: '训练负荷',
      value: r.totalLoad === null ? '—' : r.totalLoad,
      unit: r.totalLoad === null ? '' : 'AU',
      hint: r.totalLoad === null
        ? '本周没有一条带 RPE 的记录'
        : `RPE × 时长 · 覆盖 ${r.loadDays} 天${r.unloadedDays > 0 ? `，${r.unloadedDays} 天缺 RPE 未计入` : ''}`
    }
  ]
})

interface DayState {
  iso: string
  load: number | null
  hasSession: boolean
  planned: boolean
}

const dayStates = computed<DayState[]>(() => days.value.map(d => {
  const iso = toISODate(d)
  const ofDay = store.sessions.filter(s => s.date === iso)
  const loads = ofDay.map(loadOf)
  const load = ofDay.length && loads.every(l => l !== null)
    ? loads.reduce<number>((sum, l) => sum + (l ?? 0), 0)
    : null
  return { iso, load, hasSession: ofDay.length > 0, planned: [1, 3, 5].includes(d.getDay()) }
}))

const maxLoad = computed(() => Math.max(120, ...dayStates.value.map(d => d.load ?? 0)))
const PLOT_H = 132

function barPx(day: DayState) {
  if (day.load === null) return 6
  return Math.max(8, Math.round((day.load / maxLoad.value) * PLOT_H))
}

function barClass(day: DayState, i: number) {
  return {
    zero: day.load === null && !day.hasSession,
    hatch: day.load === null && day.hasSession,
    today: dayStates.value[i].iso === todayIso && day.load === null
  }
}

const isToday = (day: DayState) => day.iso === todayIso

const categoryRows = computed(() => FOOD_CATEGORIES.slice(0, 8).map(name => {
  const count = report.value.categoryCoverage[name] ?? 0
  const max = Math.max(1, ...FOOD_CATEGORIES.slice(0, 8).map(c => report.value.categoryCoverage[c] ?? 0))
  return { name, count, level: count ? Math.max(1, Math.round((count / max) * 4)) : 0 }
}))

/** 一周里一次都没出现过的类别，比"出现过几次"更值得被看见 */
const missingCats = computed(() =>
  FOOD_CATEGORIES.slice(0, 8).filter(c => (report.value.categoryCoverage[c] ?? 0) === 0)
)

function weekLabel(iso: string) {
  const d = days.value.find(x => toISODate(x) === iso)
  if (!d) return iso.slice(5)
  return `${d.getMonth() + 1}.${d.getDate()} ${WEEK_LABELS[(d.getDay() + 6) % 7]}`
}

function statusText(status: TrainingSession['completionStatus']) {
  return status === 'completed' ? '完成' : status === 'partial' ? '部分' : '跳过'
}

function shiftWeek(step: number) {
  const next = new Date(start.value)
  next.setDate(next.getDate() + step * 7)
  refDate.value = next
}

function goToday() {
  refDate.value = new Date(now.getFullYear(), now.getMonth(), now.getDate())
}
</script>

<style scoped>
.page { max-width: var(--content-max-width); margin: 0 auto; }

/* ——— 抬头 ——— */
.lede { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; padding: 18px 0 16px; }
.kick { display: inline-flex; align-items: center; gap: 8px; }
.kick i { width: 14px; height: 1px; background: var(--color-accent); display: block; }
.lede h1 { display: flex; align-items: baseline; gap: 12px; margin: 9px 0 0; font-size: 38px; letter-spacing: -0.03em; }
.lede h1 small { font-family: var(--font-num); font-size: 12px; font-weight: 500; letter-spacing: 0.08em; color: var(--color-text-muted); }
.lede p { margin: 8px 0 0; font-size: 12.5px; color: var(--color-text-muted); }
.weeknav { display: flex; align-items: center; gap: 6px; flex: none; padding-bottom: 3px; }
.weeknav button {
  height: 34px; min-width: 34px; padding: 0 10px;
  display: grid; place-items: center;
  border-radius: var(--radius-sm);
  border: 1px solid var(--hair-strong);
  background: var(--color-card);
  color: var(--color-text-secondary);
  font-family: inherit; font-size: 12.5px; font-weight: 600;
  transition: border-color var(--motion-fast), color var(--motion-fast);
}
.weeknav button:hover:enabled { border-color: var(--color-ink); color: var(--color-ink); }
.weeknav button:disabled { opacity: 0.4; cursor: not-allowed; }
.weeknav .today { padding: 0 14px; }

.safety {
  margin: 14px 0 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--color-caution);
  background: var(--color-caution-soft);
  box-shadow: inset 3px 0 0 var(--color-caution);
  border-radius: var(--radius-sm);
  padding: 10px 12px;
}

/* ——— 图 ——— */
.charts { display: grid; grid-template-columns: 1.22fr 1fr; gap: 14px; margin-top: 14px; }
.chart-card { display: flex; flex-direction: column; }
.card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 13px 20px 0; }
.card-head h2 { margin: 5px 0 0; font-size: 16px; font-weight: 600; letter-spacing: -0.015em; }
.card-head h2 em { font-style: normal; font-size: 11.5px; font-weight: 400; color: var(--color-text-muted); margin-left: 6px; }
.chip {
  display: inline-flex; align-items: center; height: 24px; padding: 0 9px;
  border-radius: var(--radius-sm); border: 1px solid var(--color-border);
  background: var(--color-card);
  font-family: var(--font-num); font-size: 11px; font-weight: 600;
  color: var(--color-text-secondary); font-variant-numeric: tabular-nums;
}

.plot { display: flex; align-items: flex-end; gap: 12px; height: 158px; padding: 14px 20px 0; border-bottom: 1px solid var(--hair-strong); margin: 0 20px; }
.plot .col { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: 6px; min-width: 0; }
.plot .bar { width: 100%; max-width: 34px; border-radius: 2px 2px 0 0; background: linear-gradient(180deg, #12857c, #0c655e); }
/* 未记录：只描边（和悬停图例里的空框一致）；缺 RPE：斜纹；今天且还没数据：强调色描边 */
.plot .bar.zero { background: transparent; box-shadow: inset 0 0 0 1px var(--hair-strong); }
.plot .bar.hatch { background: repeating-linear-gradient(45deg, var(--color-neutral) 0 2px, transparent 2px 5px); }
.plot .bar.today { background: transparent; box-shadow: inset 0 0 0 1.4px var(--color-accent); }
.plot .v { font-family: var(--font-num); font-size: 11.5px; font-weight: 600; color: var(--color-ink); font-variant-numeric: tabular-nums; }
.plot .v.dim { color: var(--color-text-muted); font-weight: 500; }

.days { display: flex; padding: 7px 20px 0; margin: 0; }
.days span { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px; font-family: var(--font-num); font-size: 10.5px; letter-spacing: 0.1em; color: var(--color-text-muted); }
.days span.today { color: var(--color-accent); font-weight: 700; }
.days .dot { width: 4px; height: 4px; border-radius: 50%; background: var(--color-accent); display: block; }

.legend { display: flex; gap: 12px; flex-wrap: wrap; padding-top: 3px; }
.legend span { display: flex; align-items: center; gap: 5px; font-size: 10.5px; color: var(--color-text-muted); }
.sw { width: 11px; height: 9px; border-radius: 2px; display: inline-block; }
.sw.solid { background: var(--color-accent); }
.sw.hatch { background: repeating-linear-gradient(45deg, var(--color-neutral) 0 2px, transparent 2px 5px); box-shadow: inset 0 0 0 1px var(--hair-strong); }
.sw.none { box-shadow: inset 0 0 0 1px var(--hair); }

.axis-note { margin: auto 0 0; padding: 10px 20px 13px; font-size: 10.5px; line-height: 1.6; color: var(--color-text-muted); }

/* 类别矩阵：点阵比长条更适合"出现了几次"这种粗粒度 */
.matrix { display: grid; grid-template-columns: 1fr 1fr; gap: 7px 20px; padding: 14px 20px 0; }
.mx { display: grid; grid-template-columns: 46px 1fr auto; align-items: center; gap: 8px; }
.mx .nm { font-size: 12px; color: var(--color-text-secondary); }
.mx .cells { display: flex; gap: 3px; }
.mx .cells i { width: 10px; height: 10px; border-radius: 2px; box-shadow: inset 0 0 0 1.2px var(--hair-strong); }
.mx .cells i.f { background: var(--color-accent); box-shadow: none; }
.mx .c { font-family: var(--font-num); font-size: 10.5px; color: var(--color-text-muted); font-variant-numeric: tabular-nums; }
.mx.none .nm { color: var(--color-text-muted); }

.mx-foot { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 12px 20px 0; margin: auto 0 0; border-top: 1px solid var(--hair-soft); }
.mx-foot .tags { display: flex; flex-wrap: wrap; gap: 5px; }
.mx-foot .tags i { font-style: normal; font-size: 10.5px; color: var(--color-text-muted); padding: 3px 7px; border: 1px solid var(--color-border); border-radius: var(--radius-sm); }

/* ——— 账本 ——— */
.ledger-card { margin-top: 14px; }
.table-wrap { overflow-x: auto; padding: 10px 20px 4px; }
table { width: 100%; border-collapse: collapse; min-width: 720px; }
th {
  text-align: left; padding: 0 10px 8px 0;
  font-family: var(--font-num); font-size: 9.5px; font-weight: 600;
  letter-spacing: 0.16em; text-transform: uppercase;
  color: var(--color-text-muted);
  border-bottom: 1px solid var(--color-ink);
  white-space: nowrap;
}
td { padding: 9px 10px 9px 0; font-size: 12.5px; color: var(--color-text-secondary); border-bottom: 1px solid var(--hair-soft); vertical-align: middle; }
tbody tr:last-child td { border-bottom: 0; }
td.num { font-family: var(--font-num); font-variant-numeric: tabular-nums; color: var(--color-text-primary); }
td.d { font-family: var(--font-num); font-variant-numeric: tabular-nums; color: var(--color-text-muted); font-size: 11.5px; white-space: nowrap; }
td.name { color: var(--color-ink); font-weight: 500; }

.empty { padding: 16px 20px 20px; }
.empty p { margin: 0 0 14px; font-size: 12.5px; color: var(--color-text-secondary); }
.empty-actions { display: flex; gap: 10px; flex-wrap: wrap; }

.quality { margin-top: 14px; }
.lims { list-style: none; padding: 0; margin: 0; display: grid; gap: 6px; }
.lims li { position: relative; padding-left: 15px; font-size: 12px; color: var(--color-text-secondary); line-height: 1.7; }
.lims li::before { content: '·'; position: absolute; left: 2px; top: -1px; color: var(--color-accent); font-weight: 700; font-size: 16px; }
.ver { font-size: 10.5px; color: var(--color-text-muted); margin: 10px 0 0; }

.footnote { display: flex; justify-content: space-between; align-items: center; padding: 10px 2px 4px; }
.footnote span { font-size: 10.5px; color: var(--color-text-muted); }

@media (max-width: 1099px) {
  .charts { grid-template-columns: 1fr; }
}
@media (max-width: 767px) {
  .lede { flex-direction: column; align-items: stretch; gap: 12px; padding: 14px 0 12px; }
  .lede h1 { font-size: 28px; }
  .weeknav { justify-content: flex-start; }
  .plot { padding: 12px 14px 0; margin: 0 14px; gap: 8px; height: 138px; }
  .days { padding: 6px 14px 0; }
  .card-head { padding: 12px 14px 0; }
  .axis-note { padding: 9px 14px 12px; }
  .matrix { padding: 12px 14px 0; gap: 6px 12px; }
  .table-wrap { padding: 8px 14px 2px; }
  .empty { padding: 14px 14px 18px; }
}
</style>
