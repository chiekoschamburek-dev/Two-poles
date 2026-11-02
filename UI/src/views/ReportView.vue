<template>
  <div class="page">
    <header class="report-bar">
      <div class="bar-copy">
        <span class="micro">REPORT</span>
        <h1>记录报告</h1>
        <p>本周、近四周、本月与长期趋势；没记录不当作 0。</p>
      </div>
      <div class="report-tabs" role="tablist" aria-label="报告时间窗">
        <button
          v-for="tab in tabs"
          :id="`report-tab-${tab.id}`"
          :key="tab.id"
          type="button"
          role="tab"
          :aria-selected="active === tab.id"
          :aria-controls="`report-panel-${tab.id}`"
          :class="{ on: active === tab.id }"
          @click="selectTab(tab.id)"
        >{{ tab.label }}</button>
      </div>
    </header>

    <WeekReport v-if="active === 'week'" />
    <RollingWeeksReport v-else-if="active === 'four-weeks'" />
    <MonthReport v-else-if="active === 'month'" :initial-month="monthTarget" />
    <LongTermReport v-else-if="active === 'long-term'" @open-month="openMonth" />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import WeekReport from './WeekReport.vue'
import RollingWeeksReport from './RollingWeeksReport.vue'
import MonthReport from './MonthReport.vue'
import LongTermReport from './LongTermReport.vue'

type ReportWindow = 'week' | 'four-weeks' | 'month' | 'long-term'

const tabs: { id: ReportWindow; label: string }[] = [
  { id: 'week', label: '本周' },
  { id: 'four-weeks', label: '近四周' },
  { id: 'month', label: '本月' },
  { id: 'long-term', label: '长期' }
]
const active = ref<ReportWindow>('week')
const monthTarget = ref<string | null>(null)

function selectTab(id: ReportWindow) {
  // 手动点“本月”回到当前月；从长期图点月份时由 openMonth 指定目标月
  if (id === 'month') monthTarget.value = null
  active.value = id
}

function openMonth(month: string) {
  monthTarget.value = month
  active.value = 'month'
}
</script>

<style scoped>
.page { max-width: var(--content-max-width); margin: 0 auto; }

.report-bar {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 18px;
  padding: 16px 0 12px;
  border-bottom: 1px solid var(--color-divider);
}
.bar-copy { min-width: 0; }
.bar-copy h1 { margin: 5px 0 0; font-size: 24px; letter-spacing: -0.025em; }
.bar-copy p { margin: 5px 0 0; font-size: 12px; color: var(--color-text-muted); line-height: 1.65; }
.report-tabs { display: inline-flex; gap: 3px; padding: 3px; border-radius: 10px; background: var(--color-neutral-soft); box-shadow: inset 0 0 0 1px var(--color-border); flex: none; }
.report-tabs button {
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-secondary);
  padding: 7px 13px;
  border-radius: 8px;
  white-space: nowrap;
  transition: background var(--motion-fast), color var(--motion-fast);
}
.report-tabs button:hover { color: var(--color-ink); }
.report-tabs button.on { background: var(--color-card); color: var(--color-ink); box-shadow: 0 1px 4px rgba(21,24,27,.12), inset 0 0 0 1px var(--color-border); }

@media (max-width: 767px) {
  .report-bar { flex-direction: column; align-items: stretch; gap: 10px; padding: 13px 0 10px; }
  .bar-copy h1 { font-size: 22px; }
  .report-tabs { align-self: flex-start; max-width: 100%; overflow-x: auto; }
  .report-tabs button { padding: 6px 11px; }
}
</style>
