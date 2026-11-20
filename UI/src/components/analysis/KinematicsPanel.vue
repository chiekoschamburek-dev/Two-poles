<template>
  <BaseCard class="panel kinematics">
    <div class="kin-head">
      <div class="kin-title">
        <span class="micro">KINEMATICS</span>
        <h2>运动学</h2>
      </div>
      <div class="kin-chips">
        <span class="chip">SG {{ KINEMATICS_CONFIG.windowSec }}s · {{ KINEMATICS_CONFIG.order }}阶</span>
        <span v-if="kinematics" class="chip" :class="{ warn: qualityPercent < 60 }">有效帧 {{ qualityPercent }}%</span>
        <span v-if="sideLabel" class="chip">侧别 {{ sideLabel }}</span>
      </div>
    </div>

    <dl v-if="kinMetrics.length" class="metrics">
      <div v-for="metric in kinMetrics" :key="metric.id">
        <dt>{{ metric.label }}</dt>
        <dd>{{ metric.value }}<small v-if="metric.unit"> {{ metric.unit }}</small></dd>
      </div>
    </dl>

    <div v-if="quantityOptions.length" class="switch-rows">
      <div class="switch-group" role="group" aria-label="选择物理量">
        <button
          v-for="item in quantityOptions"
          :key="item.id"
          type="button"
          class="switch-chip"
          :class="{ on: activeQuantity === item.id }"
          :aria-pressed="activeQuantity === item.id"
          @click="activeQuantity = item.id"
        >{{ item.label }}</button>
      </div>
      <div v-if="jointOptions.length > 1" class="switch-group" role="group" aria-label="选择关节">
        <button
          v-for="item in jointOptions"
          :key="item.id"
          type="button"
          class="switch-chip"
          :class="{ on: activeJoint === item.id }"
          :aria-pressed="activeJoint === item.id"
          @click="activeJoint = item.id"
        >{{ item.label }}</button>
      </div>
    </div>

    <div v-if="hasCurrentData" class="curve-block">
      <div class="curve-head">
        <strong>{{ title }}</strong>
        <span>{{ unit }}</span>
      </div>
      <MotionCurve
        :points="currentSeries"
        :unit="unit"
        :title="title"
        :fps="fps"
        :marker-times="markerTimes"
        :domain="domain"
        :zero-line="zeroLine"
        :digits="digits"
        :interactive="interactive"
        @seek="$emit('seek', $event)"
      />
    </div>
    <p v-else-if="kinematics || angles.length" class="muted small">这一段没有足够的有效帧，未计算该曲线。</p>

    <div v-if="repBars.length" class="rep-bars">
      <div class="rep-head">
        <strong>组内{{ upLabel }}峰值角速度</strong>
        <span>{{ repBars.length }} 次</span>
      </div>
      <div v-for="bar in repBars" :key="bar.index" class="rep-row">
        <span class="rep-label">第 {{ bar.index }} 次</span>
        <span class="rep-track"><i :style="{ width: `${bar.ratio * 100}%` }"></i></span>
        <span class="rep-value">{{ bar.value.toFixed(1) }} °/s</span>
      </div>
      <p class="note">只观察组内变化，不判断疲劳；节奏、幅度和拍摄角度变化也会影响数值。</p>
    </div>

    <p class="note">{{ note }}</p>
    <p v-if="!kinematics" class="note warn">
      逐帧运动学曲线不可用（可能未开启「保存动作数据」，或有效帧不足）；这条记录的结构化测量仍然保留。
    </p>
  </BaseCard>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import BaseCard from '@/components/common/BaseCard.vue'
import MotionCurve from '@/components/analysis/MotionCurve.vue'
import { KINEMATICS_CONFIG, isKinematicsMetric } from '@/services/motionKinematics'
import { configForAction } from '@/services/motionConfig'
import type {
  AnalysisAction,
  MotionAnalysisMetric,
  MotionAngleSample,
  MotionKinematics
} from '@/types/domain'

const props = withDefaults(defineProps<{
  kinematics: MotionKinematics | null
  angles: MotionAngleSample[]
  metrics: MotionAnalysisMetric[]
  action: AnalysisAction
  fps: number
  markerTimes?: number[]
  interactive?: boolean
}>(), {
  markerTimes: () => [],
  interactive: true
})

defineEmits<{ seek: [timeMs: number] }>()

