// 实时跟练的 Vue 包装：状态机本体在 repMachine.ts，视频离线分析复用同一套逻辑。
import { ref, computed } from 'vue'
import type { ExercisePhase } from '@/types/domain'
import { createRepMachine, type RepRule } from './repMachine'

export type { RepRule }

export interface RepCounterState {
  phase: ExercisePhase
  counted: boolean
  gate: string | null
}

export function useRepCounter(rule: RepRule) {
  const machine = createRepMachine(rule)
  const count = ref(0)
  const phase = ref<ExercisePhase>('ready')
  const gate = ref<string | null>('请先保持起始姿势')
  const calibratedNeutral = ref<number | null>(null)
  const lastRepMs = ref<number | null>(null)
  let calibrationSeq = 0

  const neutral = computed(() => calibratedNeutral.value ?? rule.neutral)
  const increasing = computed(() => rule.bottom > neutral.value)
  const lowThreshold = computed(() => (neutral.value + rule.bottom) / 2 + (increasing.value ? rule.hysteresis : -rule.hysteresis))
  const highThreshold = computed(() => (neutral.value + rule.bottom) / 2 + (increasing.value ? -rule.hysteresis : rule.hysteresis))

  function apply(snapshot: ReturnType<typeof machine.snapshot>) {
    count.value = snapshot.count
    phase.value = snapshot.phase
    gate.value = snapshot.gate
    lastRepMs.value = snapshot.lastRepMs
    calibratedNeutral.value = snapshot.calibratedNeutral
  }

  /** 暂停、换侧、遮挡或校准只丢弃半次行程，保留已经确认的次数。 */
  function interrupt(text: string | null = '请回到起始姿势后继续') {
    calibrationSeq++
    machine.interrupt(text)
    apply(machine.snapshot())
  }

  function reset(text: string | null = '请先保持起始姿势') {
    calibrationSeq++
    machine.reset(text)
    apply(machine.snapshot())
  }

  async function calibrate(readSample: () => { angle: number; visibility: number; timestamp?: number } | null, ms = 900): Promise<boolean> {
    interrupt('校准中：请保持起始姿势静止')
    const seq = calibrationSeq
    const collected: number[] = []
    let previousTimestamp: number | undefined
    const start = performance.now()
    while (performance.now() - start < ms) {
      if (seq !== calibrationSeq) return false
      const sample = readSample()
      if (sample && Number.isFinite(sample.angle) && sample.angle >= 0 && sample.angle <= 180
        && Number.isFinite(sample.visibility) && sample.visibility >= rule.minVisibility
        && (sample.timestamp === undefined || sample.timestamp !== previousTimestamp)) {
        collected.push(sample.angle)
        previousTimestamp = sample.timestamp
      }
      await new Promise(resolve => setTimeout(resolve, 60))
    }
    if (seq !== calibrationSeq) return false
    if (collected.length < 4) {
      gate.value = '校准失败：没有足够的新关键点帧，请调整机位后重试'
      return false
    }
    collected.sort((a, b) => a - b)
    const measured = collected[Math.floor(collected.length / 2)]
    if (Math.abs(measured - rule.bottom) < Math.max(20, rule.hysteresis * 2)) {
      gate.value = '校准姿势接近动作末端，请回到起始姿势后重试'
      return false
    }
    machine.setCalibratedNeutral(Math.round(measured))
    calibratedNeutral.value = Math.round(measured)
    interrupt('校准完成，请保持起始姿势后继续')
    return true
  }

  /** 一次新推理帧只调用一次；重复或倒退的时间戳不参与平滑和停留判断。 */
  function feed(angle: number | null, visibility: number, ts: number): RepCounterState {
    const snapshot = machine.feed(angle, visibility, ts)
    apply(snapshot)
    return { phase: snapshot.phase, counted: snapshot.counted, gate: snapshot.gate }
  }

  return { count, phase, gate, lastRepMs, calibratedNeutral, lowThreshold, highThreshold, reset, interrupt, calibrate, feed }
}
