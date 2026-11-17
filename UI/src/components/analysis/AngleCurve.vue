<template>
  <BaseCard variant="flush" class="curve-card">
    <div class="card-head">
      <span class="micro">ANGLE CURVE</span>
      <h3>{{ title }}</h3>
      <em>{{ points.length }} 帧 · {{ fps }} fps</em>
      <span v-if="markers.length" class="chip">{{ markers.length }} 个关注时刻</span>
    </div>

    <svg
      class="plot"
      :viewBox="`0 0 ${W} ${H}`"
      role="img"
      :aria-label="ariaLabel"
      @click="onPlotClick"
    >
      <line class="base" :x1="PAD" :y1="H - AXIS" :x2="W - PAD" :y2="H - AXIS" />
      <line class="grid" :x1="PAD" :y1="y(180)" :x2="W - PAD" :y2="y(180)" />
      <text class="axis-label" :x="PAD - 4" :y="y(180) + 3" text-anchor="end">180°</text>
      <text class="axis-label" :x="PAD - 4" :y="y(60) + 3" text-anchor="end">60°</text>

      <!-- 缺失/遮挡帧断线，绝不补 0 也不跨缺口连线 -->
      <polyline v-for="seg in segments" :key="seg.key" class="line" :points="seg.points" />

      <g v-for="marker in markers" :key="marker.key">
        <line class="marker-line" :x1="x(marker.timeMs)" :y1="PAD - 6" :x2="x(marker.timeMs)" :y2="H - AXIS" />
        <circle
          class="marker-dot"
          :cx="x(marker.timeMs)"
          :cy="marker.angle === null ? H - AXIS : y(marker.angle)"
          r="4"
        />
      </g>

      <circle v-if="hover" class="hover-dot" :cx="x(hover.timeMs)" :cy="y(hover.angle)" r="3.6" />
      <text v-if="hover" class="dot-label" :x="x(hover.timeMs)" :y="y(hover.angle) - 8" text-anchor="middle">
        {{ hover.angle }}°
      </text>
    </svg>

    <p class="axis-note">{{ note }}</p>
  </BaseCard>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import BaseCard from '@/components/common/BaseCard.vue'
import type { MotionAngleSample } from '@/types/domain'

const props = withDefaults(defineProps<{
  samples: MotionAngleSample[]
  joint: 'knee' | 'hip' | 'trunk'
  fps: number
  /** 关注项时刻，画竖线与点，点击可跳转 */
  markerTimes?: number[]
  title?: string
}>(), {
  markerTimes: () => [],
  title: '关节角度曲线'
})

const emit = defineEmits<{ seek: [timeMs: number] }>()

const W = 620
const H = 160
const PAD = 28
const AXIS = 20
const MIN_ANGLE = 60
const MAX_ANGLE = 180

const readAngle = (sample: MotionAngleSample): number | null =>
  props.joint === 'hip' ? sample.hipAngle : props.joint === 'trunk' ? sample.trunkAngle : sample.kneeAngle

const points = computed(() => props.samples
  .map(sample => ({ timeMs: sample.timeMs, angle: readAngle(sample) }))
  .filter((point): point is { timeMs: number; angle: number } => point.angle !== null))

const span = computed(() => {
  const times = props.samples.map(sample => sample.timeMs)
  if (!times.length) return { start: 0, end: 1 }
  return { start: Math.min(...times), end: Math.max(...times) }
})

const x = (timeMs: number) => {
  const { start, end } = span.value
  const ratio = end > start ? (timeMs - start) / (end - start) : 0
  return PAD + ratio * (W - PAD * 2)
}
const y = (angle: number) => {
  const clamped = Math.max(MIN_ANGLE, Math.min(MAX_ANGLE, angle))
  const ratio = (clamped - MIN_ANGLE) / (MAX_ANGLE - MIN_ANGLE)
  return H - AXIS - ratio * (H - AXIS - PAD)
}

