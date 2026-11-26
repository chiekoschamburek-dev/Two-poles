// 时序相关性工具：左右交替性、周期性、相位差都靠它。
// 步态判定不再用"步频 ≥ 140"硬门槛，改用左右踝垂直信号的负相关 + 交替触地次数。
// 纯函数，输入等长索引序列，缺测用 null 表示并跳过。

/** 成对有效样本的相关系数；样本不足或方差为 0 返回 null */
export function pearson(a: (number | null)[], b: (number | null)[]): number | null {
  const xs: number[] = []
  const ys: number[] = []
  const length = Math.min(a.length, b.length)
  for (let index = 0; index < length; index++) {
    const x = a[index]
    const y = b[index]
    if (x === null || y === null || !Number.isFinite(x) || !Number.isFinite(y)) continue
    xs.push(x)
    ys.push(y)
  }
  if (xs.length < 3) return null
  const meanX = xs.reduce((sum, value) => sum + value, 0) / xs.length
  const meanY = ys.reduce((sum, value) => sum + value, 0) / ys.length
  let covariance = 0
  let varianceX = 0
  let varianceY = 0
  for (let index = 0; index < xs.length; index++) {
    const dx = xs[index] - meanX
    const dy = ys[index] - meanY
    covariance += dx * dy
    varianceX += dx * dx
    varianceY += dy * dy
  }
  const denominator = Math.sqrt(varianceX * varianceY)
  if (denominator < 1e-9) return null
  return Math.max(-1, Math.min(1, covariance / denominator))
}

/**
 * 滞后相关：步态里左右腿的相位差不是整数帧，最大相关不一定在 lag=0。
 * 返回 |r| 最大且 r<0 的滞后（用于交替性）；没有负相关时返回 0 滞后。
 */
export function laggedAlternation(a: (number | null)[], b: (number | null)[], maxLag = 8): { lag: number; r: number | null } {
  let best: { lag: number; r: number | null } = { lag: 0, r: pearson(a, b) }
  for (let lag = 1; lag <= maxLag; lag++) {
    const shiftedA = a.slice(lag)
    const shiftedB = b.slice(0, b.length - lag)
    const r = pearson(shiftedA, shiftedB)
    if (r !== null && (best.r === null || r < best.r)) best = { lag, r }
  }
  return best
}

/** 自相关（按帧滞后）：周期性动作在基频整数倍处出现峰 */
export function autocorrelation(values: (number | null)[], maxLag = 60): { lag: number; r: number | null }[] {
  const out: { lag: number; r: number | null }[] = []
  for (let lag = 1; lag <= maxLag; lag++) {
    out.push({ lag, r: pearson(values.slice(lag), values.slice(0, values.length - lag)) })
  }
  return out
}

/** 序列跨过中位数的次数：步态周期计数、静止/运动区分都用得上 */
export function zeroCrossings(values: (number | null)[]): number {
  const valid = values.filter((value): value is number => value !== null && Number.isFinite(value))
  if (valid.length < 2) return 0
  const sorted = [...valid].sort((x, y) => x - y)
  const mid = sorted.length % 2 ? sorted[Math.floor(sorted.length / 2)] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
  let crossings = 0
  let previousSign = 0
  for (const value of values) {
    if (value === null || !Number.isFinite(value)) continue
    const sign = value > mid ? 1 : value < mid ? -1 : 0
    if (sign !== 0 && previousSign !== 0 && sign !== previousSign) crossings++
    if (sign !== 0) previousSign = sign
  }
  return crossings
}

/** 相关系数的粗略判断阈值集中放在一处，便于后续用真值校准 */
export const CORRELATION_THRESHOLDS = {
  /** 左右肢体的负相关上限：低于它才算交替（步态） */
  alternationMaxR: -0.35,
  /** 双侧同步动作的同相相关下限 */
  synchronyMinR: 0.5,
  /** 周期性自相关峰下限 */
  periodicityMinR: 0.45
} as const