type Quantity = 'angle' | 'angularVelocity' | 'angularAcceleration' | 'linearVelocity' | 'linearAcceleration'
type Joint = 'knee' | 'hip' | 'trunk'

const QUANTITY_LABELS: Record<Quantity, string> = {
  angle: '角度',
  angularVelocity: '角速度',
  angularAcceleration: '角加速度',
  linearVelocity: '线速度',
  linearAcceleration: '线加速度'
}
const JOINT_LABELS: Record<Joint, string> = { knee: '膝', hip: '髋', trunk: '躯干' }
const JOINT_ORDER: Joint[] = ['knee', 'hip', 'trunk']

const kinMetrics = computed(() => props.metrics.filter(isKinematicsMetric))

const hasRawAngles = computed(() => props.angles.some(sample =>
  sample.kneeAngle !== null || sample.hipAngle !== null || sample.trunkAngle !== null))
const hasKinematicAngles = computed(() => props.kinematics?.joints.some(joint =>
  joint.samples.some(sample => sample.angle !== null)) ?? false)
const hasAngle = computed(() => hasRawAngles.value || hasKinematicAngles.value)
const hasAngular = computed(() => props.kinematics?.joints.some(joint =>
  joint.samples.some(sample => sample.angularVelocity !== null)) ?? false)
const hasLinear = computed(() => props.kinematics?.linear?.samples.some(sample =>
  sample.velocity !== null) ?? false)

const availableQuantities = computed<Quantity[]>(() => {
  const list: Quantity[] = []
  if (hasAngle.value) list.push('angle')
  if (hasAngular.value) list.push('angularVelocity', 'angularAcceleration')
  if (hasLinear.value) list.push('linearVelocity', 'linearAcceleration')
  return list
})

const quantity = ref<Quantity>('angularVelocity')
const activeQuantity = computed<Quantity>({
  get: () => availableQuantities.value.includes(quantity.value)
    ? quantity.value
    : (availableQuantities.value[0] ?? 'angle'),
  set: value => { quantity.value = value }
})

const primaryJoint = computed<Joint>(() => props.kinematics?.primaryJoint ?? (props.action === 'deadlift' ? 'hip' : 'knee'))
const joint = ref<Joint>(primaryJoint.value)
watch(primaryJoint, value => { joint.value = value })

const isLinear = computed(() => activeQuantity.value === 'linearVelocity' || activeQuantity.value === 'linearAcceleration')

const availableJoints = computed<Joint[]>(() => {
  if (isLinear.value) return []
  if (activeQuantity.value === 'angle') {
    const present = new Set<Joint>()
    for (const sample of props.angles) {
      if (sample.kneeAngle !== null) present.add('knee')
      if (sample.hipAngle !== null) present.add('hip')
      if (sample.trunkAngle !== null) present.add('trunk')
    }
    for (const series of props.kinematics?.joints ?? []) {
      if (series.samples.some(sample => sample.angle !== null)) present.add(series.joint)
    }
    return JOINT_ORDER.filter(item => present.has(item))
  }
  const present = new Set<Joint>()
  for (const series of props.kinematics?.joints ?? []) {
    if (series.samples.some(sample => sample.angularVelocity !== null)) present.add(series.joint)
  }
  return JOINT_ORDER.filter(item => present.has(item))
})

const activeJoint = computed<Joint>({
  get: () => availableJoints.value.includes(joint.value)
    ? joint.value
    : (availableJoints.value[0] ?? primaryJoint.value),
  set: value => { joint.value = value }
})

const quantityOptions = computed(() => availableQuantities.value.map(id => ({ id, label: QUANTITY_LABELS[id] })))
const jointOptions = computed(() => availableJoints.value.map(id => ({ id, label: JOINT_LABELS[id] })))

const currentJoint = computed(() => props.kinematics?.joints.find(series => series.joint === activeJoint.value) ?? null)

/** 力量动作只画识别到的重复区间：视频首尾的起身/离开画面不是这次动作的一部分 */
const repRanges = computed<[number, number][] | null>(() => {
  const reps = props.kinematics?.reps ?? []
  if (props.action === 'running' || !reps.length) return null
  const ranges = reps
    .filter(rep => Number.isFinite(rep.startMs) && Number.isFinite(rep.endMs) && rep.endMs > rep.startMs)
    .map(rep => [rep.startMs, rep.endMs] as [number, number])
  return ranges.length ? ranges : null
})

