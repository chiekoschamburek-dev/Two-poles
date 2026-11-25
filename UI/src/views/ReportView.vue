<template>
  <div class="page">
    <PageHeader
      pole="neutral"
      label="REPORT"
      title="记录报告"
      subtitle="本周、近四周、本月与长期趋势；没记录不当作 0。"
      class="report-header"
    >
      <template #actions>
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
      </template>
    </PageHeader>

    <WeekReport v-if="active === 'week'" />
    <RollingWeeksReport v-else-if="active === 'four-weeks'" />
    <MonthReport v-else-if="active === 'month'" :initial-month="monthTarget" />
    <LongTermReport v-else-if="active === 'long-term'" @open-month="openMonth" />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import PageHeader from '@/components/common/PageHeader.vue'
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
.page { max-width: var(--page-max-width); margin: 0 auto; }

/* 页头由 PageHeader 统一负责；这里只留时间窗切换条 */
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
  .report-tabs { max-width: 100%; overflow-x: auto; }
  .report-tabs button { padding: 6px 11px; }
}
</style>
