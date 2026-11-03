<template>
  <svg class="training-figure" :class="{ obscured: phase === 'occluded' }" viewBox="0 0 560 760" role="img" :aria-label="description">
    <defs>
      <linearGradient id="trainer-shirt" x1="0" y1="0" x2="1" y2=".7">
        <stop stop-color="#b5d6cd" /><stop offset="1" stop-color="#5b9990" />
      </linearGradient>
      <linearGradient id="trainer-skin" x1="0" y1="0" x2="1" y2=".6">
        <stop stop-color="#f2c7a4" /><stop offset="1" stop-color="#d99b78" />
      </linearGradient>
      <linearGradient id="trainer-pants" x1="0" y1="0" x2="1" y2="1">
        <stop stop-color="#485564" /><stop offset="1" stop-color="#293442" />
      </linearGradient>
    </defs>

    <ellipse cx="286" cy="705" :rx="112 - motion * (kind === 'calf' ? 8 : 0)" ry="10" fill="#080f13" opacity=".38" />
    <path d="M163 699 H401" class="floor-line" />

    <!-- 远侧肢体先画；每一节直接共享关节点，动画中也不会脱节。 -->
    <g class="far-side">
      <path :d="limb(body.farHip, body.farKnee, 25, 19)" fill="url(#trainer-pants)" />
      <path :d="limb(body.farKnee, body.farAnkle, 19, 12)" fill="url(#trainer-pants)" />
      <path :d="shoe(body.farAnkle, 1)" fill="#a3b0b8" />
      <path :d="sole(body.farAnkle, 1)" class="shoe-sole" />
      <path :d="limb(body.farShoulder, body.farElbow, 19, 14)" fill="url(#trainer-skin)" />
      <path :d="limb(body.farShoulder, sleeveEnd(body.farShoulder, body.farElbow), 22, 18)" fill="url(#trainer-shirt)" />
    </g>

    <!-- 裤腿画在腰部下方，避免大腿的圆端盖住衣摆。 -->
    <path :d="limb(body.nearHip, body.nearKnee, 28, 20)" fill="url(#trainer-pants)" />
    <path :d="limb(body.nearKnee, body.nearAnkle, 20, 13)" fill="url(#trainer-pants)" />
    <path :d="`M${body.nearHip.x - 10} ${body.nearHip.y + 13} Q${body.nearKnee.x - 11} ${body.nearKnee.y} ${body.nearAnkle.x - 5} ${body.nearAnkle.y - 17}`" class="pants-seam" />
    <path :d="shoe(body.nearAnkle, 0)" fill="#dce6e6" />
    <path :d="sole(body.nearAnkle, 0)" class="shoe-sole" />
    <path :d="`M${body.nearAnkle.x + 5} ${body.nearAnkle.y + 4} l12 4 m-7 -10 l12 4`" class="laces" />

    <!-- 腰胯把躯干与双腿连起来，衣摆随躯干移动。 -->
    <path :d="shorts" fill="url(#trainer-pants)" />
    <path :d="shirt" fill="url(#trainer-shirt)" />
    <path :d="shirtSeam" class="shirt-seam" />
    <path :d="collar" fill="none" stroke="#427970" stroke-width="8" stroke-linecap="round" />
    <path :d="limb(body.neck, body.head, 14, 16)" fill="url(#trainer-skin)" />

    <g :transform="`translate(${body.head.x} ${body.head.y}) rotate(${body.lean * .3})`">
      <ellipse cx="0" cy="0" rx="30" ry="38" fill="url(#trainer-skin)" />
      <ellipse cx="-28" cy="3" rx="6" ry="9" fill="#dca17f" />
      <path d="M-29 -2 C-36 -34 -17 -46 6 -41 C27 -43 36 -24 29 -9 L23 -21 C10 -16 -2 -20 -9 -26 C-15 -12 -22 -7 -29 -2 Z" fill="#28343c" />
      <path d="M23 0 L32 9 Q32 12 25 12" fill="#dfaa87" />
      <path d="M0 -5 Q5 -8 10 -5 M19 -6 L24 -5" class="brow" />
      <circle cx="6" cy="1" r="2.2" fill="#33404a" />
      <circle cx="23" cy="1" r="2" fill="#33404a" />
      <path d="M10 21 Q17 25 23 20" class="smile" />
    </g>

    <!-- 弯举时远侧前臂也在胸前，不能被衣服整段遮住。 -->
    <g class="far-side">
      <path :d="limb(body.farElbow, body.farWrist, 14, 10)" fill="url(#trainer-skin)" />
      <ellipse :cx="body.farWrist.x" :cy="body.farWrist.y + 6" rx="12" ry="16" fill="url(#trainer-skin)" :transform="handRotation(body.farElbow, body.farWrist)" />
      <g v-if="kind === 'elbow'" :transform="weightTransform(body.farWrist)">
        <path d="M-25 0 H25" class="weight-bar" />
        <rect x="-29" y="-17" width="13" height="34" rx="4" class="weight" />
        <rect x="16" y="-17" width="13" height="34" rx="4" class="weight" />
      </g>
    </g>

    <path :d="limb(body.nearShoulder, body.nearElbow, 20, 16)" fill="url(#trainer-skin)" />
    <path :d="limb(body.nearShoulder, sleeveEnd(body.nearShoulder, body.nearElbow), 24, 19)" fill="url(#trainer-shirt)" />
    <path :d="limb(body.nearElbow, body.nearWrist, 16, 10)" fill="url(#trainer-skin)" />
    <path :d="cuff" class="cuff" />
    <ellipse :cx="body.nearWrist.x" :cy="body.nearWrist.y + 6" rx="12" ry="17" fill="url(#trainer-skin)" :transform="handRotation(body.nearElbow, body.nearWrist)" />
    <g v-if="kind === 'elbow'" :transform="weightTransform(body.nearWrist)">
      <path d="M-25 0 H25" class="weight-bar" />
      <rect x="-29" y="-17" width="13" height="34" rx="4" class="weight" />
      <rect x="16" y="-17" width="13" height="34" rx="4" class="weight" />
    </g>

    <!-- 只标记当前动作相关的关节，避免满身骨线盖住动作。 -->
    <g class="motion-guide" aria-hidden="true">
      <template v-if="kind === 'knee'">
        <path :d="`M${body.nearHip.x} ${body.nearHip.y} L${body.nearKnee.x} ${body.nearKnee.y} L${body.nearAnkle.x} ${body.nearAnkle.y}`" />
        <circle :cx="body.nearKnee.x" :cy="body.nearKnee.y" r="6" />
      </template>
      <template v-else-if="kind === 'elbow'">
        <path :d="`M${body.nearShoulder.x} ${body.nearShoulder.y} L${body.nearElbow.x} ${body.nearElbow.y} L${body.nearWrist.x} ${body.nearWrist.y}`" />
        <circle :cx="body.nearElbow.x" :cy="body.nearElbow.y" r="6" />
      </template>
      <circle v-else-if="kind === 'shoulder'" :cx="body.nearShoulder.x" :cy="body.nearShoulder.y" r="7" />
      <circle v-else :cx="body.nearAnkle.x" :cy="body.nearAnkle.y" r="6" />
    </g>
  </svg>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { FigureKind } from '@/services/demoCameraService'

