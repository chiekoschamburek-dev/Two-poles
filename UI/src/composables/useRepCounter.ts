// 视觉计数状态机（F05）：把端侧姿态关节角变成"起始—运动—返回"的一次计数。
// 只用关键点的角度做迟滞判断，不评价动作是否标准，也不输出姿势安全结论。
import { ref, computed } from 'vue'
import type { ExercisePhase } from '@/types/domain'

export interface RepRule {
  /** 起始位角度（站直或手臂下垂时的关节角） */
  neutral: number
  /** 行程末端角度 */
  bottom: number
  /** 迟滞区间宽度，避免阈值附近抖动误计 */
  hysteresis: number
  /** 在一个区间内至少停留多久才算到达，ms */
  minStageMs: number
  /** 一次完整行程的最短时间，ms；短于此判为抖动 */
  minRepMs: number
  /** 单阶段最长停留，超过则认为动作中断并重置到起始态，ms */
  maxStageMs: number
  /** 关键点可见度低于此值时冻结判断 */
  minVisibility: number
}

export interface RepCounterState {
  phase: ExercisePhase
  counted: boolean
  gate: string | null
}

const SMOOTH_WINDOW = 3

export function useRepCounter(rule: RepRule) {
  const count = ref(0)
  const phase = ref<ExercisePhase>('idle')
  const gate = ref<string | null>(null)
  /** 标定出的起始位角度；null 表示用规则里的默认 neutral */
  const calibratedNeutral = ref<number | null>(null)
  const lastRepMs = ref<number | null>(null)

  const window: number[] = []
  let zone: 'start' | 'end' | 'between' = 'start'
  let zoneSince = 0
  let stageConfirmed: 'none' | 'end' | 'start' = 'none'
  let repStartedAt = 0
  let occluded = true

  const lowThreshold = computed(() => {
    const neutral = calibratedNeutral.value ?? rule.neutral
    const mid = (neutral + rule.bottom) / 2
    return rule.bottom > neutral ? mid + rule.hysteresis : mid - rule.hysteresis
  })
  const highThreshold = computed(() => {
    const neutral = calibratedNeutral.value ?? rule.neutral
    const mid = (neutral + rule.bottom) / 2
    return rule.bottom > neutral ? mid - rule.hysteresis : mid + rule.hysteresis
  })

  function smooth(angle: number): number {
    window.push(angle)
    if (window.length > SMOOTH_WINDOW) window.shift()
    return window.reduce((s, a) => s + a, 0) / window.length
  }

  function reset(text: string | null = null) {
    window.length = 0
    zone = 'start'
    zoneSince = 0
    stageConfirmed = 'none'
    repStartedAt = 0
    count.value = 0
    phase.value = 'ready'
    gate.value = text
    lastRepMs.value = null
  }

  /**
   * 机位校准：让用户在起始位静止站好，采样若干帧取中位附近均值。
   * 阈值随标定结果移动，不把某个绝对角度当成通用标准（文档 §3.4.3(2)）。
   */
  async function calibrate(readSample: () => { angle: number; visibility: number } | null, ms = 900): Promise<boolean> {
    const collected: number[] = []
    const start = performance.now()
    gate.value = '校准中：请保持起始姿势静止'
    phase.value = 'ready'
    while (performance.now() - start < ms) {
      const s = readSample()
      if (s && s.visibility >= rule.minVisibility) collected.push(s.angle)
      await new Promise(r => setTimeout(r, 60))
    }
    if (collected.length < 4) {
      gate.value = '校准失败：画面里看不到稳定的关键点，请调整机位后重试'
      return false
    }
    const avg = collected.reduce((s, a) => s + a, 0) / collected.length
    calibratedNeutral.value = Math.round(avg)
    reset('校准完成，按你的起始姿势设了阈值')
    window.length = 0
    return true
  }

  /** 每帧喂一次数据；返回本次是否产生了一次计数 */
  function feed(angle: number | null, visibility: number, ts: number): RepCounterState {
    if (angle === null) {
      occluded = true
      phase.value = 'occluded'
      gate.value = '没有可用的关节角，计数已冻结'
      return { phase: phase.value, counted: false, gate: gate.value }
    }

    // 遮挡或关键点不稳定：冻结判断，恢复后要求重新回到起始位（文档 §4.3.4、§7）
    if (visibility < rule.minVisibility) {
      if (!occluded) {
        occluded = true
        stageConfirmed = 'none'
        phase.value = 'occluded'
        gate.value = '关键点可见度不足，计数暂停：请让全身完整入镜'
      }
      return { phase: phase.value, counted: false, gate: gate.value }
    }

    const a = smooth(angle)
    const next: 'start' | 'end' | 'between' =
      rule.bottom > rule.neutral ? (a >= lowThreshold.value ? 'end' : a <= highThreshold.value ? 'start' : 'between')
        : (a <= lowThreshold.value ? 'end' : a >= highThreshold.value ? 'start' : 'between')

    if (next !== zone) {
      zone = next
      zoneSince = ts
    }

    if (occluded) {
      // 遮挡恢复后必须先回到起始位才开始下一段
      if (zone === 'start' && ts - zoneSince >= rule.minStageMs) {
        occluded = false
        gate.value = null
        phase.value = 'ready'
      } else {
        phase.value = 'occluded'
        return { phase: phase.value, counted: false, gate: gate.value }
      }
    }

    // 阶段停滞过久判为中断，重置到起始态，不累计可疑次数
    if (zoneSince && ts - zoneSince > rule.maxStageMs) {
      stageConfirmed = 'none'
      repStartedAt = 0
      zoneSince = ts
      phase.value = 'ready'
      gate.value = '动作似乎中断了，已重新从起始位开始计数'
    }

    if (zone === 'end' && stageConfirmed !== 'end') {
      if (ts - zoneSince >= rule.minStageMs) {
        stageConfirmed = 'end'
        if (!repStartedAt) repStartedAt = zoneSince
        phase.value = rule.bottom > rule.neutral ? 'up' : 'down'
        gate.value = null
      } else {
        phase.value = 'ready'
      }
    } else if (zone === 'start') {
      if (stageConfirmed === 'end' && ts - zoneSince >= rule.minStageMs) {
        const duration = ts - repStartedAt
        if (duration < rule.minRepMs) {
          gate.value = '这一段太快，判为抖动，未计入'
          stageConfirmed = 'none'
          repStartedAt = 0
        } else {
          count.value += 1
          lastRepMs.value = duration
          phase.value = 'complete'
          stageConfirmed = 'start'
          repStartedAt = 0
          return { phase: phase.value, counted: true, gate: gate.value }
        }
      } else if (stageConfirmed !== 'end' && ts - zoneSince >= rule.minStageMs) {
        phase.value = 'ready'
      }
    } else if (zone === 'between') {
      phase.value = stageConfirmed === 'end' ? 'down' : 'up'
    }

    return { phase: phase.value, counted: false, gate: gate.value }
  }

  return {
    count,
    phase,
    gate,
    lastRepMs,
    calibratedNeutral,
    lowThreshold,
    highThreshold,
    reset,
    calibrate,
    feed
  }
}
