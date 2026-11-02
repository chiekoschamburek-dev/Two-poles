<template>
  <div class="long-report" role="tabpanel" id="report-panel-long-term" aria-labelledby="report-tab-long-term">
    <header class="period-head">
      <div>
        <span class="micro kick"><i></i>LONG-TERM TREND</span>
        <h2>长期趋势</h2>
        <p>最近 6 个自然月，按月聚合；当前月统计到今天，没记录的月份不画成 0。</p>
      </div>
    </header>

    <BaseCard variant="flush" class="lt-card">
      <div class="card-head">
        <div>
          <span class="micro">TREND</span>
          <h3>负荷与训练天数 <em>按月 · 仅训练</em></h3>
        </div>
        <span class="chip">{{ points.length }} 个月</span>
      </div>

      <div class="lt-section">
        <div class="lt-row-label">训练负荷 <small>AU · 斜纹表示该月缺 RPE，只累计可计算部分</small></div>
        <div class="lt-plot" role="img" aria-label="最近 6 个月训练负荷">
          <div v-for="p in points" :key="p.month" class="lt-col">
            <span class="lt-v" :class="{ dim: p.load === null }">
              {{ p.load === null ? '—' : p.load }}<i v-if="p.loadCompleteness === 'incomplete'">*</i>
            </span>
            <div class="lt-bar" :class="barClass(p)" :style="{ height: barPx(p) + 'px' }"></div>
          </div>
        </div>
      </div>

      <div class="lt-section">
        <div class="lt-row-label">有记录训练天数 <small>没有训练的月份不画点，不按 0 连接</small></div>
        <svg class="lt-line" :viewBox="`0 0 ${W} ${H}`" role="img" aria-label="最近 6 个月有记录训练天数">
          <line class="base" :x1="PAD" :y1="H - 20" :x2="W - PAD" :y2="H - 20" />
          <polyline v-for="seg in segments" :key="seg.key" class="line" :points="seg.points" />
          <template v-for="(p, i) in points" :key="`dot-${p.month}`">
            <template v-if="p.hasSession">
              <circle :cx="x(i)" :cy="y(p.trainingDays)" r="3.6" class="dot" />
              <text :x="x(i)" :y="y(p.trainingDays) - 9" text-anchor="middle" class="dot-label">{{ p.trainingDays }}</text>
            </template>
          </template>
        </svg>
      </div>

      <div class="lt-labels">
        <button
          v-for="p in points"
          :key="p.month"
          type="button"
          :aria-label="`查看 ${p.label} 月报`"
          @click="emit('openMonth', p.month)"
        >{{ p.label }}<i v-if="p.partialMonth">*</i></button>
      </div>

      <div class="lt-notes">
        <p>* 当前月统计到今天；斜纹柱表示该月有训练但缺 RPE，柱高只累计可计算部分，不是完整总量。</p>
        <p>没有记录的月份留空；有记录训练天数只统计有训练记录的天数，未记录不等于没训练。</p>
      </div>
    </BaseCard>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import BaseCard from '@/components/common/BaseCard.vue'
import { useAppStore } from '@/stores/app'
import { buildLongTermTrend } from '@/services/reportRules'
import type { LongTermPoint } from '@/services/reportRules'

const emit = defineEmits<{ (e: 'openMonth', month: string): void }>()
const store = useAppStore()
const now = new Date()
const points = computed(() => buildLongTermTrend(store.sessions, now, 6))
const maxLoad = computed(() => Math.max(120, ...points.value.map(p => p.load ?? 0)))
const PLOT_H = 132
function barPx(p: LongTermPoint): number {
  if (p.load === null) return 6
  return Math.max(8, Math.round((p.load / maxLoad.value) * PLOT_H))
}
function barClass(p: LongTermPoint) {
  return {
    zero: p.loadCompleteness === 'none',
    hatch: p.loadCompleteness === 'incomplete'
  }
}

const W = 620
const H = 88
const PAD = 24
const maxDays = computed(() => Math.max(7, ...points.value.map(p => p.trainingDays)))
const x = (i: number): number => PAD + (i * (W - PAD * 2)) / Math.max(points.value.length - 1, 1)
const y = (days: number): number => H - 20 - (days / maxDays.value) * (H - 38)