const props = defineProps<{ kind: FigureKind; phase: string }>()
type Point = { x: number; y: number }
const point = (x: number, y: number): Point => ({ x, y })
const motion = ref(0)
let animation = 0

// 暂停、休息、遮挡时保留当前姿势；动作切换从当前插值继续。
watch(() => [props.kind, props.phase] as const, ([kind, phase], previous) => {
  cancelAnimationFrame(animation)
  if (previous && kind !== previous[0]) motion.value = 0
  if (['held', 'occluded'].includes(phase)) return
  const target = (kind === 'knee' || kind === 'elbow') ? Number(phase === 'down') : Number(phase === 'up')
  const start = motion.value
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    motion.value = target
    return
  }
  const startedAt = performance.now()
  const frame = (now: number) => {
    const t = Math.min((now - startedAt) / 560, 1)
    motion.value = start + (target - start) * (t * t * (3 - 2 * t))
    if (t < 1) animation = requestAnimationFrame(frame)
  }
  animation = requestAnimationFrame(frame)
}, { immediate: true })
onBeforeUnmount(() => cancelAnimationFrame(animation))

function endpoint(origin: Point, length: number, degrees: number): Point {
  const angle = degrees * Math.PI / 180
  return point(origin.x + Math.sin(angle) * length, origin.y + Math.cos(angle) * length)
}

