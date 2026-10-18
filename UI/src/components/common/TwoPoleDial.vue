<template>
  <div
    class="dial"
    :class="tone"
    :style="{ '--dial-size': size + 'px' }"
    :role="ariaLabel ? 'img' : undefined"
    :aria-label="ariaLabel || undefined"
  >
    <svg viewBox="0 0 220 220" aria-hidden="true">
      <g v-if="showTicks" class="ticks" stroke-width="1">
        <line v-for="(t, i) in tickLines" :key="i" :x1="t.x1" :y1="t.y1" :x2="t.x2" :y2="t.y2" />
      </g>

      <!-- 轨道：两段各 144°，上端留 12° 的口子 -->
      <path class="track" :d="trackA" />
      <path class="track" :d="trackB" />

      <!-- 右弧 = 训练（顺时针），左弧 = 饮食（逆时针） -->
      <path class="pole-a" :d="arcTraining" />
      <path class="pole-b" :d="arcMeal" />

      <!-- 两极锚点：两弧终止处就是"两仪"的落点 -->
      <circle class="anchor-a" :cx="anchorA[0]" :cy="anchorA[1]" r="4" />
      <circle class="anchor-b" :cx="anchorB[0]" :cy="anchorB[1]" r="4" />

      <circle v-if="showInnerRing" class="inner" cx="110" cy="110" r="64" />
    </svg>

    <div class="center"><slot /></div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    /** 训练达成 0–1（右弧，顺时针） */
    training: number
    /** 饮食达成 0–1（左弧，逆时针） */
    meal: number
    /** 环的直径（px）；窄屏可以直接改 --dial-size 覆盖 */
    size?: number
    /** ink = 深色仪表面板；paper = 浅色卡片 */
    tone?: 'ink' | 'paper'
    showTicks?: boolean
    showInnerRing?: boolean
    /** 给读屏软件的一句话；不传就当装饰 */
    ariaLabel?: string
  }>(),
  { size: 228, tone: 'ink', showTicks: true, showInnerRing: true, ariaLabel: '' }
)

const R = 90
const C = 110

/** 角度按"从 12 点顺时针"计 */
function polar(deg: number, r = R): [number, number] {
  const rad = (deg * Math.PI) / 180
  return [C + r * Math.sin(rad), C - r * Math.cos(rad)]
}

function arc(pct: number, side: 'a' | 'b'): string {
  const p = Number.isFinite(pct) ? Math.max(0, Math.min(1, pct)) : 0
  const from = side === 'a' ? 6 : 354
  const sweep = 144 * p
  const to = side === 'a' ? from + sweep : from - sweep
  const [x1, y1] = polar(from)
  const [x2, y2] = polar(to)
  const flag = side === 'a' ? 1 : 0
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${R} ${R} 0 ${sweep > 180 ? 1 : 0} ${flag} ${x2.toFixed(2)} ${y2.toFixed(2)}`
}

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0)

const arcTraining = computed(() => arc(props.training, 'a'))
const arcMeal = computed(() => arc(props.meal, 'b'))
const trackA = arc(1, 'a')
const trackB = arc(1, 'b')
const anchorA = computed(() => polar(6 + 144 * clamp01(props.training)))
const anchorB = computed(() => polar(354 - 144 * clamp01(props.meal)))

/** 12 个刻度：够"仪表"，又不至于在 130px 的小尺寸上糊成一片 */
const tickLines = Array.from({ length: 12 }, (_, i) => {
  const [x1, y1] = polar(i * 30, 99)
  const [x2, y2] = polar(i * 30, 105)
  return { x1, y1, x2, y2 }
})
</script>

<style scoped>
.dial {
  position: relative;
  width: var(--dial-size, 228px);
  height: var(--dial-size, 228px);
  flex: none;
}
.dial svg {
  display: block;
  width: 100%;
  height: 100%;
  overflow: visible;
}
.center {
  position: absolute;
  inset: 0;
  display: grid;
  place-content: center;
  text-align: center;
}

.track { fill: none; stroke-width: 9; stroke-linecap: round; }
.pole-a, .pole-b { fill: none; stroke-width: 9; stroke-linecap: round; }
.inner { fill: none; stroke-width: 1; }

/* ink：深底上两极提亮一档，否则读不出形状 */
.ink .track { stroke: rgba(255, 255, 255, 0.1); }
.ink .ticks { stroke: rgba(255, 255, 255, 0.16); }
.ink .pole-a { stroke: var(--brand-pole-a-dark); }
.ink .pole-b { stroke: var(--brand-pole-b-dark); }
.ink .inner { stroke: rgba(255, 255, 255, 0.07); }
.ink .anchor-a { fill: #0d1114; stroke: var(--brand-pole-a-dark); stroke-width: 2; }
.ink .anchor-b { fill: #0d1114; stroke: var(--brand-pole-b-dark); stroke-width: 2; }

/* paper：浅底保持原始品牌色，不为了对比度提亮 */
.paper .track { stroke: var(--color-border); }
.paper .ticks { stroke: var(--hair-strong); }
.paper .pole-a { stroke: var(--brand-pole-a); }
.paper .pole-b { stroke: var(--brand-pole-b); }
.paper .inner { stroke: var(--color-divider); }
.paper .anchor-a { fill: var(--color-card); stroke: var(--brand-pole-a); stroke-width: 2; }
.paper .anchor-b { fill: var(--color-card); stroke: var(--brand-pole-b); stroke-width: 2; }
</style>