/** 相邻采样间隔超过 2 帧就断开：遮挡段不画成连续动作 */
const segments = computed(() => {
  const maxGap = (1000 / Math.max(1, props.fps)) * 2
  const out: { key: string; points: string }[] = []
  let current: { timeMs: number; angle: number }[] = []
  const flush = () => {
    if (current.length > 1) {
      out.push({ key: `seg-${out.length}`, points: current.map(p => `${x(p.timeMs).toFixed(1)},${y(p.angle).toFixed(1)}`).join(' ') })
    }
    current = []
  }
  for (const point of points.value) {
    const previous = current[current.length - 1]
    if (previous && point.timeMs - previous.timeMs > maxGap) flush()
    current.push(point)
  }
  flush()
  return out
})

const markers = computed(() => props.markerTimes.map((timeMs, index) => {
  const nearest = points.value.reduce<{ timeMs: number; angle: number } | null>((best, point) =>
    Math.abs(point.timeMs - timeMs) < Math.abs((best?.timeMs ?? Infinity) - timeMs) ? point : best, null)
  return { key: `m-${index}`, timeMs, angle: nearest?.angle ?? null }
}))

const hover = ref<{ timeMs: number; angle: number } | null>(null)

function onPlotClick(event: MouseEvent) {
  const target = event.currentTarget as SVGSVGElement
  const rect = target.getBoundingClientRect()
  const ratio = (event.clientX - rect.left) / rect.width
  const svgX = ratio * W
  const nearest = points.value.reduce<{ timeMs: number; angle: number } | null>((best, point) =>
    Math.abs(x(point.timeMs) - svgX) < Math.abs(x(best?.timeMs ?? 0) - svgX) ? point : best, null)
  if (!nearest) return
  hover.value = nearest
  emit('seek', nearest.timeMs)
}

const jointLabel = computed(() => props.joint === 'hip' ? '髋' : props.joint === 'trunk' ? '躯干' : '膝')
const ariaLabel = computed(() =>
  `${jointLabel.value}关节角度随时间变化，共 ${points.value.length} 个有效采样，${markers.value.length} 个关注时刻`)
const note = computed(() =>
  `纵轴为${jointLabel.value}角（60°–180°），横轴为视频时间。关键点缺失或遮挡的区间断开不连线，不补 0。`
  + '角度由单目姿态估计推算，存在透视与遮挡误差，不能据此判断关节负荷或损伤风险。点击曲线可定位到对应时刻。')
</script>

<style scoped>
.curve-card { padding: 14px 16px 12px; }
.card-head { display: flex; align-items: baseline; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; }
.micro { font-family: var(--font-num); font-size: 8.5px; font-weight: 600; letter-spacing: var(--tracking-eyebrow); color: var(--pole-movement-strong); }
.card-head h3 { margin: 0; font-size: 16px; font-weight: 600; letter-spacing: -.01em; }
.card-head em { font-style: normal; font-family: var(--font-num); font-size: 10px; color: var(--color-text-muted); }
.chip { margin-left: auto; padding: 2px 8px; border: 1px solid var(--pole-movement-line); border-radius: 999px; background: var(--pole-movement-soft); font-family: var(--font-num); font-size: 9px; font-weight: 600; color: var(--pole-movement-strong); }
.plot { display: block; width: 100%; height: auto; cursor: crosshair; }
.base { stroke: var(--hair-strong); stroke-width: 1; }
.grid { stroke: var(--hair-soft); stroke-width: 1; stroke-dasharray: 3 3; }
.axis-label { font-family: var(--font-num); font-size: 8.5px; fill: var(--color-text-muted); }
.line { fill: none; stroke: var(--pole-movement); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.marker-line { stroke: var(--color-caution); stroke-width: 1; stroke-dasharray: 2 3; opacity: .7; }
.marker-dot { fill: var(--color-caution); stroke: var(--color-card); stroke-width: 1.5; }
.hover-dot { fill: var(--color-ink); stroke: var(--color-card); stroke-width: 1.5; }
.dot-label { font-family: var(--font-num); font-size: 9.5px; font-weight: 600; fill: var(--color-ink); font-variant-numeric: tabular-nums; }
.axis-note { margin: 8px 0 0; font-size: 10.5px; line-height: 1.7; color: var(--color-text-muted); }

@media (max-width: 767px) {
  .curve-card { padding: 12px 13px 10px; }
  .card-head h3 { font-size: 15px; }
}
</style>