// 两段腿用固定长度求膝盖位置：髋部下沉时折膝，脚踝始终落在同一位置。
function knee(hip: Point, ankle: Point): Point {
  const upper = 134, lower = 134
  const dx = ankle.x - hip.x, dy = ankle.y - hip.y
  const distance = Math.hypot(dx, dy)
  const along = (upper * upper - lower * lower + distance * distance) / (2 * distance)
  const height = Math.sqrt(Math.max(0, upper * upper - along * along))
  return point(hip.x + dx * along / distance + dy * height / distance,
    hip.y + dy * along / distance - dx * height / distance)
}

const body = computed(() => {
  const squat = props.kind === 'knee' ? motion.value : 0
  const lift = props.kind === 'calf' ? motion.value * 16 : 0
  const lean = squat * 16
  const hip = point(280 - squat * 48, 413 + squat * 88 - lift)
  const chest = endpoint(hip, 196, 180 - lean)
  const nearShoulder = point(chest.x - 35, chest.y + 3)
  const farShoulder = point(chest.x + 33, chest.y - 4)
  const nearHip = point(hip.x - 25, hip.y)
  const farHip = point(hip.x + 27, hip.y - 4)
  const nearAnkle = point(238, 679 - lift)
  const farAnkle = point(326, 675 - lift)
  const curl = props.kind === 'elbow' ? motion.value : 0
  const shoulder = props.kind === 'shoulder' ? motion.value : 0
  const nearUpper = -14 + curl * 5 + squat * 75 - shoulder * 151
  const farUpper = 13 - curl * 4 + squat * 48 + shoulder * 148
  const nearElbow = endpoint(nearShoulder, 108, nearUpper)
  const farElbow = endpoint(farShoulder, 106, farUpper)
  const nearWrist = endpoint(nearElbow, 99, nearUpper + 9 + curl * 142 + squat * 24 + shoulder * 10)
  const farWrist = endpoint(farElbow, 97, farUpper - 8 - curl * 135 + squat * 26 - shoulder * 8)
  const neck = point(chest.x, chest.y - 12)
  const head = point(chest.x - 3, chest.y - 64)
  return { hip, chest, neck, head, lean, nearHip, farHip, nearAnkle, farAnkle,
    nearKnee: knee(nearHip, nearAnkle), farKnee: knee(farHip, farAnkle),
    nearShoulder, farShoulder, nearElbow, farElbow, nearWrist, farWrist }
})

// 有宽度变化的轮廓，端部用半圆接缝，避免肘膝出现尖角或空隙。
function limb(a: Point, b: Point, startRadius: number, endRadius: number): string {
  const length = Math.hypot(b.x - a.x, b.y - a.y)
  const nx = -(b.y - a.y) / length, ny = (b.x - a.x) / length
  return `M${a.x + nx * startRadius} ${a.y + ny * startRadius}
    L${b.x + nx * endRadius} ${b.y + ny * endRadius}
    A${endRadius} ${endRadius} 0 0 0 ${b.x - nx * endRadius} ${b.y - ny * endRadius}
    L${a.x - nx * startRadius} ${a.y - ny * startRadius}
    A${startRadius} ${startRadius} 0 0 0 ${a.x + nx * startRadius} ${a.y + ny * startRadius} Z`
}

