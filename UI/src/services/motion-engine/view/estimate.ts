// 视角估计 V2：多证据空间方向估计。
// V1 只用 max(肩宽, 髋宽)/躯干高 这一个 2D 投影比例，且没做画面宽高比校正，
// 横竖屏/距离/转身都会把它带偏（真实素材上同一个"正面"能测出 0.42 到 1.2）。
//
// V2 的证据：
// 1. 直立帧（站直、膝角接近伸直）上的宽高比校正投影比：x 方向按画面宽高比缩放；
// 2. 远侧关节可见度差：侧拍时远端肩/髋/膝会被身体挡住；
// 3. 肩部 x 顺序翻转率：正面/背向应稳定，侧拍时左右肩在投影里反复交叉；
// 4. 逐区间估计：用户中途转身时按时间分段，而不是全片一个机位。
//
// 输出连续量 + 离散类别 + 可靠性；类别 unknown 是合法结果，不硬猜。
// reliability 是质量分数，不是"正确概率"，未经校准不得当概率对外展示。

import type { MotionFrame, MotionPoint } from '@/services/motionAnalysis'
import { angleAtExact } from '@/composables/poseMath'
import type { EngineView, ViewEstimate, ViewEvidence, ViewSegment } from '@/services/motion-engine/core/types'

/** 分档常量：用 7 条真实素材做过宽高比校正后校准，仍需更多标注样本复核 */
export const VIEW_THRESHOLDS = {
  /** 宽高比校正后的 肩(髋)宽/躯干高：≤ 该值判侧面 */
  sideMaxRatio: 0.22,
  /** ≥ 该值判正面/背面 */
  frontMinRatio: 0.58,
  /** 正面但远侧可见度差很大时降级为斜侧的阈值 */
  frontToObliqueGap: 0.16,
  /** 估计"正面"的参考投影比：用来反推 yaw；未经 mocap 校准，只作连续量 */
  frontReferenceRatio: 0.82,
  /** 直立帧最少条数；不足则 unknown */
  minUprightFrames: 6,
  /** 直立帧选取：躯干高度取前 20%，膝角 > 该值 */
  uprightTorsoPercentile: 0.8,
  uprightMinKneeAngle: 150,
  /** 逐区间估计的窗口长度 */
  segmentWindowMs: 2000,
  /** 区间内至少几条直立帧才给该区间定类 */
  segmentMinUprightFrames: 2
} as const

export interface ViewEstimateOptions {
  /** 画面宽高比（width / height）；缺省时用帧上携带的 aspect，再缺省按 16:9 */
  aspect?: number
  /** 逐帧特征缺失时的兜底宽高比 */
  defaultAspect?: number
}

interface FrameMetrics {
  timeMs: number
  visibility: number
  torsoHeight: number | null
  /** 宽高比校正后的 max(肩宽, 髋宽)/躯干高 */
  ratio: number | null
  /** 远侧可见度差（肩/髋/膝平均） */
  farGap: number
  shoulderSign: number
  kneeAngle: number | null
}

