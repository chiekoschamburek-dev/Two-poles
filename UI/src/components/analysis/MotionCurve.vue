<template>
  <div class="curve">
    <svg
      class="plot"
      :class="{ interactive }"
      :viewBox="`0 0 ${W} ${H}`"
      role="img"
      :aria-label="ariaLabel"
      @click="onPlotClick"
    >
      <line class="base" :x1="PAD" :y1="H - AXIS" :x2="W - PAD" :y2="H - AXIS" />

      <g v-if="zeroY !== null">
        <line class="zero" :x1="PAD" :y1="zeroY" :x2="W - PAD" :y2="zeroY" />
        <text class="axis-label" :x="PAD - 4" :y="zeroY + 3" text-anchor="end">0</text>
      </g>
      <text class="axis-label" :x="PAD - 4" :y="y(maxValue) + 3" text-anchor="end">{{ formatAxis(maxValue) }}</text>
      <text class="axis-label" :x="PAD - 4" :y="y(minValue) + 3" text-anchor="end">{{ formatAxis(minValue) }}</text>

      <!-- 缺失或遮挡帧断线；绝不补 0，也不跨缺口连线 -->
      <polyline v-for="seg in segments" :key="seg.key" class="line" :points="seg.points" />

      <g v-for="marker in markers" :key="marker.key">
        <line class="marker-line" :x1="x(marker.timeMs)" :y1="PAD - 6" :x2="x(marker.timeMs)" :y2="H - AXIS" />
        <circle
          v-if="marker.value !== null"
          class="marker-dot"
          :cx="x(marker.timeMs)"
          :cy="y(marker.value)"
          r="4"
        />
      </g>

      <circle v-if="hover" class="hover-dot" :cx="x(hover.timeMs)" :cy="y(hover.value)" r="3.6" />
      <text v-if="hover" class="dot-label" :x="x(hover.timeMs)" :y="y(hover.value) - 8" text-anchor="middle">
        {{ formatValue(hover.value) }}{{ unit }}
      </text>
    </svg>

    <p class="axis-note">{{ note }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'

const props = withDefaults(defineProps<{
  points: { timeMs: number; value: number | null }[]
  unit: string
  title: string
  fps: number
  markerTimes?: number[]
  /** 固定纵轴；不传则按数据自动，zeroLine 时强制包含 0 */
  domain?: [number, number] | null
  zeroLine?: boolean
  digits?: number
  interactive?: boolean
}>(), {
  markerTimes: () => [],
  domain: null,
  zeroLine: false,
  digits: 1,
  interactive: true
})

const emit = defineEmits<{ seek: [timeMs: number] }>()

const W = 620
const H = 170
const PAD = 40
const AXIS = 20

const validPoints = computed(() => props.points.filter(
  (point): point is { timeMs: number; value: number } => point.value !== null && Number.isFinite(point.value)
))

const bounds = computed(() => {
  if (props.domain) return { min: props.domain[0], max: props.domain[1] }
  const values = validPoints.value.map(point => point.value)
  if (!values.length) return { min: -1, max: 1 }
  let min = Math.min(...values)
  let max = Math.max(...values)
  if (props.zeroLine) {
    min = Math.min(min, 0)
    max = Math.max(max, 0)
  }
  if (min === max) {
    min -= 1
    max += 1
  }
  const padding = (max - min) * 0.08
  return { min: min - padding, max: max + padding }
})

const minValue = computed(() => bounds.value.min)
const maxValue = computed(() => bounds.value.max)

const span = computed(() => {
  if (!props.points.length) return { start: 0, end: 1 }
  let start = Infinity
  let end = -Infinity
  for (const point of props.points) {
    if (!Number.isFinite(point.timeMs)) continue
    if (point.timeMs < start) start = point.timeMs
    if (point.timeMs > end) end = point.timeMs
  }
  return Number.isFinite(start) && Number.isFinite(end) && end > start ? { start, end } : { start: 0, end: 1 }
})

const x = (timeMs: number) => {
  const { start, end } = span.value
  return PAD + ((timeMs - start) / (end - start)) * (W - PAD * 2)
}

const y = (value: number) => {
  const { min, max } = bounds.value
  const clamped = Math.max(min, Math.min(max, value))
  return H - AXIS - ((clamped - min) / (max - min)) * (H - AXIS - PAD)
}

const zeroY = computed(() => {
  if (!props.zeroLine) return null
  const { min, max } = bounds.value
  return min <= 0 && max >= 0 ? y(0) : null
})

const maxGapMs = computed(() => Math.max(60, (1000 / Math.max(1, props.fps)) * 2))

const segments = computed(() => {
  const out: { key: string; points: string }[] = []
  let current: { timeMs: number; value: number }[] = []
  const flush = () => {
    if (current.length > 1) {
      out.push({
        key: `seg-${out.length}`,
        points: current.map(point => `${x(point.timeMs).toFixed(1)},${y(point.value).toFixed(1)}`).join(' ')
      })
    }
    current = []
  }
  for (const point of props.points) {
    if (!Number.isFinite(point.timeMs) || point.value === null || !Number.isFinite(point.value)) {
      flush()
      continue
    }
    const previous = current[current.length - 1]
    if (previous && point.timeMs - previous.timeMs > maxGapMs.value) flush()
    current.push({ timeMs: point.timeMs, value: point.value })
  }
  flush()
  return out
})

const markers = computed(() => props.markerTimes
  .filter(timeMs => timeMs >= span.value.start && timeMs <= span.value.end)
  .map((timeMs, index) => {
    const nearest = validPoints.value.reduce<{ timeMs: number; value: number } | null>((best, point) =>
      Math.abs(point.timeMs - timeMs) < Math.abs((best?.timeMs ?? Infinity) - timeMs) ? point : best, null)
    return { key: `m-${index}`, timeMs, value: nearest?.value ?? null }
  }))

const hover = ref<{ timeMs: number; value: number } | null>(null)
watch(() => props.points, () => { hover.value = null })

const formatValue = (value: number) => value.toFixed(Math.max(0, props.digits))
const formatAxis = (value: number) => value.toFixed(Math.max(0, props.digits))

const ariaLabel = computed(() =>
  `${props.title}，共 ${validPoints.value.length} 个有效采样，单位 ${props.unit}`)

const note = computed(() => {
  const base = `纵轴 ${props.unit}，横轴视频时间；缺失或遮挡区间断开不连线，不补 0。`
  return props.interactive ? `${base}点击曲线可定位到对应时刻。` : base
})

function onPlotClick(event: MouseEvent) {
  if (!props.interactive || !validPoints.value.length) return
  const target = event.currentTarget as SVGSVGElement
  const rect = target.getBoundingClientRect()
  if (!rect.width) return
  const svgX = ((event.clientX - rect.left) / rect.width) * W
  const nearest = validPoints.value.reduce<{ timeMs: number; value: number } | null>((best, point) =>
    Math.abs(x(point.timeMs) - svgX) < Math.abs(x(best?.timeMs ?? 0) - svgX) ? point : best, null)
  if (!nearest) return
  hover.value = nearest
  emit('seek', nearest.timeMs)
}
</script>

<style scoped>
.curve { padding: 2px 0 0; }
.plot { display: block; width: 100%; height: auto; }
.plot.interactive { cursor: crosshair; }
.base { stroke: var(--hair-strong); stroke-width: 1; }
.zero { stroke: var(--hair-strong); stroke-width: 1; stroke-dasharray: 3 3; opacity: .8; }
.axis-label { font-family: var(--font-num); font-size: 8.5px; fill: var(--color-text-muted); }
.line { fill: none; stroke: var(--pole-movement); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.marker-line { stroke: var(--color-caution); stroke-width: 1; stroke-dasharray: 2 3; opacity: .7; }
.marker-dot { fill: var(--color-caution); stroke: var(--color-card); stroke-width: 1.5; }
.hover-dot { fill: var(--color-ink); stroke: var(--color-card); stroke-width: 1.5; }
.dot-label { font-family: var(--font-num); font-size: 9.5px; font-weight: 600; fill: var(--color-ink); font-variant-numeric: tabular-nums; }
.axis-note { margin: 8px 0 0; font-size: 10.5px; line-height: 1.7; color: var(--color-text-muted); }
</style>