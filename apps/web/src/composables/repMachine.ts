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
  /**
   * 关键点短暂不可见时冻结而不是丢弃半次行程，默认 1 秒（与 maxGapMs 同口径）。
   * 真实深蹲/坐站在最低点会自遮挡，构成角的三点可见度最小值会掉到 0.5 以下；
   * 立即 clearMovement 会把「必须到达底部才计数」的那一段抹掉，导致真实视频恒计 0 次。
   * 实测 sit-to-stand.mp4 最低点遮挡约 867ms，故取 1000ms 而非更短值。
   */
  maxOcclusionMs?: number
}

export interface RepInterval {
  startMs: number
  endMs: number
}

export interface RepMachineSnapshot {
  count: number
  phase: ExercisePhase
  gate: string | null
  lastRepMs: number | null
  lastRep: RepInterval | null
  calibratedNeutral: number | null
  /** 本次 feed 是否完成了一次重复 */
  counted: boolean
  /** 当前三区阈值；展示层直接读它，不再另算一套 */
  thresholds: { neutral: number; low: number; high: number; increasing: boolean }
}

export interface RepMachine {
  feed(angle: number | null, visibility: number, ts: number): RepMachineSnapshot
  interrupt(text?: string | null): void
  reset(text?: string | null): void
  setCalibratedNeutral(value: number | null): void
  snapshot(): RepMachineSnapshot
}

/** 阈值状态机的纯函数实现：实时跟练与视频离线分析共用，行为与 F05 现有逻辑一致。 */
export function createRepMachine(rule: RepRule): RepMachine {
  let count = 0
  let phase: ExercisePhase = 'ready'
  let gate: string | null = '请先保持起始姿势'
  let calibratedNeutral: number | null = null
  let lastRepMs: number | null = null
  let lastRep: RepInterval | null = null
  const samples: number[] = []
  let zone: 'start' | 'end' | 'between' | null = null
  let zoneSince = 0
  let lastTs: number | null = null
  let armed = false
  let reachedEnd = false
  let repStartedAt: number | null = null
  let occludedSince: number | null = null

  const neutral = () => calibratedNeutral ?? rule.neutral
  const increasing = () => rule.bottom > neutral()
  const midpoint = () => (neutral() + rule.bottom) / 2

  function snapshot(counted = false): RepMachineSnapshot {
    const mid = midpoint()
    const up = increasing()
    return {
      count, phase, gate, lastRepMs, lastRep, calibratedNeutral, counted,
      thresholds: {
        neutral: neutral(),
        increasing: up,
        low: mid + (up ? rule.hysteresis : -rule.hysteresis),
        high: mid + (up ? -rule.hysteresis : rule.hysteresis)
      }
    }
  }

  function clearMovement() {
    samples.length = 0
    zone = null
    zoneSince = 0
    armed = reachedEnd = false
    repStartedAt = null
    occludedSince = null
  }

  function interrupt(text: string | null = '请回到起始姿势后继续') {
    clearMovement()
    lastTs = null
    phase = 'ready'
    gate = text
  }

  function reset(text: string | null = '请先保持起始姿势') {
    interrupt(text)
    count = 0
    lastRepMs = null
    lastRep = null
  }

  function feed(angle: number | null, visibility: number, ts: number): RepMachineSnapshot {
    if (!Number.isFinite(ts) || (lastTs !== null && ts <= lastTs)) return snapshot()
    const gap = lastTs !== null && ts - lastTs > (rule.maxGapMs ?? 1000)
    lastTs = ts
    // 算不出角 = 测量失败（关键点缺失），硬中断，保住「丢点不得补计残留半次」的保证
    if (angle === null || !Number.isFinite(angle) || angle < 0 || angle > 180) {
      clearMovement()
      phase = 'occluded'
      gate = '关键点不可见，计数暂停；请完整入镜后回到起始姿势'
      return snapshot()
    }
    // 角算得出但可见度低 = 自遮挡。真实深蹲最低点必然如此，宽限期内冻结而不是丢弃半次行程
    if (!Number.isFinite(visibility) || visibility < rule.minVisibility) {
      if (occludedSince === null) occludedSince = ts
      if (ts - occludedSince > (rule.maxOcclusionMs ?? 1000)) {
        clearMovement()
        gate = '关键点长时间不可见，请完整入镜后回到起始姿势'
      } else {
        gate = '关键点不可见，计数暂停；请完整入镜后回到起始姿势'
      }
      phase = 'occluded'
      return snapshot()
    }
    occludedSince = null
    if (gap) {
      clearMovement()
      gate = '画面中断，请回到起始姿势后继续'
    }
    samples.push(angle)
    if (samples.length > 3) samples.shift()
    const smooth = samples.reduce((sum, value) => sum + value, 0) / samples.length
    const low = midpoint() + (increasing() ? rule.hysteresis : -rule.hysteresis)
    const high = midpoint() + (increasing() ? -rule.hysteresis : rule.hysteresis)
    const next = increasing()
      ? smooth >= low ? 'end' : smooth <= high ? 'start' : 'between'
      : smooth <= low ? 'end' : smooth >= high ? 'start' : 'between'
    if (next !== zone) {
      if (armed && next !== 'start' && repStartedAt === null) repStartedAt = ts
      zone = next
      zoneSince = ts
    }
    if (zone !== 'start' && ts - zoneSince > rule.maxStageMs) {
      clearMovement()
      phase = 'ready'
      gate = '动作中断，请回到起始姿势后重新开始'
      return snapshot()
    }
    const stable = ts - zoneSince >= (zone === 'start' ? rule.minStartMs ?? Math.min(rule.minStageMs, 80) : rule.minStageMs)
    if (!armed) {
      phase = 'ready'
      if (zone === 'start' && stable) {
        armed = true
        gate = null
      } else if (!gate) gate = '请先保持起始姿势'
      return snapshot()
    }
    if (zone === 'end') {
      if (stable) reachedEnd = true
      phase = increasing() ? 'up' : 'down'
    } else if (zone === 'start' && stable) {
      if (reachedEnd && repStartedAt !== null) {
        const duration = ts - repStartedAt
        const interval = { startMs: repStartedAt, endMs: ts }
        reachedEnd = false
        repStartedAt = null
        if (duration < rule.minRepMs) {
          phase = 'ready'
          gate = '这一段太快，未计入次数'
        } else {
          count++
          lastRepMs = duration
          lastRep = interval
          phase = 'complete'
          gate = null
          return snapshot(true)
        }
      } else {
        repStartedAt = null
        phase = 'ready'
      }
    } else if (zone === 'between') {
      phase = reachedEnd ? (increasing() ? 'down' : 'up') : (increasing() ? 'up' : 'down')
    }
    return snapshot()
  }

  return {
    feed,
    interrupt,
    reset,
    setCalibratedNeutral(value) { calibratedNeutral = value },
    snapshot: () => snapshot()
  }
}