const shirt = computed(() => {
  const { chest: c, hip: h } = body.value
  return `M${c.x - 36} ${c.y - 13} Q${c.x} ${c.y - 26} ${c.x + 34} ${c.y - 17}
    Q${c.x + 53} ${c.y + 18} ${h.x + 39} ${h.y - 4}
    Q${h.x} ${h.y + 11} ${h.x - 40} ${h.y - 3}
    Q${c.x - 50} ${c.y + 34} ${c.x - 36} ${c.y - 13} Z`
})
const shorts = computed(() => {
  const { hip: h } = body.value
  return `M${h.x - 40} ${h.y - 15} Q${h.x} ${h.y - 7} ${h.x + 40} ${h.y - 15}
    L${h.x + 48} ${h.y + 39} L${h.x + 4} ${h.y + 46} L${h.x - 2} ${h.y + 29}
    L${h.x - 9} ${h.y + 48} L${h.x - 51} ${h.y + 39} Z`
})
const shirtSeam = computed(() => {
  const { chest: c, hip: h } = body.value
  return `M${c.x + 21} ${c.y + 38} Q${c.x + 25} ${c.y + 104} ${h.x + 26} ${h.y - 17}`
})
const collar = computed(() => {
  const { chest: c } = body.value
  return `M${c.x - 17} ${c.y - 16} Q${c.x} ${c.y + 2} ${c.x + 17} ${c.y - 16}`
})
const cuff = computed(() => {
  const { nearShoulder: s, nearElbow: e } = body.value
  const c = sleeveEnd(s, e)
  const length = Math.hypot(e.x - s.x, e.y - s.y)
  const nx = -(e.y - s.y) / length * 18, ny = (e.x - s.x) / length * 18
  return `M${c.x + nx} ${c.y + ny} L${c.x - nx} ${c.y - ny}`
})
function sleeveEnd(shoulder: Point, elbow: Point): Point {
  return point(shoulder.x + (elbow.x - shoulder.x) * .6, shoulder.y + (elbow.y - shoulder.y) * .6)
}
function shoe(ankle: Point, far: number): string {
  const floor = far ? 694 : 698
  return `M${ankle.x - 14} ${ankle.y - 5} Q${ankle.x} ${ankle.y + 3} ${ankle.x + 13} ${ankle.y - 2}
    L${ankle.x + 22} ${floor - 14} Q${ankle.x + 49} ${floor - 12} ${ankle.x + 48} ${floor - 2}
    Q${ankle.x + 21} ${floor + 2} ${ankle.x - 16} ${ankle.y + 15} Z`
}
function sole(ankle: Point, far: number): string {
  return `M${ankle.x - 14} ${ankle.y + 15} Q${ankle.x + 19} ${far ? 696 : 700} ${ankle.x + 46} ${far ? 692 : 696}`
}
function handRotation(elbow: Point, wrist: Point): string {
  const angle = -Math.atan2(wrist.x - elbow.x, wrist.y - elbow.y) * 180 / Math.PI
  return `rotate(${angle} ${wrist.x} ${wrist.y})`
}
function weightTransform(wrist: Point): string {
  return `translate(${wrist.x} ${wrist.y + 6})`
}
const description = computed(() => ({ knee: '屈膝下蹲与起身动作示意', elbow: '站姿屈肘弯举动作示意', shoulder: '双臂上举与下放动作示意', calf: '脚掌着地、脚跟提起动作示意' })[props.kind])
</script>

<style scoped>
.training-figure{height:100%;width:auto;max-width:100%;overflow:visible;filter:drop-shadow(0 4px 5px rgba(0,0,0,.12))}
.training-figure.obscured{opacity:.55}
.floor-line{fill:none;stroke:#a0bab7;stroke-width:1;opacity:.18}
.far-side{filter:brightness(.78)}
.shirt-seam{fill:none;stroke:#477e77;stroke-width:2;opacity:.45}
.pants-seam{fill:none;stroke:#7d8b99;stroke-width:2;opacity:.4}
.cuff{fill:none;stroke:#508c83;stroke-width:3;stroke-linecap:round}
.brow,.smile{fill:none;stroke:#755346;stroke-width:1.8;stroke-linecap:round}
.shoe-sole{fill:none;stroke:#829698;stroke-width:5;stroke-linecap:round}
.laces{fill:none;stroke:#8fa4a5;stroke-width:2;stroke-linecap:round}
.weight{fill:#354652;stroke:#a5bdc0;stroke-width:1.5}
.weight-bar{fill:none;stroke:#d1dcdf;stroke-width:6;stroke-linecap:round}
.motion-guide path{fill:none;stroke:#f0b58f;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;opacity:.55}
.motion-guide circle{fill:#f5c29e;stroke:#fff0dd;stroke-width:2}
</style>
