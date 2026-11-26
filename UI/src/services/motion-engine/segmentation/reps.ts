// 自适应分段与计数：把"动作存在"和"动作达标"分开。
//
// V1 用写死的单关节绝对角度状态机（深蹲 172/95、硬拉 165/95）：
// 换个人、换个视角、做浅一点，就可能一次都数不出来，或者被跟踪噪声切成多次。
// V2 的做法：
// 1. 选一个物理上更稳的主信号（下肢动作优先"髋相对踝的归一化高度"，弯举用肘角）；
// 2. 用本次区间的稳健分位数（P90/P10）自适应出 neutral/bottom 与滞后带宽；
// 3. 先平滑（Savitzky–Golay）再喂共享 repMachine，计数逻辑仍只有一份；
// 4. 视频首尾不完整的单程动作单独记 partialRepetitions，不混进完整次数。
//
// 质量阈值（文献标准）仍由规则层判断，这里只负责"切出动作存在"。

import type { MotionFrame } from '@/services/motionAnalysis'
import { createRepMachine, type RepRule, type RepInterval } from '@/composables/repMachine'
import { buildMotionFeatureSeries } from '@/services/motion-engine/features/series'
import { savitzkyGolay, KINEMATICS_CONFIG } from '@/services/motionKinematics'
import { trunkAngleAt } from '@/composables/poseMath'

export type RepSignal = 'hipHeight' | 'kneeAngle' | 'hipAngle' | 'elbowAngle'

export interface PartialRepetition {
  startMs: number
  endMs: number
  /** 只有起身 / 只有下放 / 中段被遮挡 */
  kind: 'ascent-only' | 'descent-only' | 'occluded-cycle'
  signal: RepSignal
}

export interface AdaptiveRepSegmentation {
  signal: RepSignal
  rule: RepRule
  neutral: number
  bottom: number
  amplitude: number
  /** 噪声基线（MAD），用于判断幅度是否真的可测 */
  noise: number
  smoothed: number[]
  intervals: RepInterval[]
  count: number
  partials: PartialRepetition[]
  /** 自适应是否可用；false 时调用方回退模板固定阈值 */
  usable: boolean
  reason: string | null
}

export interface AdaptiveRepOptions {
  joint: 'knee' | 'hip' | 'elbow'
  pattern?: string
  minStageMs?: number
  maxStageMs?: number
  /** 低于该幅度视为没有可识别动作（信号单位随 signal 变化） */
  minAmplitude?: number
}

const SMOOTH_WINDOW_SEC = 0.35
const round2 = (value: number) => Math.round(value * 100) / 100

function percentile(values: number[], p: number): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]
}

function median(values: number[]): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** 主信号选择：动作模式决定，而不是动作名特判 */
export function signalFor(pattern: string | undefined, joint: 'knee' | 'hip' | 'elbow'): RepSignal {
  if (pattern === 'curl' || joint === 'elbow') return 'elbowAngle'
  // 真实 2D 跟踪下，髋相对踝的归一化高度在遮挡/远景/人体模型素材上噪声很大
  // （实测会出现 4.7 个躯干长这种不可能的跳变），而关节角经过平滑后仍可解释。
  // 因此默认用主关节角；hipHeight 的实现保留，等跟踪质量/3D 坐标更稳时再启用。
  return joint === 'hip' ? 'hipAngle' : 'kneeAngle'
}

/** 取原始信号；缺测保持 null，绝不插值补 0 */
function signalSeries(
  frames: MotionFrame[],
  fps: number,
  signal: RepSignal
): { values: (number | null)[]; visibility: number[]; reliability: number[] } {
  // 一次特征构建同时拿到角度与髋高，避免重复计算
  const series = buildMotionFeatureSeries(frames, fps)
  const values = signal === 'elbowAngle'
    ? series.frames.map(frame => frame.elbowAngle)
    : signal === 'hipHeight'
      ? series.frames.map(frame => frame.hipHeightNorm)
      : series.frames.map(frame => signal === 'hipAngle' ? frame.hipAngle : frame.kneeAngle)
  // 计数可见度用帧级口径（8 点均值）。三点最小值在自遮挡时会频繁掉到 0.4 以下，
  // 把已经回到起始位的完整动作挡在计数之外（实测 sumo 第二次重复就是这样丢的）。
  return {
    values,
    visibility: series.frames.map(frame => frame.visibility),
    reliability: series.frames.map(frame => frame.reliability)
  }
}

/** 平滑：与运动学引擎同一套 Savitzky–Golay 口径 */
function smoothSeries(frames: MotionFrame[], values: (number | null)[], fps: number): (number | null)[] {
  const samples = frames.map((frame, index) => ({ timeMs: frame.timeMs, value: values[index] }))
  return savitzkyGolay(samples, {
    windowSec: SMOOTH_WINDOW_SEC,
    order: 2,
    minPoints: KINEMATICS_CONFIG.minPoints,
    maxGapMs: Math.max(KINEMATICS_CONFIG.gapFloorMs, (1000 / Math.max(1, fps)) * 3)
  }).map(sample => sample.value)
}

