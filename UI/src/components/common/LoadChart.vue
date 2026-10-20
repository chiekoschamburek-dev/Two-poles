<template>
  <div class="load-chart">
    <!-- 28 天柱 + 两条均线。柱高按窗口内最大值归一，未知/缺失的日子不画成 0 -->
    <svg class="plot" :viewBox="`0 0 ${W} ${H}`" role="img" :aria-label="ariaLabel">
      <!-- 首条记录之前的那一段：灰底 + 标注，避免看起来像"漏画了" -->
      <rect
        v-if="unknownBandWidth > 0"
        class="unknown-band"
        :x="PAD_L"
        :y="TOP - 8"
        :width="unknownBandWidth"
        :height="BASE - TOP + 8"
        rx="3"
      />
      <text v-if="unknownBandWidth > 40" class="unknown-label" :x="PAD_L + 7" :y="TOP + 6">尚未开始记录</text>

      <!-- 横向刻度 -->
      <g class="grid">
        <template v-for="t in ticks" :key="t.value">
          <line :x1="PAD_L" :y1="t.y" :x2="W" :y2="t.y" />
          <text x="0" :y="t.y + 3.2">{{ t.value }}</text>
        </template>
      </g>

      <!-- 每日负荷柱 -->
      <g class="bars">
        <template v-for="(b, i) in bars" :key="b.date">
          <rect
            v-if="b.height > 0"
            :x="b.x"
            :y="b.y"
            :width="b.w"
            :height="b.height"
            rx="1.5"
            :class="['bar', b.state, { today: i === bars.length - 1 }]"
          />
          <!-- 缺 RPE 的那天：画一条斜纹短柱，表示"有训练但算不出负荷" -->
          <rect
            v-else-if="b.state === 'missing'"
            :x="b.x"
            :y="BASE - 6"
            :width="b.w"
            height="6"
            rx="1.5"
            class="bar missing-only"
          />
        </template>
      </g>

      <!-- 均线：CTL 实线、ATL 虚线 -->
      <polyline v-if="ctlPath" class="line ctl" :points="ctlPath" />
      <polyline v-if="atlPath" class="line atl" :points="atlPath" />
      <line class="baseline" :x1="PAD_L" :y1="BASE" :x2="W" :y2="BASE" />
    </svg>

    <div class="legend">
      <span><i class="sw ctl"></i>CTL 28 天 <b>{{ ctl === null ? '—' : ctl }}</b></span>
      <span><i class="sw atl"></i>ATL 7 天 <b>{{ atl === null ? '—' : atl }}</b></span>
      <span><i class="sw day"></i>当日 AU</span>
    </div>

    <!-- ACWR：样本不足时不画指针，只说明还差几天 -->
    <div class="acwr">
      <div class="a-head">
        <span class="micro">Acute : Chronic</span>
        <b class="a-val" :class="zone">{{ acwr === null ? '—' : acwr.toFixed(2) }}</b>
      </div>
      <div v-if="acwr !== null" class="track" :class="zone">
        <span class="pin" :style="{ left: `${Math.min(Math.max((acwr / 2) * 100, 1), 99)}%` }"></span>
      </div>
      <div v-else class="track empty"></div>
      <div class="scale">
        <span>0.0</span><span>0.8 偏低</span><span>1.3 偏高</span><span>2.0</span>
      </div>
      <p class="a-note">{{ note }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { LoadPoint, LoadZone } from '@/services/loadRules'
import { LOAD_ZONE_TEXT } from '@/services/loadRules'

const props = defineProps<{
  points: LoadPoint[]
  ctl: number | null
  atl: number | null
  acwr: number | null
  zone: LoadZone
  daysNeeded: number
  coveredDays: number
  missingDays: number
}>()

const W = 620
const H = 150
const PAD_L = 30
const BASE = H - 16
const TOP = 14
/** 刻度固定到 120 AU，超出时按实际最大值抬一档，柱子不会顶到框 */
const MAX = computed(() => {
  const peak = Math.max(0, ...props.points.map(p => p.load ?? 0))
  return Math.max(120, Math.ceil(peak / 60) * 60)
})

const scale = (v: number) => (v / MAX.value) * (BASE - TOP)

const ticks = computed(() =>
  [0, 1, 2, 3]
    .map(k => (MAX.value / 3) * k)
    .filter(v => v > 0)
    .map(value => ({ value: Math.round(value), y: BASE - scale(value) }))
)

const barW = computed(() => (W - PAD_L) / Math.max(props.points.length, 1))

const bars = computed(() =>
  props.points.map((p, i) => {
    const h = p.load === null ? 0 : scale(p.load)
    return {
      date: p.date,
      state: p.state,
      x: PAD_L + i * barW.value + 2,
      w: Math.max(barW.value - 5, 1),
      y: BASE - h,
      height: h
    }
  })
)

function polyline(key: 'ctl' | 'atl'): string {
  // 均线只画到有值的位置；未知的日子（早于首条记录）不连线，避免伪造历史
  const vals = props.points.map(p => (p.state === 'unknown' ? null : p.load ?? 0))
  const pts: string[] = []
  let sum = 0
  const window = key === 'ctl' ? vals.length : 7
  vals.forEach((v, i) => {
    if (v === null) return
    sum += v
    const slice = vals.slice(Math.max(0, i - window + 1), i + 1).filter(x => x !== null) as number[]
    const avg = slice.length ? slice.reduce((a, b) => a + b, 0) / slice.length : 0
    if (avg > 0) pts.push(`${(PAD_L + i * barW.value + barW.value / 2).toFixed(1)},${(BASE - scale(avg)).toFixed(1)}`)
  })
  return pts.join(' ')
}

const ctlPath = computed(() => polyline('ctl'))
const atlPath = computed(() => polyline('atl'))

/** 首条记录在第几根柱：它左边整段都是"还没开始用"，单独铺一层灰底 */
const firstKnownIndex = computed(() => props.points.findIndex(p => p.state !== 'unknown'))
const unknownBandWidth = computed(() =>
  firstKnownIndex.value > 0 ? firstKnownIndex.value * barW.value : 0
)

const note = computed(() => {
  if (props.acwr === null) {
    return `样本不足：已积累 ${props.coveredDays} 天，还需要 ${props.daysNeeded} 天才能计算负荷比。`
  }
  const tail = props.missingDays ? ` 另有 ${props.missingDays} 天缺 RPE，已从窗口剔除。` : ''
  return `${LOAD_ZONE_TEXT[props.zone]}。${tail}`
})

const ariaLabel = computed(() => {
  const days = props.points.length
  const total = props.points.reduce((s, p) => s + (p.load ?? 0), 0)
  return `近 ${days} 天每日负荷，合计 ${total} AU；` +
    (props.acwr === null ? `负荷比样本不足，还需 ${props.daysNeeded} 天` : `急慢性负荷比 ${props.acwr}`)
})
</script>

<style scoped>
.load-chart { display: flex; flex-direction: column; }
.plot { display: block; width: 100%; height: auto; flex: none; }

.grid line { stroke: rgba(17, 22, 26, 0.07); stroke-width: 1; }
.grid text {
  font-family: var(--font-num);
  font-size: 9px;
  fill: var(--color-text-muted);
}

.bar { fill: rgba(17, 22, 26, 0.16); }
.bar.today { fill: var(--color-accent); }
.bar.missing { fill: none; }
.bar.missing-only { fill: rgba(138, 90, 0, 0.35); }

.line { fill: none; stroke-linejoin: round; stroke-linecap: round; }
.line.ctl { stroke: var(--color-accent); stroke-width: 2.2; }
.line.atl { stroke: var(--color-caution); stroke-width: 1.4; stroke-dasharray: 3 3; }
.baseline { stroke: rgba(17, 22, 26, 0.18); stroke-width: 1; }
.unknown-band { fill: rgba(17, 22, 26, 0.035); stroke: rgba(17, 22, 26, 0.06); stroke-dasharray: 2 4; }
.unknown-label {
  font-family: var(--font-family);
  font-size: 9.5px;
  letter-spacing: 0.08em;
  fill: var(--color-text-muted);
}

.legend { display: flex; gap: 16px; padding: 8px 0 4px; }
.legend span { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; color: var(--color-text-muted); }
.legend b { font-family: var(--font-num); font-weight: 600; color: var(--color-ink); }
.legend .sw { width: 14px; height: 3px; border-radius: 2px; display: block; }
.legend .sw.ctl { background: var(--color-accent); }
.legend .sw.atl { background: var(--color-caution); }
.legend .sw.day { background: rgba(17, 22, 26, 0.16); }

.acwr { border-top: 1px solid var(--color-divider); padding-top: 10px; margin-top: 4px; }
.a-head { display: flex; align-items: baseline; justify-content: space-between; }
.a-val {
  font-family: var(--font-num);
  font-size: 26px;
  font-weight: 600;
  letter-spacing: -0.03em;
  font-variant-numeric: tabular-nums;
  color: var(--color-ink);
}
.a-val.low { color: var(--color-caution); }
.a-val.optimal { color: var(--color-accent); }
.a-val.high { color: var(--color-caution); }
.a-val.veryHigh { color: var(--color-danger); }

.track {
  position: relative;
  height: 9px;
  border-radius: 5px;
  margin-top: 8px;
  background: linear-gradient(
    90deg,
    var(--color-divider) 0 40%,
    var(--color-accent-soft) 40% 65%,
    var(--color-caution-soft, #f6ecd8) 65% 75%,
    var(--color-danger-soft) 75%
  );
}
.track.empty { background: var(--color-divider); }
.track .pin {
  position: absolute;
  top: -4px;
  width: 2.5px;
  height: 17px;
  border-radius: 2px;
  background: var(--color-ink);
  transform: translateX(-50%);
}
.track .pin::after {
  content: '';
  position: absolute;
  left: 50%;
  top: -4px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--color-ink);
  transform: translateX(-50%);
}
.scale {
  display: flex;
  justify-content: space-between;
  margin-top: 5px;
  font-family: var(--font-num);
  font-size: 9.5px;
  letter-spacing: 0.1em;
  color: var(--color-text-muted);
}
.a-note { margin: 7px 0 0; font-size: 11.5px; line-height: 1.55; color: var(--color-text-muted); }
</style>