const withinReps = (points: { timeMs: number; value: number | null }[]) => {
  const ranges = repRanges.value
  if (!ranges) return points
  const padding = 100
  return points.filter(point => ranges.some(([start, end]) =>
    point.timeMs >= start - padding && point.timeMs <= end + padding))
}

const angleOf = (sample: MotionAngleSample, target: Joint): number | null =>
  target === 'hip' ? sample.hipAngle : target === 'trunk' ? sample.trunkAngle : sample.kneeAngle

const currentSeries = computed<{ timeMs: number; value: number | null }[]>(() => {
  const quantityNow = activeQuantity.value
  if (quantityNow === 'angle') {
    if (props.angles.some(sample => angleOf(sample, activeJoint.value) !== null)) {
      return withinReps(props.angles.map(sample => ({ timeMs: sample.timeMs, value: angleOf(sample, activeJoint.value) })))
    }
    return withinReps(currentJoint.value?.samples.map(sample => ({ timeMs: sample.timeMs, value: sample.angle })) ?? [])
  }
  if (quantityNow === 'angularVelocity' || quantityNow === 'angularAcceleration') {
    return withinReps(currentJoint.value?.samples.map(sample => ({
      timeMs: sample.timeMs,
      value: quantityNow === 'angularVelocity' ? sample.angularVelocity : sample.angularAcceleration
    })) ?? [])
  }
  const linear = props.kinematics?.linear
  if (!linear) return []
  return withinReps(linear.samples.map(sample => ({
    timeMs: sample.timeMs,
    value: quantityNow === 'linearVelocity' ? sample.velocity : sample.acceleration
  })))
})

const hasCurrentData = computed(() => currentSeries.value.some(point => point.value !== null))

const unit = computed(() => {
  switch (activeQuantity.value) {
    case 'angle': return '°'
    case 'angularVelocity': return '°/s'
    case 'angularAcceleration': return '°/s²'
    case 'linearVelocity': return '躯干长/秒'
    default: return '躯干长/秒²'
  }
})

const digits = computed(() => activeQuantity.value === 'angle' ? 0 : isLinear.value ? 2 : 1)
const zeroLine = computed(() => activeQuantity.value !== 'angle')
const domain = computed<[number, number] | null>(() => activeQuantity.value === 'angle' ? [60, 180] : null)

const title = computed(() => {
  if (activeQuantity.value === 'angle') return `${JOINT_LABELS[activeJoint.value]}角曲线`
  if (activeQuantity.value === 'angularVelocity') return `${JOINT_LABELS[activeJoint.value]}角速度曲线`
  if (activeQuantity.value === 'angularAcceleration') return `${JOINT_LABELS[activeJoint.value]}角加速度曲线`
  return activeQuantity.value === 'linearVelocity' ? '髋部竖直速度曲线' : '髋部竖直加速度曲线'
})

const activeValidRatio = computed(() => {
  if (isLinear.value) return props.kinematics?.linear?.validRatio ?? 0
  return currentJoint.value?.validRatio ?? 0
})
const qualityPercent = computed(() => Math.round(activeValidRatio.value * 100))

const sideLabel = computed(() => {
  if (isLinear.value || !props.kinematics) return null
  const side = currentJoint.value?.side
  return side === 'left' ? '左' : side === 'right' ? '右' : null
})

const config = computed(() => configForAction(props.action))
const upLabel = computed(() => config.value?.phaseText.up ?? '起身')

const repBars = computed(() => {
  const reps = props.kinematics?.reps ?? []
  if (reps.length < 2) return []
  const values = reps.flatMap(rep => {
    const value = rep.peakExtensionVelocity
    return value === null || !Number.isFinite(value) ? [] : [{ index: rep.index, value }]
  })
  if (values.length < 2) return []
  const max = Math.max(...values.map(item => item.value), 0.1)
  return values.map(item => ({
    index: item.index,
    value: item.value,
    ratio: Math.max(0, Math.min(1, item.value / max))
  }))
})

