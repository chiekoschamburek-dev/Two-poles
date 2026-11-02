<template>
  <div class="month-report" role="tabpanel" id="report-panel-month" aria-labelledby="report-tab-month">
    <div class="month-nav">
      <button type="button" aria-label="上一月" @click="shiftMonth(-1)"><ChevronLeft :size="16" /></button>
      <button type="button" class="current" @click="goCurrent">本月</button>
      <button type="button" aria-label="下一月" :disabled="!canForward" @click="shiftMonth(1)"><ChevronRight :size="16" /></button>
      <span class="month-range">{{ monthLabel }}</span>
    </div>
    <PeriodReport
      :report="report"
      kicker="MONTHLY REPORT"
      :heading="monthLabel"
      :sub="sub"
      quality-id="month-report-quality"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { ChevronLeft, ChevronRight } from 'lucide-vue-next'
import PeriodReport from '@/components/reports/PeriodReport.vue'
import { useAppStore } from '@/stores/app'
import { buildMonthlyReport } from '@/services/reportRules'

const props = defineProps<{ initialMonth?: string | null }>()
const store = useAppStore()
const now = new Date()
const requested = props.initialMonth ? new Date(`${props.initialMonth}T00:00:00`) : now
const base = Number.isNaN(requested.getTime()) ? now : requested
const refDate = ref(new Date(base.getFullYear(), base.getMonth(), 1))
const monthLabel = computed(() => `${refDate.value.getFullYear()} 年 ${refDate.value.getMonth() + 1} 月`)
const isCurrent = computed(() => refDate.value.getFullYear() === now.getFullYear() && refDate.value.getMonth() === now.getMonth())
const canForward = computed(() => !isCurrent.value)
const report = computed(() => buildMonthlyReport(
  store.sessions,
  store.meals,
  refDate.value,
  { profile: store.userProfile, mode: store.currentMode },
  now
))
const md = (iso: string): string => {
  const [, m, d] = iso.split('-')
  return `${Number(m)}.${Number(d)}`
}
const sub = computed(() => {
  const base = `${md(report.value.start)} — ${md(report.value.end)}`
  return isCurrent.value ? `${base} · 截至 ${now.getMonth() + 1} 月 ${now.getDate()} 日` : base
})

function shiftMonth(step: number) {
  const next = new Date(refDate.value.getFullYear(), refDate.value.getMonth() + step, 1)
  if (next > new Date(now.getFullYear(), now.getMonth(), 1)) return
  refDate.value = next
}
function goCurrent() {
  refDate.value = new Date(now.getFullYear(), now.getMonth(), 1)
}
</script>

<style scoped>
.month-nav { display: flex; align-items: center; gap: 6px; padding: 16px 0 0; }
.month-nav button {
  height: 32px;
  min-width: 32px;
  padding: 0 10px;
  display: grid;
  place-items: center;
  border-radius: var(--radius-sm);
  border: 1px solid var(--hair-strong);
  background: var(--color-card);
  color: var(--color-text-secondary);
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  transition: border-color var(--motion-fast), color var(--motion-fast);
}
.month-nav button:hover:enabled { border-color: var(--color-ink); color: var(--color-ink); }
.month-nav button:disabled { opacity: 0.4; cursor: not-allowed; }
.month-nav .current { padding: 0 13px; }
.month-range { margin-left: 4px; font-family: var(--font-num); font-size: 11.5px; color: var(--color-text-muted); }
@media (max-width: 767px) {
  .month-nav { padding-top: 12px; }
  .month-range { font-size: 11px; }
}
</style>
