// 峰谷检测：动作分段的第一层候选事件。
// 不依赖任何动作名/绝对角度，只看信号本身的形状；阈值由调用方按运动幅度自适应传入。
// 纯函数，不做平滑（调用方先平滑再检测，便于记录实际用的口径）。

export interface PeakOptions {
  /** 找极大值还是极小值；'both' 用于需要上下都有事件的场景 */
  direction?: 'max' | 'min' | 'both'
  /** 最小显著度（与信号同单位）；低于它的起伏视为噪声 */
  minProminence?: number
  /** 相邻两个同向峰之间的最小间隔（毫秒） */
  minDistanceMs?: number
  /** 时间戳断档超过该值就切段，不跨缺口比较 */
  maxGapMs?: number
  /** 边界峰是否算数；默认 false（视频首尾多半是不完整动作） */
  includeEdges?: boolean
}

export interface Peak {
  index: number
  timeMs: number
  value: number
  prominence: number
  kind: 'max' | 'min'
}

interface Segment {
  start: number
  endExclusive: number
}

function segmentsOf(values: (number | null)[], times: number[], maxGapMs: number): Segment[] {
  const segments: Segment[] = []
  let start = -1
  for (let index = 0; index < values.length; index++) {
    const value = values[index]
    if (value === null || !Number.isFinite(value)) {
      if (start >= 0) segments.push({ start, endExclusive: index })
      start = -1
      continue
    }
    if (start < 0) {
      start = index
      continue
    }
    if (times[index] - times[index - 1] > maxGapMs) {
      segments.push({ start, endExclusive: index })
      start = index
    }
  }
  if (start >= 0) segments.push({ start, endExclusive: values.length })
  return segments
}

/** 单侧显著度：在段内向两侧走到谷底，取较浅的一侧（scipy 口径的简化版） */
function prominenceAt(values: number[], index: number, kind: 'max' | 'min', segment: Segment): number {
  const value = values[index]
  const worse = (a: number, b: number) => kind === 'max' ? Math.min(a, b) : Math.max(a, b)
  let leftBasin = value
  for (let cursor = index - 1; cursor >= segment.start; cursor--) {
    if (kind === 'max' ? values[cursor] > value : values[cursor] < value) break
    leftBasin = worse(leftBasin, values[cursor])
  }
  let rightBasin = value
  for (let cursor = index + 1; cursor < segment.endExclusive; cursor++) {
    if (kind === 'max' ? values[cursor] > value : values[cursor] < value) break
    rightBasin = worse(rightBasin, values[cursor])
  }
  const basin = kind === 'max' ? Math.max(leftBasin, rightBasin) : Math.min(leftBasin, rightBasin)
  return Math.abs(value - basin)
}

/**
 * 检测峰谷。
 * 局部极值定义：严格大于（或小于）相邻有效点；边界点默认不参与。
 */
export function findPeaks(values: (number | null)[], times: number[], options: PeakOptions = {}): Peak[] {
  const direction = options.direction ?? 'both'
  const minProminence = options.minProminence ?? 0
  const minDistanceMs = options.minDistanceMs ?? 0
  const maxGapMs = options.maxGapMs ?? 1000
  const includeEdges = options.includeEdges ?? false
  const peaks: Peak[] = []

  for (const segment of segmentsOf(values, times, maxGapMs)) {
    for (let index = segment.start; index < segment.endExclusive; index++) {
      const value = values[index] as number
      const hasLeft = index > segment.start
      const hasRight = index < segment.endExclusive - 1
      if (!includeEdges && (!hasLeft || !hasRight)) continue
      const left = hasLeft ? values[index - 1] as number : value
      const right = hasRight ? values[index + 1] as number : value
      const isMax = value > left && value > right
      const isMin = value < left && value < right
      const kind: 'max' | 'min' | null = isMax ? 'max' : isMin ? 'min' : null
      if (!kind) continue
      if (direction !== 'both' && direction !== kind) continue
      const prominence = prominenceAt(values as number[], index, kind, segment)
      if (prominence < minProminence) continue
      peaks.push({ index, timeMs: times[index], value, prominence, kind })
    }
  }

  peaks.sort((a, b) => a.timeMs - b.timeMs)
  const filtered: Peak[] = []
  for (const peak of peaks) {
    const previous = filtered[filtered.length - 1]
    if (previous && previous.timeMs === peak.timeMs) continue
    if (previous && peak.timeMs - previous.timeMs < minDistanceMs) {
      // 保留更显著的峰，抑制同一段动作里的双峰
      if (peak.prominence > previous.prominence) filtered[filtered.length - 1] = peak
      continue
    }
    filtered.push(peak)
  }
  return filtered
}

/** 取显著度最大的峰；没有峰返回 null */
export function tallestPeak(peaks: Peak[]): Peak | null {
  if (!peaks.length) return null
  return peaks.reduce((best, peak) => peak.prominence > best.prominence ? peak : best, peaks[0])
}