// rep 间一致性规则：现有规则全是单次绝对阈值，这里补「第 N 次 vs 前几次」的组内衰减。
// 纯函数接缝：不碰 DOM、不依赖 Vue，selfcheck 可直接断言。
//
// 上限约束：服务端 boundedJsonArray 只收 20 条 finding、单条 4000 字符。
// 因此每条规则每会话只出一条聚合 finding，而不是每 rep 一条——10 次漂移会吃光配额。
import type { AnalysisAction, MotionAnalysisFinding, MotionAnalysisMetric } from '@/types/domain'
import type { MotionRule, MotionRuleContext } from '@/services/motionRules'
import type { RepAnalysis } from '@/services/motionAnalysis'

/** 项目自定义口径：一致性阈值没有文献直接支撑，如实标注，不假借 NSCA 之名 */
export const CONSISTENCY_SOURCE = '项目自定义一致性口径（组内前后对比），未经标注样本校准'

export const CONSISTENCY_THRESHOLDS = {
  /** 最低点膝角相对前序中位数变浅多少度算幅度衰减 */
  squatRomDeltaDeg: 15,
  /** 离心时长相对前序中位数偏离比例 */
  squatTempoDeltaRatio: 0.4,
  /** 锁定髋角相对前序中位数下降多少度算锁定退化 */
  deadliftLockoutDeltaDeg: 10,
  /** 至少要几次前序才做对比 */
  minPriorReps: 2
} as const

const round2 = (value: number) => Math.round(value * 100) / 100

function median(values: number[]): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
}

/**
 * 置信度 = 关键点质量 × 视角判定置信 × 越界幅度 × 基线强度。
 * 任一环缺失按保守值处理，不因为「算不出来」就当高置信。
 */
export function findingConfidence(input: {
  repVisibilityMean?: number | null
  viewConfidence?: number | null
  measured: number | null
  threshold: number
  /** 归一化尺度：越界幅度除以它再 clamp 到 [0.5, 1] */
  scale: number
  priorCount?: number
}): number {
  const quality = input.repVisibilityMean ?? 0.7
  const view = input.viewConfidence ?? 0.7
  const margin = input.measured === null || input.scale <= 0
    ? 0.5
    : Math.min(1, Math.max(0.5, Math.abs(input.measured - input.threshold) / input.scale))
  const prior = input.priorCount ?? 0
  const baseline = prior >= 4 ? 1 : prior === 3 ? 0.85 : prior >= 2 ? 0.7 : 0.5
  return round2(Math.max(0, Math.min(1, quality * view * margin * baseline)))
}

interface Drift {
  rep: RepAnalysis
  measured: number
  baselineMedian: number
  baselineMean: number
  priorCount: number
}

/** 逐次与前序中位数比较；判定用中位数抗单次异常，展示用均值符合用户预期 */
function collectDrift(
  reps: RepAnalysis[],
  read: (rep: RepAnalysis) => number | null,
  direction: 'increases' | 'decreases',
  delta: number
): Drift[] {
  const out: Drift[] = []
  for (let index = CONSISTENCY_THRESHOLDS.minPriorReps; index < reps.length; index++) {
    const measured = read(reps[index])
    if (measured === null) continue
    const prior = reps.slice(0, index).map(read).filter((value): value is number => value !== null)
    if (prior.length < CONSISTENCY_THRESHOLDS.minPriorReps) continue
    const baselineMedian = median(prior)
    const baselineMean = mean(prior)
    if (baselineMedian === null || baselineMean === null) continue
    const shift = direction === 'increases' ? measured - baselineMedian : baselineMedian - measured
    if (shift >= delta) {
      out.push({ rep: reps[index], measured, baselineMedian, baselineMean, priorCount: prior.length })
    }
  }
  return out
}

function affectedLabel(drifts: Drift[]): string {
  return drifts.map(drift => `第 ${drift.rep.index} 次`).join('、')
}

/** 聚合成一条 finding：timeMs 取首个受影响 rep 的最低点，便于关键帧定位 */
function aggregateFinding(
  ruleId: string,
  title: string,
  detail: string,
  drifts: Drift[],
  measured: number,
  unit: string,
  thresholdLabel: string,
  confidenceInput: { threshold: number; scale: number; viewConfidence?: number | null }
): MotionAnalysisFinding {
  const first = drifts[0]
  return {
    ruleId,
    title,
    detail,
    timeMs: first.rep.bottomMs,
    measured: round2(measured),
    unit,
    thresholdLabel,
    sourceLabel: CONSISTENCY_SOURCE,
    confidence: findingConfidence({
      measured,
      threshold: confidenceInput.threshold,
      scale: confidenceInput.scale,
      viewConfidence: confidenceInput.viewConfidence,
      priorCount: first.priorCount
    })
  }
}

