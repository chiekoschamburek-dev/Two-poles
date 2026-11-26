// 实时跟练的 Vue 包装：状态机本体在 repMachine.ts，视频离线分析复用同一套逻辑。
import { ref, computed } from 'vue'
import type { ExercisePhase } from '@/types/domain'
import { createRepMachine, type RepRule, type RepInterval } from './repMachine'
import { DEFAULT_CALIBRATION } from '@/services/motionConfig'

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
  const lastRep = ref<RepInterval | null>(null)
  const thresholds = ref(machine.snapshot().thresholds)
  let calibrationSeq = 0

  // 阈值直接读状态机快照，不再在这里重算一套（此前四个 computed 是 repMachine 内部公式的副本）
  const lowThreshold = computed(() => thresholds.value.low)
  const highThreshold = computed(() => thresholds.value.high)

  function apply(snapshot: ReturnType<typeof machine.snapshot>) {
    count.value = snapshot.count
    phase.value = snapshot.phase
    gate.value = snapshot.gate
    lastRepMs.value = snapshot.lastRepMs
    lastRep.value = snapshot.lastRep
    calibratedNeutral.value = snapshot.calibratedNeutral
    thresholds.value = snapshot.thresholds
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

  async function calibrate(
    readSample: () => { angle: number; visibility: number; timestamp?: number } | null,
    ms = DEFAULT_CALIBRATION.windowMs
  ): Promise<boolean> {
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
      await new Promise(resolve => setTimeout(resolve, DEFAULT_CALIBRATION.pollMs))
    }
    if (seq !== calibrationSeq) return false
    if (collected.length < DEFAULT_CALIBRATION.minSamples) {
      gate.value = '校准失败：没有足够的新关键点帧，请调整机位后重试'
      return false
    }
    collected.sort((a, b) => a - b)
    const measured = collected[Math.floor(collected.length / 2)]
    const guard = Math.max(DEFAULT_CALIBRATION.bottomGuardDeg, rule.hysteresis * DEFAULT_CALIBRATION.hysteresisGuardFactor)
    if (Math.abs(measured - rule.bottom) < guard) {
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

  return { count, phase, gate, lastRepMs, lastRep, calibratedNeutral, lowThreshold, highThreshold, thresholds, reset, interrupt, calibrate, feed }
}