const segments = computed(() => {
  const out: { key: string; points: string }[] = []
  let current: string[] = []
  let start = 0
  points.value.forEach((p, i) => {
    if (p.hasSession) {
      if (!current.length) start = i
      current.push(`${x(i)},${y(p.trainingDays)}`)
    } else if (current.length) {
      out.push({ key: `${start}-${i - 1}`, points: current.join(' ') })
      current = []
    }
  })
  if (current.length) out.push({ key: `${start}-${points.value.length - 1}`, points: current.join(' ') })
  return out
})
</script>

<style scoped>
.period-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 18px; padding: 18px 0 14px; }
.kick { display: inline-flex; align-items: center; gap: 8px; }
.kick i { width: 14px; height: 1px; background: var(--color-accent); display: block; }
.period-head h2 { margin: 8px 0 0; font-size: 32px; letter-spacing: -0.03em; }
.period-head p { margin: 7px 0 0; font-size: 12.5px; color: var(--color-text-muted); line-height: 1.6; }
.lt-card { margin-top: 0; }
.card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 13px 20px 4px; }
.card-head h3 { margin: 5px 0 0; font-size: 16px; font-weight: 600; letter-spacing: -0.015em; }
.card-head h3 em { font-style: normal; font-size: 11.5px; font-weight: 400; color: var(--color-text-muted); margin-left: 6px; }
.chip { display: inline-flex; align-items: center; height: 24px; padding: 0 9px; border-radius: var(--radius-sm); border: 1px solid var(--color-border); background: var(--color-card); font-family: var(--font-num); font-size: 11px; font-weight: 600; color: var(--color-text-secondary); font-variant-numeric: tabular-nums; }
.lt-section { padding: 14px 20px 0; }
.lt-row-label { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; font-size: 12px; font-weight: 600; color: var(--color-ink); }
.lt-row-label small { font-size: 10.5px; font-weight: 400; color: var(--color-text-muted); }
.lt-plot { display: flex; align-items: flex-end; gap: 12px; height: 158px; padding: 10px 0 0; border-bottom: 1px solid var(--hair-strong); }
.lt-col { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: 6px; min-width: 0; }
.lt-bar { width: 100%; max-width: 52px; border-radius: 2px 2px 0 0; background: linear-gradient(180deg, #12857c, #0c655e); }
.lt-bar.zero { background: transparent; box-shadow: inset 0 0 0 1px var(--hair-strong); }
.lt-bar.hatch { background: repeating-linear-gradient(45deg, var(--color-neutral) 0 2px, transparent 2px 5px); box-shadow: inset 0 0 0 1px var(--hair-strong); }
.lt-v { font-family: var(--font-num); font-size: 11.5px; font-weight: 600; color: var(--color-ink); font-variant-numeric: tabular-nums; }
.lt-v.dim { color: var(--color-text-muted); font-weight: 500; }
.lt-v i { font-style: normal; color: var(--color-caution); margin-left: 2px; }
.lt-line { display: block; width: 100%; height: auto; margin-top: 10px; }
.lt-line .base { stroke: var(--hair-strong); stroke-width: 1; }
.lt-line .line { fill: none; stroke: var(--color-accent); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.lt-line .dot { fill: var(--color-accent); stroke: var(--color-card); stroke-width: 1.5; }
.lt-line .dot-label { font-family: var(--font-num); font-size: 9.5px; font-weight: 600; fill: var(--color-text-secondary); }
.lt-labels { display: flex; padding: 7px 20px 0; }
.lt-labels button {
  flex: 1;
  min-height: 28px;
  padding: 3px 0;
  border-radius: var(--radius-sm);
  font-family: var(--font-num);
  font-size: 10.5px;
  color: var(--color-text-muted);
  white-space: nowrap;
  transition: color var(--motion-fast), background var(--motion-fast);
}
.lt-labels button:hover { color: var(--color-accent); background: var(--color-accent-soft); }
.lt-labels button i { font-style: normal; color: var(--color-caution); margin-left: 1px; }
.lt-notes { padding: 12px 20px 16px; display: grid; gap: 5px; }
.lt-notes p { margin: 0; font-size: 10.5px; line-height: 1.65; color: var(--color-text-muted); }
@media (max-width: 767px) {
  .period-head { padding: 14px 0 12px; }
  .period-head h2 { font-size: 28px; }
  .card-head { padding: 12px 14px 2px; }
  .lt-section { padding: 12px 14px 0; }
  .lt-plot { gap: 8px; height: 138px; }
  .lt-labels { padding: 6px 14px 0; }
  .lt-labels button { font-size: 10px; }
  .lt-notes { padding: 10px 14px 14px; }
}
</style>