const note = computed(() => {
  const parts: string[] = []
  if (!availableQuantities.value.length) {
    parts.push('这条记录只有聚合测量值，没有逐帧曲线数据。')
  } else if (activeQuantity.value === 'angle') {
    parts.push('角度是逐帧测量值。')
  } else if (activeQuantity.value === 'linearVelocity' || activeQuantity.value === 'linearAcceleration') {
    parts.push('线速度按躯干长度归一化，向上为正；单位「躯干长/秒」，不是 m/s，也不能当作对地速度。')
  } else {
    parts.push('角速度/角加速度由平滑后的关节角求导；正值=关节角增大（伸展），负值=减小（屈曲），躯干为前倾角。')
  }
  parts.push(`Savitzky–Golay 局部二次拟合，窗口 ${KINEMATICS_CONFIG.windowSec} 秒；缺失或遮挡帧断开，不补 0。`)
  if (repRanges.value) parts.push('曲线只显示识别到的完整重复区间，视频首尾的准备与离开画面不计入。')
  parts.push('二阶导数对关键点噪声敏感，结果只作复盘测量，不构成评分、诊断或训练处方。')
  return parts.join('')
})
</script>

<style scoped>
.kinematics { padding: 16px 18px; }
.kin-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
.kin-title { min-width: 0; }
.micro { display: block; font-family: var(--font-num); font-size: 8.5px; font-weight: 600; letter-spacing: .14em; color: var(--pole-movement-strong); }
.kin-title h2 { margin: 2px 0 0; font-size: 17px; }
.kin-chips { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 5px; }
.chip { padding: 2px 8px; border: 1px solid var(--pole-movement-line); border-radius: 999px; background: var(--pole-movement-soft); font-family: var(--font-num); font-size: 9px; font-weight: 600; color: var(--pole-movement-strong); white-space: nowrap; }
.chip.warn { border-color: var(--color-caution); background: var(--color-caution-soft); color: var(--color-caution); }
.metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin: 0 0 12px; }
.metrics div { padding: 10px 12px; border-radius: var(--radius-md); background: var(--color-neutral-soft); }
.metrics dt { font-size: 11px; color: var(--color-text-muted); }
.metrics dd { margin: 3px 0 0; font-family: var(--font-num); font-size: 17px; font-weight: 700; }
.metrics small { font-size: 10.5px; font-weight: 500; color: var(--color-text-muted); }
.curve-block { margin-top: 4px; }
.curve-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 2px; }
.curve-head strong { font-size: 12.5px; font-weight: 600; }
.curve-head span { font-family: var(--font-num); font-size: 10px; color: var(--color-text-muted); }
.switch-rows { display: flex; flex-wrap: wrap; gap: 6px 10px; margin-bottom: 8px; }
.switch-group { display: flex; flex-wrap: wrap; gap: 5px; }
.switch-chip { padding: 3px 10px; min-height: var(--target-size); border: 1px solid var(--color-border); border-radius: 999px; background: var(--color-card); color: var(--color-text-secondary); font-family: inherit; font-size: 10.5px; font-weight: 600; cursor: pointer; transition: border-color var(--motion-fast), background var(--motion-fast); }
.switch-chip:hover { border-color: var(--pole-movement-line); }
.switch-chip.on { border-color: var(--pole-movement-line); background: var(--pole-movement-soft); color: var(--pole-movement-strong); }
.muted { margin: 0; color: var(--color-text-muted); font-size: 13px; line-height: 1.7; }
.small { font-size: 11.5px; }
.rep-bars { margin: 12px 0 2px; padding-top: 10px; border-top: 1px solid var(--color-divider); }
.rep-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 7px; }
.rep-head strong { font-size: 12.5px; }
.rep-head span { font-family: var(--font-num); font-size: 10px; color: var(--color-text-muted); }
.rep-row { display: grid; grid-template-columns: 58px 1fr 84px; align-items: center; gap: 8px; margin: 5px 0; }
.rep-label { font-size: 10.5px; color: var(--color-text-muted); }
.rep-track { display: block; height: 8px; overflow: hidden; border-radius: 999px; background: var(--color-neutral-soft); }
.rep-track i { display: block; height: 100%; border-radius: 999px; background: var(--pole-movement); }
.rep-value { font-family: var(--font-num); font-size: 10.5px; font-weight: 600; text-align: right; color: var(--color-text-secondary); }
.note { margin: 8px 0 0; font-size: 10.5px; line-height: 1.7; color: var(--color-text-muted); }
.note.warn { color: var(--color-caution); }
@media (max-width: 767px) {
  .kinematics { padding: 14px; }
  .kin-head { flex-direction: column; align-items: stretch; }
  .kin-chips { justify-content: flex-start; }
  .rep-row { grid-template-columns: 52px 1fr 78px; }
}
</style>