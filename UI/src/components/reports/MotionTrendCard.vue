<template>
  <BaseCard variant="flush" class="trend-card">
    <div class="card-head">
      <span class="micro">MOTION TREND</span>
      <h3>{{ label }} · 长期变化</h3>
      <em>{{ trend.totalSamples }} 次记录</em>
      <span class="chip" :class="{ warn: !trend.enoughSamples }">
        {{ trend.enoughSamples ? '可比较' : '样本不足' }}
      </span>
    </div>

    <svg class="plot" :viewBox="`0 0 ${W} ${H}`" role="img" :aria-label="ariaLabel">
      <line class="base" :x1="PAD" :y1="H - AXIS" :x2="W - PAD" :y2="H - AXIS" />
      <!-- 每个 ruleVersion 一段，跨版本断线：口径变了不画成连续趋势 -->
      <g v-for="(seg, segIndex) in trend.segments" :key="seg.ruleVersion + segIndex">
        <polyline v-if="seg.points.length > 1" class="line" :points="linePoints(seg.points)" />
        <circle
          v-for="point in seg.points"
          :key="point.id"
          class="dot"
          :class="{ low: point.lowConfidence }"
          :cx="x(point.date)"
          :cy="y(point.findingCount)"
          r="3.6"
        />
      </g>
      <text class="axis-label" :x="PAD - 4" :y="y(maxCount) + 3" text-anchor="end">{{ maxCount }}</text>
      <text class="axis-label" :x="PAD - 4" :y="y(0) + 3" text-anchor="end">0</text>
    </svg>

    <dl v-if="trend.latestChange" class="delta">
      <div>
        <dt>同口径内关注项变化</dt>
        <dd>{{ signed(trend.latestChange.findingCountDelta) }}</dd>
      </div>
      <div v-if="trend.latestChange.repCountDelta !== null">
        <dt>识别次数变化</dt>
        <dd>{{ signed(trend.latestChange.repCountDelta) }}</dd>
      </div>
    </dl>

    <p v-if="trend.caveat" class="axis-note">{{ trend.caveat }}</p>
    <p class="axis-note">
      纵轴为每次分析命中的关注项条数，不是评分。条数减少可能来自动作改善，也可能来自拍摄质量或规则口径变化；
      低置信度记录以空心点标出。不能据此判断损伤风险。
    </p>
  </BaseCard>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import BaseCard from '@/components/common/BaseCard.vue'
import type { ActionTrend, TrendPoint } from '@/services/motionTrends'
import type { AnalysisAction } from '@/types/domain'

const props = defineProps<{ trend: ActionTrend }>()

const W = 620
const H = 120
const PAD = 28
const AXIS = 20

const LABEL: Record<AnalysisAction, string> = { squat: '深蹲', deadlift: '硬拉', running: '跑姿' }
const label = computed(() => LABEL[props.trend.action])

const allPoints = computed(() => props.trend.segments.flatMap(seg => seg.points))
const maxCount = computed(() => Math.max(1, ...allPoints.value.map(point => point.findingCount)))
const dates = computed(() => allPoints.value.map(point => point.date).sort())

const x = (date: string) => {
  const list = dates.value
  if (list.length < 2) return W / 2
  const index = list.indexOf(date)
  return PAD + (index / (list.length - 1)) * (W - PAD * 2)
}
const y = (count: number) => H - AXIS - (count / maxCount.value) * (H - AXIS - PAD)

const linePoints = (points: TrendPoint[]) =>
  points.map(point => `${x(point.date).toFixed(1)},${y(point.findingCount).toFixed(1)}`).join(' ')

const signed = (value: number) => value > 0 ? `+${value}` : String(value)

const ariaLabel = computed(() =>
  `${label.value}长期变化，共 ${props.trend.totalSamples} 次记录，分 ${props.trend.segments.length} 个规则口径段`)
</script>

<style scoped>
.trend-card { padding: 14px 16px 12px; }
.card-head { display: flex; align-items: baseline; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; }
.micro { font-family: var(--font-num); font-size: 8.5px; font-weight: 600; letter-spacing: var(--tracking-eyebrow); color: var(--pole-movement-strong); }
.card-head h3 { margin: 0; font-size: 16px; font-weight: 600; letter-spacing: -.01em; }
.card-head em { font-style: normal; font-family: var(--font-num); font-size: 10px; color: var(--color-text-muted); }
.chip { margin-left: auto; padding: 2px 8px; border: 1px solid var(--pole-movement-line); border-radius: 999px; background: var(--pole-movement-soft); font-family: var(--font-num); font-size: 9px; font-weight: 600; color: var(--pole-movement-strong); }
.chip.warn { border-color: var(--color-caution); background: var(--color-caution-soft); color: var(--color-caution); }
.plot { display: block; width: 100%; height: auto; }
.base { stroke: var(--hair-strong); stroke-width: 1; }
.axis-label { font-family: var(--font-num); font-size: 8.5px; fill: var(--color-text-muted); }
.line { fill: none; stroke: var(--pole-movement); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.dot { fill: var(--pole-movement); stroke: var(--color-card); stroke-width: 1.5; }
.dot.low { fill: var(--color-card); stroke: var(--color-caution); }
.delta { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin: 10px 0 0; }
.delta div { padding: 8px 10px; border-radius: var(--radius-md); background: var(--color-neutral-soft); }
.delta dt { font-size: 10.5px; color: var(--color-text-muted); }
.delta dd { margin: 3px 0 0; font-family: var(--font-num); font-size: 16px; font-weight: 700; font-variant-numeric: tabular-nums; }
.axis-note { margin: 8px 0 0; font-size: 10.5px; line-height: 1.7; color: var(--color-text-muted); }

@media (max-width: 767px) {
  .trend-card { padding: 12px 13px 10px; }
  .card-head h3 { font-size: 15px; }
}
</style>