/** 区域：neutral(高) / bottom(低)；用 ±hysteresis 形成三区 */
function zoneOf(value: number, rule: RepRule): 'start' | 'end' | 'between' {
  const midpoint = (rule.neutral + rule.bottom) / 2
  const up = rule.bottom > rule.neutral
  const low = midpoint + (up ? rule.hysteresis : -rule.hysteresis)
  const high = midpoint + (up ? -rule.hysteresis : rule.hysteresis)
  if (up) return value >= low ? 'end' : value <= high ? 'start' : 'between'
  return value <= low ? 'end' : value >= high ? 'start' : 'between'
}

/** 首尾单程动作：只起身/只下放/中段遮挡导致未完成，单独记录、不混入完整次数 */
function detectPartials(
  frames: MotionFrame[],
  smoothed: (number | null)[],
  reliability: number[],
  rule: RepRule,
  lastCountedEndMs: number | null,
  signal: RepSignal
): PartialRepetition[] {
  const partials: PartialRepetition[] = []
  const rows = frames.map((frame, index) => ({
    timeMs: frame.timeMs,
    value: smoothed[index],
    visibility: frame.visibility,
    reliability: reliability[index] ?? 0
  })).filter(row => row.value !== null && row.visibility >= 0.5) as {
    timeMs: number; value: number; visibility: number; reliability: number
  }[]
  if (rows.length < 4) return partials
  const zones = rows.map(row => zoneOf(row.value, rule))

  // 起始段：视频从底部开始，之后到达起始位（只有起身）
  if (zones[0] === 'end') {
    const startIndex = zones.findIndex(zone => zone === 'start')
    if (startIndex > 1) {
      partials.push({ startMs: rows[0].timeMs, endMs: rows[startIndex].timeMs, kind: 'ascent-only', signal })
    }
  } else if (!partials.length) {
    // 角度信号还没进"到底区"、但起始姿态明显是俯身/下蹲：视频从半程开始、后续站直，
    // 同样应记录为只有起身（例如从底部抓杠开始的硬拉示范）。
    const trunkOf = (frame: MotionFrame): number | null =>
      trunkAngleAt(frame.points.shoulder.left, frame.points.hip.left)
    const head = frames.slice(0, 8).map(frame => trunkOf(frame)).filter((value): value is number => value !== null)
    const all = frames.map(frame => trunkOf(frame)).filter((value): value is number => value !== null)
    const headMean = head.length ? head.reduce((sum, value) => sum + value, 0) / head.length : null
    const minTrunk = all.length ? Math.min(...all) : null
    if (headMean !== null && headMean >= 30 && minTrunk !== null && minTrunk <= 15) {
      const uprightIndex = frames.findIndex(frame => {
        const trunk = trunkOf(frame)
        return trunk !== null && trunk <= 15
      })
      if (uprightIndex > 0) {
        partials.push({
          startMs: frames[0].timeMs,
          endMs: frames[uprightIndex].timeMs,
          kind: 'ascent-only',
          signal
        })
      }
    }
  }

  // 结束段：最后一次计数之后（或整段没计到）是否还有"到底未回顶"的行程
  const afterMs = lastCountedEndMs ?? (frames.length ? frames[0].timeMs - 1 : 0)
  const start = rows.findIndex(row => row.timeMs > afterMs)
  if (start < 0 || rows.length - start < 4) return partials
  const tailRows = rows.slice(start)
  const tailZones = zones.slice(start)
  let topAt: number | null = null
  let episodeStart: number | null = null
  let episodeEndRun = 0
  let endRunStart: number | null = null
  let episodeGap = false
  const closeEndRun = (endMs: number) => {
    if (endRunStart !== null) {
      episodeEndRun = Math.max(episodeEndRun, endMs - endRunStart)
      endRunStart = null
    }
  }
  const flush = (endMs: number) => {
    closeEndRun(endMs)
    if (episodeStart !== null) {
      // 尾段必须真的在底部稳定停留过：跟踪噪声会制造短暂的"到底"尖峰，
      // 那种一两帧的谷不算未完成的动作。
      if (episodeGap || episodeEndRun >= 600) {
        partials.push({
          startMs: episodeStart,
          endMs,
          kind: episodeGap ? 'occluded-cycle' : 'descent-only',
          signal
        })
      }
    }
    episodeStart = null
    episodeEndRun = 0
    endRunStart = null
    episodeGap = false
  }
  for (let index = 0; index < tailRows.length; index++) {
    const row = tailRows[index]
    if (index > 0 && row.timeMs - tailRows[index - 1].timeMs > 1000) episodeGap = true
    if (tailZones[index] === 'start') {
      if (episodeStart !== null) flush(row.timeMs)
      topAt = row.timeMs
      continue
    }
    if (tailZones[index] === 'end') {
      if (episodeStart === null) episodeStart = topAt ?? row.timeMs
      if (endRunStart === null) endRunStart = row.timeMs
    } else {
      closeEndRun(row.timeMs)
    }
  }
  flush(tailRows[tailRows.length - 1].timeMs)
  return partials
}

