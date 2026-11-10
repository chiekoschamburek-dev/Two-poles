<template>
  <div class="rolling-report" role="tabpanel" id="report-panel-four-weeks" aria-labelledby="report-tab-four-weeks">
    <PeriodReport
      :report="report"
      kicker="ROLLING 4 WEEKS"
      heading="近四周"
      :sub="sub"
      quality-id="rolling-report-quality"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import PeriodReport from '@/components/reports/PeriodReport.vue'
import { useAppStore } from '@/stores/app'
import { buildRollingFourWeeksReport } from '@/services/reportRules'

const store = useAppStore()
const now = new Date()
const report = computed(() => buildRollingFourWeeksReport(
  store.sessions,
  store.meals,
  now,
  { profile: store.userProfile }
))
const md = (iso: string): string => {
  const [, m, d] = iso.split('-')
  return `${Number(m)}.${Number(d)}`
}
const sub = computed(() => `${md(report.value.start)} — ${md(report.value.end)} · 以今天为终点往前 28 天`)
</script>