function finite(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function midpoint(a: MotionPoint | null, b: MotionPoint | null): { x: number; y: number } | null {
  if (!a || !b || !finite(a.x) || !finite(a.y) || !finite(b.x) || !finite(b.y)) return null
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

function median(values: number[]): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function percentile(values: number[], p: number): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function kneeAngleOf(frame: MotionFrame): number | null {
  const side = (frame.points.knee.left && frame.points.knee.right)
    ? (frame.points.knee.left.visibility >= frame.points.knee.right.visibility ? 'left' : 'right') as 'left' | 'right'
    : 'left'
  const hip = frame.points.hip[side]
  const knee = frame.points.knee[side]
  const ankle = frame.points.ankle[side]
  if (!hip || !knee || !ankle) return null
  return angleAtExact(hip, knee, ankle)
}

function measureFrame(frame: MotionFrame, aspect: number): FrameMetrics {
  const shoulderMid = midpoint(frame.points.shoulder.left, frame.points.shoulder.right)
  const hipMid = midpoint(frame.points.hip.left, frame.points.hip.right)
  const shoulderSep = frame.points.shoulder.left && frame.points.shoulder.right
    ? Math.abs(frame.points.shoulder.left.x - frame.points.shoulder.right.x) * aspect : null
  const hipSep = frame.points.hip.left && frame.points.hip.right
    ? Math.abs(frame.points.hip.left.x - frame.points.hip.right.x) * aspect : null
  const torsoHeight = shoulderMid && hipMid ? Math.abs(hipMid.y - shoulderMid.y) : null
  const ratio = torsoHeight !== null && torsoHeight > 0.04 && shoulderSep !== null && hipSep !== null
    ? Math.max(shoulderSep, hipSep) / torsoHeight : null
  const visPair = (left: MotionPoint | null, right: MotionPoint | null) =>
    finite(left?.visibility) && finite(right?.visibility) ? Math.abs(left!.visibility - right!.visibility) : null
  const gaps = [
    visPair(frame.points.shoulder.left, frame.points.shoulder.right),
    visPair(frame.points.hip.left, frame.points.hip.right),
    visPair(frame.points.knee.left, frame.points.knee.right)
  ].filter((value): value is number => value !== null)
  const farGap = gaps.length ? gaps.reduce((sum, value) => sum + value, 0) / gaps.length : 0
  const shoulderSign = frame.points.shoulder.left && frame.points.shoulder.right
    ? Math.sign(frame.points.shoulder.left.x - frame.points.shoulder.right.x) : 0
  return {
    timeMs: frame.timeMs,
    visibility: finite(frame.visibility) ? frame.visibility : 0,
    torsoHeight,
    ratio,
    farGap,
    shoulderSign,
    kneeAngle: kneeAngleOf(frame)
  }
}

function categoryFromRatio(ratio: number, farGap: number): EngineView {
  if (ratio <= VIEW_THRESHOLDS.sideMaxRatio) return 'side'
  if (ratio >= VIEW_THRESHOLDS.frontMinRatio) {
    // 正面/背向的投影比很大；若远侧遮挡明显，说明身体已转过去
    if (farGap >= VIEW_THRESHOLDS.frontToObliqueGap && ratio < VIEW_THRESHOLDS.frontReferenceRatio) return 'oblique'
    return 'front'
  }
  return 'oblique'
}

function yawFromRatio(ratio: number | null): number | null {
  if (ratio === null) return null
  const cos = Math.max(-1, Math.min(1, ratio / VIEW_THRESHOLDS.frontReferenceRatio))
  // 2D 投影无法区分正面与背面，只给"偏离相机光轴"的角度
  return Math.round((Math.acos(cos) * 180) / Math.PI)
}

function observabilityFor(category: EngineView, reliability: number): Record<string, number> {
  const geometric: Record<EngineView, { sagittal: number; frontal: number; rhythm: number }> = {
    side: { sagittal: 0.95, frontal: 0.12, rhythm: 0.95 },
    front: { sagittal: 0.12, frontal: 0.95, rhythm: 0.95 },
    oblique: { sagittal: 0.45, frontal: 0.45, rhythm: 0.95 },
    unknown: { sagittal: 0.2, frontal: 0.2, rhythm: 0.7 }
  }
  const base = geometric[category]
  const poseFactor = 0.5 + 0.5 * clamp01(reliability)
  const round2 = (value: number) => Math.round(clamp01(value) * 100) / 100
  return {
    sagittalAngles: round2(base.sagittal * poseFactor),
    frontalAngles: round2(base.frontal * poseFactor),
    rhythm: round2(base.rhythm * poseFactor),
    gaitEvents: round2(0.9 * poseFactor),
    holdDuration: round2(0.85 * poseFactor)
  }
}

/** 逐区间视角：按 2s 窗口给每段定类，同一类别相邻段合并 */
function buildSegments(upright: FrameMetrics[], durationMs: number): ViewSegment[] {
  const windowMs = VIEW_THRESHOLDS.segmentWindowMs
  const segments: ViewSegment[] = []
  if (durationMs <= 0) return segments
  for (let start = 0; start < durationMs; start += windowMs) {
    const end = Math.min(durationMs, start + windowMs)
    const rows = upright.filter(frame => frame.timeMs >= start && frame.timeMs < end)
    let category: EngineView = 'unknown'
    let reliability = 0
    if (rows.length >= VIEW_THRESHOLDS.segmentMinUprightFrames) {
      const ratios = rows.map(row => row.ratio).filter((value): value is number => value !== null)
      const gaps = rows.map(row => row.farGap)
      const ratio = median(ratios)
      if (ratio !== null) {
        category = categoryFromRatio(ratio, median(gaps) ?? 0)
        const sorted = [...ratios].sort((a, b) => a - b)
        const iqr = sorted[Math.floor(sorted.length * 0.75)] - sorted[Math.floor(sorted.length * 0.25)]
        reliability = Math.round(clamp01(0.5 + 0.3 * Math.min(1, rows.length / 8) - 0.4 * Math.min(1, iqr / 0.3)) * 100) / 100
      }
    }
    const previous = segments[segments.length - 1]
    if (previous && previous.category === category) {
      previous.endMs = end
      previous.reliability = Math.max(previous.reliability, reliability)
      continue
    }
    segments.push({ startMs: start, endMs: end, category, reliability })
  }
  // 片段太碎时（每秒都翻转）视为不稳定：保留但把 reliability 压低
  const flips = segments.reduce((count, segment, index) =>
    index > 0 && segment.category !== segments[index - 1].category ? count + 1 : count, 0)
  if (flips > Math.max(3, segments.length / 2)) {
    for (const segment of segments) segment.reliability = Math.round(segment.reliability * 0.5 * 100) / 100
  }
  return segments
}

/**
 * 估计拍摄视角与可观测性。
 * @param frames 分析帧（建议用活跃区间精扫帧；粗扫帧也可）
 * @param fps 帧率（仅用于兜底，当前实现按时间戳工作）
 */
export function estimateView(frames: MotionFrame[], fps: number, options: ViewEstimateOptions = {}): ViewEstimate {
  void fps
  const aspect = options.aspect ?? frames.find(frame => finite(frame.aspect))?.aspect ?? options.defaultAspect ?? 16 / 9
  const safeAspect = finite(aspect) && aspect > 0 ? aspect : 16 / 9
  const metrics = frames.map(frame => measureFrame(frame, safeAspect))
  const valid = metrics.filter(frame => frame.torsoHeight !== null && frame.torsoHeight > 0.04 && frame.visibility >= 0.5)
  const durationMs = frames.length > 1 ? frames[frames.length - 1].timeMs - frames[0].timeMs : 0
  const heights = valid.map(frame => frame.torsoHeight as number)
  const torsoThreshold = percentile(heights, VIEW_THRESHOLDS.uprightTorsoPercentile) ?? 0
  const upright = valid.filter(frame =>
    (frame.torsoHeight as number) >= torsoThreshold
    && frame.kneeAngle !== null && frame.kneeAngle >= VIEW_THRESHOLDS.uprightMinKneeAngle)
  const ratioValues = upright.map(frame => frame.ratio).filter((value): value is number => value !== null)
  const ratioMedian = median(ratioValues)
  const gaps = upright.map(frame => frame.farGap)
  const gapMedian = median(gaps)
  const visibilities = upright.map(frame => frame.visibility)
  const meanVisibility = visibilities.length
    ? visibilities.reduce((sum, value) => sum + value, 0) / visibilities.length : 0

  const problems: string[] = []
  if (upright.length < VIEW_THRESHOLDS.minUprightFrames) problems.push('直立帧不足，无法可靠判定机位')
  if (ratioMedian === null) problems.push('投影比不可测（躯干/肩髋点缺失）')

  let category: EngineView = 'unknown'
  let reliability = 0
  let temporalStability = 0
  if (upright.length >= VIEW_THRESHOLDS.minUprightFrames && ratioMedian !== null) {
    category = categoryFromRatio(ratioMedian, gapMedian ?? 0)
    const sorted = [...ratioValues].sort((a, b) => a - b)
    const iqr = sorted[Math.floor(sorted.length * 0.75)] - sorted[Math.floor(sorted.length * 0.25)]
    const spread = ratioMedian > 0 ? iqr / ratioMedian : 1
    temporalStability = Math.round(clamp01(1 - spread) * 100) / 100
    const countScore = Math.min(1, upright.length / 15)
    reliability = Math.round(clamp01(0.4 * countScore + 0.35 * temporalStability + 0.25 * meanVisibility) * 100) / 100
  }
  // 肩部顺序翻转率：正面/背向应接近 0；侧拍时左右肩在投影里反复交叉。
  // 这里只作为证据记录；不直接改类别（低帧率下会低估翻转）。
  let crossings = 0
  for (let index = 1; index < upright.length; index++) {
    if (upright[index].shoulderSign === 0 || upright[index - 1].shoulderSign === 0) continue
    if (upright[index].shoulderSign !== upright[index - 1].shoulderSign) crossings++
  }

  const evidence: ViewEvidence = {
    uprightFrames: upright.length,
    medianSeparationRatio: ratioMedian === null ? null : Math.round(ratioMedian * 1000) / 1000,
    medianFarSideVisibilityGap: gapMedian === null ? null : Math.round(gapMedian * 1000) / 1000,
    shoulderCrossings: crossings,
    worldYawDeg: null,
    problems
  }

  return {
    category,
    // 即使整体证据不足（unknown），只要投影比可测就给一个连续提示；
    // 界面可以用它做"就近建议"，但不会把 unknown 当成判定结果。
    yawDeg: yawFromRatio(ratioMedian),
    reliability,
    temporalStability,
    segments: buildSegments(upright, durationMs),
    observability: observabilityFor(category, reliability),
    evidence
  }
}

/** 视角类别的中文/机器标签相互转换；未知返回 null */
export function viewToAnalysisView(category: EngineView): 'side' | 'front' | 'oblique' | null {
  return category === 'side' || category === 'front' || category === 'oblique' ? category : null
}

/** 判不准时按 yaw/投影比给"就近建议"，只用于界面预选 */
export function suggestedViewFromEstimate(estimate: ViewEstimate): 'side' | 'front' | 'oblique' | null {
  if (estimate.yawDeg === null) return null
  if (estimate.yawDeg <= 30) return 'front'
  if (estimate.yawDeg >= 65) return 'side'
  return 'oblique'
}