/**
 * 自适应分段主函数。返回 usable=false 时调用方应回退到模板固定阈值，
 * 而不是把"自适应失败"当成"没有动作"。
 */
export function segmentRepsAdaptive(
  frames: MotionFrame[],
  fps: number,
  options: AdaptiveRepOptions
): AdaptiveRepSegmentation {
  const signal = signalFor(options.pattern, options.joint)
  const { values, visibility, reliability } = signalSeries(frames, fps, signal)
  const smoothed = smoothSeries(frames, values, fps)
  const ruleBase: RepRule = {
    neutral: 0,
    bottom: 0,
    hysteresis: 6,
    minStageMs: options.minStageMs ?? 200,
    minRepMs: 500,
    // 离线自适应可以给慢速示范更宽的单段预算：固定 8 秒会把慢速下放/底部调整判成"动作中断"；
    // 是否真的完成一次动作仍由"接近底部 + 回到接近顶部"把关，不靠超时。
    maxStageMs: options.maxStageMs ?? 12000,
    minVisibility: 0.4,
    maxGapMs: 1000,
    maxOcclusionMs: 1200
  }
  const empty = (reason: string): AdaptiveRepSegmentation => ({
    signal, rule: ruleBase, neutral: 0, bottom: 0, amplitude: 0, noise: 0,
    smoothed: smoothed.map(value => value ?? NaN), intervals: [], count: 0, partials: [], usable: false, reason
  })
  if (frames.length < 12) return empty('帧数不足')
  const valid = smoothed.filter((value): value is number => value !== null && Number.isFinite(value))
  if (valid.length < 10) return empty('主信号缺测过多')

  const p90 = percentile(valid, 0.9)
  const p10 = percentile(valid, 0.1)
  const mid = median(valid)
  if (p90 === null || p10 === null || mid === null) return empty('分位数不可测')
  const amplitude = p90 - p10
  const deviations = valid.map(value => Math.abs(value - mid))
  const mad = median(deviations) ?? 0
  const minAmplitude = options.minAmplitude ?? (signal === 'hipHeight' ? 0.18 : 18)
  if (amplitude < minAmplitude) return empty(`运动幅度不足（${round2(amplitude)} < ${minAmplitude}）`)
  if (mad > amplitude * 0.6) return empty('噪声相对幅度过大')

  const neutral = p90
  const bottom = p10
  const rule: RepRule = {
    ...ruleBase,
    neutral,
    bottom,
    // 滞后带宽按信号单位：髋高是「躯干长」量纲（约 0–1.5），角度是度。
    // 取幅度的 25%：只看"越过中点"会把跟踪抖动当成一次完整往返，
    // 必须真的接近底部再回到接近顶部才算一次。
    hysteresis: signal === 'hipHeight'
      ? Math.max(0.03, amplitude * 0.25)
      : signal === 'elbowAngle'
        // 上肢动作幅度大、跟踪相对干净，窄带回差就够；25% 会把快速弯举的最后一次吃掉
        ? Math.max(5, amplitude * 0.12)
        : Math.max(8, amplitude * 0.25),
    // 自适应信号已经平滑过，起始位确认可以比实时更短，避免视频结尾的完整动作被丢掉
    minStartMs: 50
  }

  // 先平滑再喂共享状态机：只换信号与阈值，计数语义（回到底部再回到起始位）不变
  const machine = createRepMachine(rule)
  const intervals: RepInterval[] = []
  for (let index = 0; index < frames.length; index++) {
    const value = smoothed[index]
    const snapshot = machine.feed(value, visibility[index] ?? 0, frames[index].timeMs)
    if (snapshot.counted && snapshot.lastRep) intervals.push(snapshot.lastRep)
  }
  const count = machine.snapshot().count
  const partials = detectPartials(frames, smoothed, reliability, rule, intervals.length ? intervals[intervals.length - 1].endMs : null, signal)

  return {
    signal,
    rule,
    neutral: round2(neutral),
    bottom: round2(bottom),
    amplitude: round2(amplitude),
    noise: round2(mad),
    smoothed: smoothed.map(value => value ?? NaN),
    intervals,
    count,
    partials,
    usable: true,
    reason: null
  }
}