const squatRomRule: MotionRule = {
  id: 'SQ-CN-01',
  output: 'finding',
  evaluate: ({ reps, viewConfidence }: MotionRuleContext) => {
    const drifts = collectDrift(reps, rep => rep.bottomKneeAngle, 'increases', CONSISTENCY_THRESHOLDS.squatRomDeltaDeg)
    if (!drifts.length) return []
    const first = drifts[0]
    // 需求举的旗舰形状：第 5 次最低点膝角 112°，前 4 次平均 88°，活动幅度减小
    const detail = `${affectedLabel(drifts)}最低点膝角变浅（${affectedLabel(drifts)}中首次为 ${first.measured}°，`
      + `前 ${first.priorCount} 次平均 ${Math.round(first.baselineMean)}°、中位数 ${Math.round(first.baselineMedian)}°），活动幅度减小`
    return [aggregateFinding(
      'SQ-CN-01', '组内活动幅度衰减', detail, drifts, first.measured, '°',
      `与前序中位数差 < ${CONSISTENCY_THRESHOLDS.squatRomDeltaDeg}°`,
      { threshold: first.baselineMedian, scale: CONSISTENCY_THRESHOLDS.squatRomDeltaDeg, viewConfidence }
    )]
  }
}

const squatTempoRule: MotionRule = {
  id: 'SQ-CN-02',
  output: 'finding',
  evaluate: ({ reps, viewConfidence }: MotionRuleContext) => {
    const drifts: Drift[] = []
    for (let index = CONSISTENCY_THRESHOLDS.minPriorReps; index < reps.length; index++) {
      const measured = reps[index].eccentricMs
      if (measured === null) continue
      const prior = reps.slice(0, index).map(rep => rep.eccentricMs).filter((value): value is number => value !== null)
      if (prior.length < CONSISTENCY_THRESHOLDS.minPriorReps) continue
      const baselineMedian = median(prior)
      const baselineMean = mean(prior)
      if (baselineMedian === null || baselineMean === null || baselineMedian <= 0) continue
      if (Math.abs(measured - baselineMedian) / baselineMedian >= CONSISTENCY_THRESHOLDS.squatTempoDeltaRatio) {
        drifts.push({ rep: reps[index], measured, baselineMedian, baselineMean, priorCount: prior.length })
      }
    }
    if (!drifts.length) return []
    const first = drifts[0]
    const detail = `${affectedLabel(drifts)}下蹲时长偏离前序节奏（首次 ${(first.measured / 1000).toFixed(2)} 秒，`
      + `前 ${first.priorCount} 次平均 ${(first.baselineMean / 1000).toFixed(2)} 秒）`
    return [aggregateFinding(
      'SQ-CN-02', '组内节奏一致性下降', detail, drifts, round2(first.measured / 1000), '秒',
      `与前序中位数偏离 < ${Math.round(CONSISTENCY_THRESHOLDS.squatTempoDeltaRatio * 100)}%`,
      { threshold: first.baselineMedian, scale: first.baselineMedian * CONSISTENCY_THRESHOLDS.squatTempoDeltaRatio, viewConfidence }
    )]
  }
}

const deadliftLockoutRule: MotionRule = {
  id: 'DL-CN-01',
  output: 'finding',
  evaluate: ({ reps, viewConfidence }: MotionRuleContext) => {
    const drifts = collectDrift(reps, rep => rep.endHipAngle, 'decreases', CONSISTENCY_THRESHOLDS.deadliftLockoutDeltaDeg)
    if (!drifts.length) return []
    const first = drifts[0]
    const detail = `${affectedLabel(drifts)}锁定髋角变小（首次 ${first.measured}°，`
      + `前 ${first.priorCount} 次平均 ${Math.round(first.baselineMean)}°、中位数 ${Math.round(first.baselineMedian)}°），伸髋完整度下降`
    return [aggregateFinding(
      'DL-CN-01', '组内锁定完整度下降', detail, drifts, first.measured, '°',
      `相对前序中位数下降 < ${CONSISTENCY_THRESHOLDS.deadliftLockoutDeltaDeg}°`,
      { threshold: first.baselineMedian, scale: CONSISTENCY_THRESHOLDS.deadliftLockoutDeltaDeg, viewConfidence }
    )]
  }
}

const consistencyMetricRule: MotionRule = {
  id: 'CN-METRIC',
  output: 'metric',
  evaluate: ({ reps }: MotionRuleContext) => {
    if (reps.length < 2) return []
    const knees = reps.map(rep => rep.bottomKneeAngle).filter((value): value is number => value !== null)
    const eccentric = reps.map(rep => rep.eccentricMs).filter((value): value is number => value !== null)
    const spread = (values: number[]) => values.length > 1 ? Math.max(...values) - Math.min(...values) : null
    const kneeSpread = spread(knees)
    const metrics: MotionAnalysisMetric[] = [
      { id: 'metric-rom-spread', label: '最低点膝角极差', value: kneeSpread === null ? '—' : kneeSpread, unit: '°' }
    ]
    const tempoSpread = spread(eccentric)
    if (tempoSpread !== null) {
      metrics.push({ id: 'metric-tempo-spread', label: '下蹲时长极差', value: round2(tempoSpread / 1000), unit: '秒' })
    }
    return metrics
  }
}

/** 跑步没有 per-rep 结构（步态是整片口径），v2 不做跑步一致性 */
export function consistencyRulesFor(action: AnalysisAction): MotionRule[] {
  if (action === 'squat') return [squatRomRule, squatTempoRule, consistencyMetricRule]
  if (action === 'deadlift') return [deadliftLockoutRule, consistencyMetricRule]
  return []
}