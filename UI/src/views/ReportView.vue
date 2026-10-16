<template>
  <div class="page-wrap">
    <div class="page-head animate-slide-in-up">
      <div>
        <span class="eyebrow">WEEKLY REPORT</span>
        <h1>{{ rangeLabel }}</h1>
        <p>只统计你记录过的内容；没记录显示"未记录"，不当成 0，也不当成没做。</p>
      </div>
      <div class="weeknav">
        <button aria-label="上一周" @click="shiftWeek(-1)"><ChevronLeft :size="18" /></button>
        <button class="today" @click="goToday">本周</button>
        <button aria-label="下一周" :disabled="isCurrentWeek" @click="shiftWeek(1)"><ChevronRight :size="18" /></button>
      </div>
    </div>

    <div class="kpis">
      <MetricCard label="计划场次" :value="report.plannedSessions" hint="按本周期的安排" :icon="CalendarDays" />
      <MetricCard class="animate-slide-in-up" style="animation-delay:70ms" label="有记录场次" :value="report.completedSessions" hint="未记录不等于没练" :icon="CheckCircle2" accent="blue" />
      <MetricCard class="animate-slide-in-up" style="animation-delay:140ms" label="总时长" :value="report.totalDuration + ' min'" hint="来自实际记录" :icon="Clock3" accent="purple" />
      <MetricCard class="animate-slide-in-up" style="animation-delay:210ms" label="训练负荷合计" :value="report.totalLoad === null ? '未记录' : String(report.totalLoad)" :hint="report.totalLoad === null ? '缺少 RPE，暂不可算' : 'Σ 时长 × RPE'" :icon="Flame" accent="orange" />
    </div>

    <div class="grid">
      <BaseCard class="chart-card animate-slide-in-up" style="animation-delay:260ms">
        <div class="card-head">
          <div><span class="eyebrow">LOAD BY DAY</span><h3>每日负荷</h3></div>
          <div class="legend">
            <span><i class="sw solid"></i>已计算</span>
            <span><i class="sw hatch"></i>缺 RPE</span>
            <span><i class="sw none"></i>未记录</span>
          </div>
        </div>
        <svg viewBox="0 0 340 150" class="chart" role="img" :aria-label="`每日训练负荷条形图，${rangeLabel}`">
          <defs>
            <pattern id="hatch" width="7" height="7" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
              <line x1="0" y1="0" x2="0" y2="7" stroke="var(--color-neutral)" stroke-width="4" />
            </pattern>
            <linearGradient id="loadBar" x1="0" y1="1" x2="0" y2="0">
              <stop offset="0" stop-color="var(--color-accent)" />
              <stop offset="1" stop-color="var(--color-accent)" />
            </linearGradient>
          </defs>
          <line x1="8" y1="118" x2="332" y2="118" stroke="var(--color-border)" stroke-width="1.5" />
          <g v-for="(day, i) in dayStates" :key="day.iso">
            <rect
              :x="i * 47 + 12"
              :y="barTop(day)"
              :width="34"
              :height="barHeight(day)"
              :fill="barFill(day)"
              :rx="day.load === null ? 4 : 6"
            />
            <text :x="i * 47 + 29" y="134" class="lbl">{{ WEEK_LABELS[i] }}</text>
            <text v-if="day.load !== null" :x="i * 47 + 29" :y="barTop(day) - 6" class="val">{{ day.load }}</text>
            <circle v-if="day.planned" :cx="i * 47 + 29" cy="145" r="2.5" fill="var(--color-accent-strong)" />
          </g>
        </svg>
        <p class="axis-note">蓝点＝该日按计划应训练（周一 / 周三 / 周五的安排）。</p>
      </BaseCard>

      <BaseCard class="animate-slide-in-up" style="animation-delay:320ms">
        <div class="card-head"><div><span class="eyebrow">MEALS</span><h3>餐食结构</h3></div><StatusBadge :variant="report.totalMeals ? 'info' : 'neutral'">{{ report.totalMeals ? `${report.recordedMeals} 条记录` : '未记录' }}</StatusBadge></div>
        <svg viewBox="0 0 340 190" class="chart" role="img" aria-label="本周食物类别出现次数条形图">
          <g v-for="(c, i) in categoryRows" :key="c.name">
            <text x="4" :y="i * 23 + 13" class="cat">{{ c.name }}</text>
            <rect :x="64" :y="i * 23 + 3" width="200" height="12" rx="6" fill="var(--color-neutral-soft)" />
            <rect :x="64" :y="i * 23 + 3" :width="c.width" height="12" rx="6" :fill="c.count ? 'url(#loadBar)' : 'var(--color-neutral-soft)'" />
            <text :x="270" :y="i * 23 + 13" class="val left">{{ c.count || '—' }}</text>
          </g>
        </svg>
        <p class="axis-note">出现次数按记录条目累计，不代表分量或营养摄入量。</p>
      </BaseCard>
    </div>

    <BaseCard class="sessions animate-slide-in-up" style="animation-delay:380ms">
      <div class="card-head"><div><span class="eyebrow">SESSIONS</span><h3>本周训练记录</h3></div></div>
      <table v-if="sessions.length">
        <thead><tr><th>日期</th><th>动作</th><th>时长</th><th>次数 / 组</th><th>RPE</th><th>负荷</th><th>状态</th></tr></thead>
        <tbody>
          <tr v-for="s in sessions" :key="s.id">
            <td>{{ s.date.slice(5) }}</td>
            <td class="name">{{ s.exerciseName }}</td>
            <td>{{ s.actualDuration ?? '—' }} min</td>
            <td>{{ s.actualReps ?? '—' }} 次 / {{ s.actualSets ?? '—' }} 组</td>
            <td><span v-if="s.rpe !== null">{{ s.rpe }}</span><span v-else class="miss">未记录</span></td>
            <td><span v-if="loadOf(s) !== null">{{ loadOf(s) }}</span><span v-else class="miss">—</span></td>
            <td><StatusBadge :variant="s.completionStatus === 'completed' ? 'success' : s.completionStatus === 'partial' ? 'warning' : 'neutral'">{{ statusText(s.completionStatus) }}</StatusBadge></td>
          </tr>
        </tbody>
      </table>
      <div v-else class="empty">
        <p>这一周还没有训练记录。负荷图保持空白，而不是画成 0。</p>
        <div class="empty-actions">
          <BaseButton size="sm" :icon="Play" @click="router.push('/execution')">去跟练</BaseButton>
          <BaseButton variant="secondary" size="sm" :icon="Utensils" @click="router.push('/meals')">记一餐</BaseButton>
        </div>
      </div>
    </BaseCard>

    <BaseCard class="quality animate-slide-in-up" style="animation-delay:430ms">
      <div class="why">
        <div class="why-icon"><ShieldCheck :size="20" /></div>
        <div>
          <span class="eyebrow">DATA QUALITY</span>
          <h3>这份报告没说的三件事</h3>
          <ul class="lims">
            <li v-for="q in report.dataQuality" :key="q">{{ q }}</li>
          </ul>
          <p class="ver">{{ report.ruleVersion }} · 数据只存本机浏览器（{{ store.sessions.length }} 条训练 / {{ store.meals.length }} 条餐食）</p>
        </div>
      </div>
    </BaseCard>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import {
  ChevronLeft, ChevronRight, CalendarDays, CheckCircle2, Clock3, Flame, Play, Utensils, ShieldCheck
} from 'lucide-vue-next'
import BaseCard from '@/components/common/BaseCard.vue'
import BaseButton from '@/components/common/BaseButton.vue'
import StatusBadge from '@/components/common/StatusBadge.vue'
import MetricCard from '@/components/common/MetricCard.vue'
import { useAppStore } from '@/stores/app'
import type { TrainingSession } from '@/types/domain'
import { FOOD_CATEGORIES } from '@/services/mealRules'
import { WEEK_LABELS, buildWeeklyReport, loadOf, weekDates, weekStart } from '@/services/weekRules'
import { shortDate, toISODate } from '@/utils/time'

