// 跨 session 长期追踪：按 action 分组（绝不按名字），按 ruleVersion 断线。
// 纯函数接缝：不碰 DOM、不依赖 Vue，selfcheck 可直接断言。
import type { AnalysisAction, MotionAnalysis, TrainingSession } from '@/types/domain'
import { findingsTemplates } from '@/services/motionTemplates'

/** 少于这么多次不给趋势结论，只说样本不足 */
export const MIN_TREND_SAMPLES = 5

export interface TrendPoint {
  id: string
  date: string
  ruleVersion: string
  /** V2：引擎版本也参与断线，避免新旧判别层趋势混算 */
  engineVersion: string
  repCount: number | null
  gaitCycles: number | null
  /** 正式关注项条数（参考观察不计入问题数）：口径随版本变化，跨版本不可直接比 */
  findingCount: number
  lowConfidence: boolean
  /** 可用帧占比；影响该点可信度 */
  usableRatio: number | null
  /** 关联训练记录的主观负荷；未记录为 null，不当 0 */
  rpe: number | null
  discomfort: boolean | null
  /** 该次跟练是否按个人起始姿势校准；与离线固定阈值口径不同，趋势里不能混比 */
  calibrated: boolean
  sessionId: string | null
}

export interface TrendSegment {
  ruleVersion: string
  engineVersion: string
  points: TrendPoint[]
}

export interface ActionTrend {
  action: AnalysisAction
  /** 按 ruleVersion 切段：口径变了就断线，绝不静默混算 */
  segments: TrendSegment[]
  totalSamples: number
  enoughSamples: boolean
  /** 同一 ruleVersion 内最近一段的首末对比 */
  latestChange: { findingCountDelta: number; repCountDelta: number | null } | null
  caveat: string | null
}

function byDateAsc(a: { date: string }, b: { date: string }): number {
  return a.date.localeCompare(b.date)
}

export function trendPoints(analyses: MotionAnalysis[], sessions: TrainingSession[]): TrendPoint[] {
  const sessionById = new Map(sessions.map(session => [session.id, session]))
  return analyses.map(analysis => {
    const session = analysis.sessionId ? sessionById.get(analysis.sessionId) : undefined
    return {
      id: analysis.id,
      date: analysis.date,
      ruleVersion: analysis.ruleVersion,
      engineVersion: analysis.engineVersion ?? analysis.ruleVersion,
      repCount: analysis.repCount,
      gaitCycles: analysis.gaitCycles,
      findingCount: analysis.findings.filter(finding => finding.level !== 'reference').length,
      lowConfidence: analysis.status === 'low-confidence',
      usableRatio: analysis.usableRatio ?? null,
      rpe: session?.rpe ?? null,
      discomfort: session ? session.discomfort : null,
      calibrated: session?.calibratedNeutral !== undefined && session?.calibratedNeutral !== null,
      sessionId: analysis.sessionId ?? null
    }
  }).sort(byDateAsc)
}

/** 相邻记录 ruleVersion 或 engineVersion 不同就开新段，图上表现为断线 */
export function segmentByVersion(points: TrendPoint[]): TrendSegment[] {
  const segments: TrendSegment[] = []
  for (const point of points) {
    const last = segments[segments.length - 1]
    if (last && last.ruleVersion === point.ruleVersion && last.engineVersion === point.engineVersion) last.points.push(point)
    else segments.push({ ruleVersion: point.ruleVersion, engineVersion: point.engineVersion, points: [point] })
  }
  return segments
}

export function buildActionTrend(action: AnalysisAction, analyses: MotionAnalysis[], sessions: TrainingSession[]): ActionTrend {
  const points = trendPoints(analyses.filter(analysis => analysis.action === action), sessions)
  const segments = segmentByVersion(points)
  const latest = segments[segments.length - 1]
  let latestChange: ActionTrend['latestChange'] = null
  if (latest && latest.points.length >= 2) {
    const first = latest.points[0]
    const last = latest.points[latest.points.length - 1]
    latestChange = {
      findingCountDelta: last.findingCount - first.findingCount,
      repCountDelta: first.repCount !== null && last.repCount !== null ? last.repCount - first.repCount : null
    }
  }
  const enoughSamples = points.length >= MIN_TREND_SAMPLES
  const caveats: string[] = []
  if (!enoughSamples) caveats.push(`样本不足（${points.length} 次，至少 ${MIN_TREND_SAMPLES} 次），不给趋势结论`)
  if (segments.length > 1) caveats.push('规则口径在此期间变更，跨版本不直接比较')
  const calibratedMix = points.some(point => point.calibrated)
  if (calibratedMix) caveats.push('部分记录关联了按个人起始姿势校准的跟练，与固定阈值分析口径不同')
  const lowQuality = points.filter(point => point.usableRatio !== null && point.usableRatio < 0.6).length
  if (lowQuality) caveats.push(`${lowQuality} 次可用帧偏少（可用率 < 60%），该点可信度较低`)
  return {
    action,
    segments,
    totalSamples: points.length,
    enoughSamples,
    latestChange,
    caveat: caveats.length ? caveats.join('；') : null
  }
}

export function buildAllTrends(analyses: MotionAnalysis[], sessions: TrainingSession[]): ActionTrend[] {
  return findingsTemplates()
    .map(template => buildActionTrend(template.id, analyses, sessions))
    .filter(trend => trend.totalSamples > 0)
}

/**
 * 组内幅度衰减反复出现 + 主观负荷偏高 → 提示关注恢复，不下营养/补剂结论。
 * 只陈述观测，不推断因果。
 */
export interface RecoveryObservation {
  action: AnalysisAction
  occurrences: number
  highRpeCount: number
  discomfortCount: number
  note: string
}

export function recoveryObservations(analyses: MotionAnalysis[], sessions: TrainingSession[]): RecoveryObservation[] {
  const sessionById = new Map(sessions.map(session => [session.id, session]))
  const out: RecoveryObservation[] = []
  for (const action of findingsTemplates().map(template => template.id)) {
    const relevant = analyses.filter(analysis => analysis.action === action
      && analysis.findings.some(finding => finding.ruleId.includes('-CN-')))
    if (!relevant.length) continue
    const linked = relevant.map(analysis => analysis.sessionId ? sessionById.get(analysis.sessionId) : undefined)
      .filter((session): session is TrainingSession => Boolean(session))
    const highRpeCount = linked.filter(session => session.rpe !== null && session.rpe >= 8).length
    const discomfortCount = linked.filter(session => session.discomfort).length
    out.push({
      action,
      occurrences: relevant.length,
      highRpeCount,
      discomfortCount,
      note: `近 ${relevant.length} 次记录出现组内一致性下降`
        + (highRpeCount ? `，其中 ${highRpeCount} 次主观负荷偏高` : '')
        + (discomfortCount ? `，${discomfortCount} 次报告不适` : '')
        + '。可结合自身感受与恢复情况调整训练节奏；这不构成疲劳诊断，也不指向任何营养或补剂结论。'
    })
  }
  return out
}