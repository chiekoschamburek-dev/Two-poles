// 只把可见、连续的起始位 → 末端 → 起始位记为一次，不评价动作是否标准。
import { ref, computed } from 'vue'
import type { ExercisePhase } from '@/types/domain'

export interface RepRule {
  neutral: number
  bottom: number
  hysteresis: number
  minStageMs: number
  /** 起始/返回位只需短暂稳定，避免自然动作因端点停留短而漏计。 */
  minStartMs?: number
  minRepMs: number
  maxStageMs: number
  minVisibility: number
  /** 相邻推理帧间隔过长时放弃未完成的行程，默认 1 秒。 */
  maxGapMs?: number
}

export interface RepCounterState {
  phase: ExercisePhase
  counted: boolean
  gate: string | null
}

export function useRepCounter(rule: RepRule) {
  const count = ref(0)
  const phase = ref<ExercisePhase>('ready')
  const gate = ref<string | null>('请先保持起始姿势')
  const calibratedNeutral = ref<number | null>(null)
  const lastRepMs = ref<number | null>(null)
  const samples: number[] = []
  let zone: 'start' | 'end' | 'between' | null = null
  let zoneSince = 0
  let lastTs: number | null = null
  let armed = false
  let reachedEnd = false
  let repStartedAt: number | null = null
  let calibrationSeq = 0

  const neutral = computed(() => calibratedNeutral.value ?? rule.neutral)
  const increasing = computed(() => rule.bottom > neutral.value)
  const lowThreshold = computed(() => (neutral.value + rule.bottom) / 2 + (increasing.value ? rule.hysteresis : -rule.hysteresis))
  const highThreshold = computed(() => (neutral.value + rule.bottom) / 2 + (increasing.value ? -rule.hysteresis : rule.hysteresis))

  function clearMovement() {
    samples.length = 0
    zone = null
    zoneSince = 0
    armed = reachedEnd = false
    repStartedAt = null
  }

  /** 暂停、换侧、遮挡或校准只丢弃半次行程，保留已经确认的次数。 */
  function interrupt(text: string | null = '请回到起始姿势后继续') {
    calibrationSeq++
    clearMovement()
    lastTs = null
    phase.value = 'ready'
    gate.value = text
  }

  function reset(text: string | null = '请先保持起始姿势') {
    interrupt(text)
    count.value = 0
    lastRepMs.value = null
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
    calibratedNeutral.value = Math.round(measured)
    interrupt('校准完成，请保持起始姿势后继续')
    return true
  }

  const result = (counted = false): RepCounterState => ({ phase: phase.value, counted, gate: gate.value })

  /** 一次新推理帧只调用一次；重复或倒退的时间戳不参与平滑和停留判断。 */
  function feed(angle: number | null, visibility: number, ts: number): RepCounterState {
    if (!Number.isFinite(ts) || (lastTs !== null && ts <= lastTs)) return result()
    const gap = lastTs !== null && ts - lastTs > (rule.maxGapMs ?? 1000)
    lastTs = ts
    if (angle === null || !Number.isFinite(angle) || angle < 0 || angle > 180
      || !Number.isFinite(visibility) || visibility < rule.minVisibility) {
      clearMovement()
      phase.value = 'occluded'
      gate.value = '关键点不可见，计数暂停；请完整入镜后回到起始姿势'
      return result()
    }
    if (gap) {
      clearMovement()
      gate.value = '画面中断，请回到起始姿势后继续'
    }
    samples.push(angle)
    if (samples.length > 3) samples.shift()
    const smooth = samples.reduce((sum, value) => sum + value, 0) / samples.length
    const next = increasing.value
      ? smooth >= lowThreshold.value ? 'end' : smooth <= highThreshold.value ? 'start' : 'between'
      : smooth <= lowThreshold.value ? 'end' : smooth >= highThreshold.value ? 'start' : 'between'
    if (next !== zone) {
      if (armed && next !== 'start' && repStartedAt === null) repStartedAt = ts
      zone = next
      zoneSince = ts
    }
    if (zone !== 'start' && ts - zoneSince > rule.maxStageMs) {
      clearMovement()
      phase.value = 'ready'
      gate.value = '动作中断，请回到起始姿势后重新开始'
      return result()
    }
    const stable = ts - zoneSince >= (zone === 'start' ? rule.minStartMs ?? Math.min(rule.minStageMs, 80) : rule.minStageMs)
    if (!armed) {
      phase.value = 'ready'
      if (zone === 'start' && stable) {
        armed = true
        gate.value = null
      } else if (!gate.value) gate.value = '请先保持起始姿势'
      return result()
    }
    if (zone === 'end') {
      if (stable) reachedEnd = true
      phase.value = increasing.value ? 'up' : 'down'
    } else if (zone === 'start' && stable) {
      if (reachedEnd && repStartedAt !== null) {
        const duration = ts - repStartedAt
        reachedEnd = false
        repStartedAt = null
        if (duration < rule.minRepMs) {
          phase.value = 'ready'
          gate.value = '这一段太快，未计入次数'
        } else {
          count.value++
          lastRepMs.value = duration
          phase.value = 'complete'
          gate.value = null
          return result(true)
        }
      } else {
        repStartedAt = null
        phase.value = 'ready'
      }
    } else if (zone === 'between') {
      phase.value = reachedEnd ? (increasing.value ? 'down' : 'up') : (increasing.value ? 'up' : 'down')
    }
    return result()
  }

  return { count, phase, gate, lastRepMs, calibratedNeutral, lowThreshold, highThreshold, reset, interrupt, calibrate, feed }
}