const router = useRouter()
const store = useAppStore()

const now = new Date()
const refDate = ref(new Date(now.getFullYear(), now.getMonth(), now.getDate()))
const start = computed(() => weekStart(refDate.value))
const days = computed(() => weekDates(start.value))
const isCurrentWeek = computed(() => toISODate(weekStart(now)) === toISODate(start.value))
const rangeLabel = computed(() => `${shortDate(days.value[0])} – ${days.value[6].getMonth() + 1}/${days.value[6].getDate()}`)

const report = computed(() => buildWeeklyReport(store.sessions, store.meals, refDate.value))
const sessions = computed(() => {
  const iso = days.value.map(toISODate)
  return store.sessions.filter(s => iso.includes(s.date)).sort((a, b) => a.date.localeCompare(b.date))
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
  return {
    iso,
    load,
    hasSession: ofDay.length > 0,
    planned: [1, 3, 5].includes(d.getDay())
  }
}))

const maxLoad = computed(() => Math.max(120, ...dayStates.value.map(d => d.load ?? 0)))
const PLOT_TOP = 26
const PLOT_BOTTOM = 118

function barTop(day: DayState) {
  if (day.load === null) return PLOT_BOTTOM - 14
  return PLOT_BOTTOM - Math.max(8, ((day.load / maxLoad.value) * (PLOT_BOTTOM - PLOT_TOP)))
}

function barHeight(day: DayState) {
  return PLOT_BOTTOM - barTop(day)
}

function barFill(day: DayState) {
  if (day.load !== null) return 'url(#loadBar)'
  return day.hasSession ? 'url(#hatch)' : 'var(--color-neutral-soft)'
}

const categoryRows = computed(() => {
  const counts = FOOD_CATEGORIES.slice(0, 8).map(name => ({ name, count: report.value.categoryCoverage[name] ?? 0 }))
  const max = Math.max(1, ...counts.map(c => c.count))
  return counts.map(c => ({ ...c, width: c.count ? Math.max(6, (c.count / max) * 200) : 0 }))
})

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
.page-wrap{max-width:var(--content-max-width);margin:auto}
.page-head{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;margin-bottom:20px}
.eyebrow{display:inline-flex;align-items:center;font-size:11px;letter-spacing:var(--tracking-eyebrow);color:var(--color-accent);font-weight:700}.eyebrow::before{content:'';width:6px;height:6px;border-radius:2px;background:var(--color-accent);transform:rotate(45deg);margin-right:8px}
.page-head h1{font-size:27px;margin:9px 0 8px;color:var(--color-ink)}
.page-head p{color:var(--color-text-secondary);font-size:13px;margin:0;max-width:640px;line-height:1.7}
.weeknav{display:flex;align-items:center;gap:6px;flex:none}
.weeknav button{width:36px;height:36px;border-radius:11px;color:var(--color-text-secondary);background:rgba(255,255,255,.9);border:1px solid rgba(220,229,237,.85);display:grid;place-items:center;box-shadow:var(--inner-light);transition:all var(--motion-fast) var(--easing-ease-out)}
.weeknav button:hover:enabled{background:linear-gradient(150deg,var(--color-accent-soft),var(--color-neutral-soft));color:var(--color-accent);box-shadow:var(--inner-light),var(--ring-accent);transform:translateY(-1px)}
.weeknav button:disabled{opacity:.4;cursor:not-allowed}
.weeknav .today{width:auto;padding:0 16px;font-size:13px;font-weight:600}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:18px}
.grid{display:grid;grid-template-columns:1.05fr 1fr;gap:16px;margin-bottom:16px}
.card-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:12px}
.card-head h3{font-size:17px;margin-top:6px}
.chart{width:100%;height:auto;display:block}
.chart .lbl{font-size:11px;fill:var(--color-text-muted);text-anchor:middle}
.chart .val{font-size:11px;fill:var(--color-ink);text-anchor:middle;font-weight:700}
.chart .val.left{text-anchor:start;fill:var(--color-text-secondary)}
.chart .cat{font-size:11px;fill:var(--color-text-secondary)}
.axis-note{font-size:11px;color:var(--color-text-muted);margin:8px 0 0;line-height:1.6}
.legend{display:flex;gap:12px;flex-wrap:wrap}
.legend span{display:flex;align-items:center;gap:5px;font-size:11px;color:var(--color-text-secondary)}
.sw{width:12px;height:10px;border-radius:3px;display:inline-block}
.sw.solid{background:var(--color-accent)}
.sw.hatch{background:repeating-linear-gradient(45deg,var(--color-neutral-soft),var(--color-neutral-soft) 2px,var(--color-neutral) 2px,var(--color-neutral) 4px)}
.sw.none{background:var(--color-neutral-soft);border:1px solid var(--color-border)}
.sessions table{width:100%;border-collapse:collapse}
.sessions th{text-align:left;font-size:11px;color:var(--color-text-muted);font-weight:600;padding:0 8px 8px;border-bottom:1px solid var(--color-divider)}
.sessions td{font-size:13px;color:var(--color-text-secondary);padding:10px 8px;border-bottom:1px solid var(--color-divider);font-variant-numeric:tabular-nums}
.sessions tbody tr:nth-child(even){background:var(--color-neutral-soft)}
.sessions tbody tr{transition:background var(--motion-fast)}
.sessions tbody tr:hover{background:linear-gradient(90deg,var(--color-accent-soft),var(--color-neutral-soft))}
.sessions td.name{color:var(--color-ink);font-weight:600}
.sessions tr:last-child td{border-bottom:0}
.miss{color:var(--color-caution);background:var(--color-caution-soft);padding:3px 9px;border-radius:999px;font-size:11px;font-weight:600;box-shadow:inset 0 0 0 1px rgba(215,165,75,.3)}
.empty{padding:18px 0 6px}
.empty p{font-size:13px;color:var(--color-text-secondary);margin:0 0 14px}
.empty-actions{display:flex;gap:10px}
.empty-actions :deep(button){width:auto;padding:0 20px}
.quality .why{display:flex;gap:16px;align-items:flex-start}
.why-icon{width:40px;height:40px;flex:none;display:grid;place-items:center;border-radius:13px;color:white;background:var(--color-ink);box-shadow:0 10px 22px -12px rgba(21,24,27,.6),inset 0 1px 0 rgba(255,255,255,.28)}
.quality h3{font-size:16px;margin:5px 0 8px}
.lims{list-style:none;padding:0;margin:0;display:grid;gap:6px}
.lims li{position:relative;padding-left:16px;font-size:12px;color:var(--color-text-secondary);line-height:1.7}
.lims li::before{content:'·';position:absolute;left:2px;color:var(--color-accent);font-weight:700;font-size:16px}
.ver{font-size:11px;color:var(--color-text-muted);margin:10px 0 0}
@media(max-width:1100px){.kpis{grid-template-columns:repeat(2,1fr)}.grid{grid-template-columns:1fr}}
@media(max-width:767px){.page-head{align-items:flex-start;flex-direction:column}.kpis{gap:10px}.sessions :deep(table){font-size:12px}}
</style>
