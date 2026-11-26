import type {
  AnalysisAction,
  AnalysisView,
  MotionAnalysisFinding,
  MotionAnalysisMetric
} from '@/types/domain'
import type { GaitAnalysis, HoldAnalysis, RepAnalysis } from '@/services/motionAnalysis'
import { findingConfidence } from '@/services/motionConsistency'

export const MOTION_RULES_VERSION = 'motion-analysis-rules-v4'

export interface MotionRuleContext {
  action: AnalysisAction
  view: AnalysisView
  reps: RepAnalysis[]
  fps: number
  gait?: GaitAnalysis
  /** 静态保持型动作的测量结果 */
  hold?: HoldAnalysis
  /** detectView/estimateView 的判定置信度，参与 finding 置信度推导与规则准入 */
  viewConfidence?: number
  /** 姿态质量（可用帧占比），低可靠时角度类关注项应被拦截 */
  poseReliability?: number
}

/** 规则准入条件：视角不符或视角/姿态可靠性不足时不生成结论（不是贴免责标签） */
export interface MotionRuleRequirement {
  views?: AnalysisView[]
  /** 视角估计可靠性下限；低于它说明机位证据不足，矢状面/冠状面角度不可解释 */
  minViewReliability?: number
  /** 姿态质量下限（可用帧占比代理） */
  minPoseReliability?: number
}

export interface MotionRule {
  id: string
  output: 'finding' | 'metric'
  /** V2：规则只在能观测到它的机位/质量下执行；不满足时记入 skippedRules */
  requires?: MotionRuleRequirement
  /**
   * 测量不确定带宽（角度为度、归一化比例为无量纲）：
   * 实测值必须超出「文献阈值 ± 带宽」才生成关注项，避免 158° 卡在 165°±10 边缘就报警。
   */
  tolerance?: number
  evaluate(context: MotionRuleContext): MotionAnalysisFinding[] | MotionAnalysisMetric[]
}

const SQUAT_SOURCE = {
  label: 'NSCA《Essentials of Strength Training and Conditioning》第4版 · 深蹲技术要点'
}
const VALGUS_SOURCE = {
  label: 'Hewett TE 等，2005，Biomechanical measures of neuromuscular control and valgus loading of the knee predict ACL injury risk（Am J Sports Med）'
}
const DEADLIFT_SOURCE = {
  label: 'NSCA《Essentials of Strength Training and Conditioning》第4版 · 硬拉技术要点'
}
const RUNNING_SOURCE = {
  label: 'Bosch & Klomp《Running: Biomechanics and Exercise Physiology in Practice》 · 跑步技术要点'
}

const round2 = (value: number) => Math.round(value * 100) / 100
const seconds = (ms: number | null) => ms === null ? '—' : round2(ms / 1000)
const average = (values: number[]) => values.length
  ? values.reduce((sum, value) => sum + value, 0) / values.length : null

function repFinding(
  rep: RepAnalysis,
  ruleId: string,
  title: string,
  detail: string,
  measured: number | null,
  unit: string,
  thresholdLabel: string,
  sourceLabel: string,
  confidence?: number,
  tolerance?: number
): MotionAnalysisFinding {
  return {
    ruleId, title, detail, timeMs: rep.bottomMs, measured, unit, thresholdLabel, sourceLabel,
    repIndex: rep.index,
    ...(confidence !== undefined ? { confidence } : {}),
    ...(tolerance !== undefined ? { tolerance } : {})
  }
}

/** 绝对阈值规则的置信度：关键点质量 × 视角置信 × 越界幅度 */
function absoluteConfidence(
  rep: RepAnalysis,
  viewConfidence: number | undefined,
  measured: number | null,
  threshold: number,
  scale: number
): number {
  return findingConfidence({
    repVisibilityMean: rep.visibilityMean,
    viewConfidence,
    measured,
    threshold,
    scale
  })
}

const squatSideRules: MotionRule[] = [
  {
    id: 'SQ-SE-01',
    output: 'finding',
    requires: { views: ['side'], minViewReliability: 0.6 },
    tolerance: 0.1,
    evaluate: ({ reps, viewConfidence }) => reps.flatMap(rep => {
      // 差值为负才像深度不足；±0.1 是单目测量的不确定带，刚好压线不报警
      if (rep.depthOffset === null || rep.depthOffset >= -0.1) return []
      return [repFinding(
        rep, 'SQ-SE-01', '下蹲深度不足',
        `第 ${rep.index} 次最低点髋部没有低于膝部（髋-膝垂直差 ${round2(rep.depthOffset)}）`,
        round2(rep.depthOffset), '（归一化差值）', '最低点髋点低于膝点（≥ 0，±0.1 容差）', SQUAT_SOURCE.label,
        absoluteConfidence(rep, viewConfidence, round2(rep.depthOffset), 0, 0.3), 0.1
      )]
    })
  },
  {
    id: 'SQ-SE-02',
    output: 'finding',
    evaluate: ({ reps, viewConfidence }) => reps.flatMap(rep => {
      if (rep.bottomKneeAngle === null || (rep.bottomKneeAngle >= 60 && rep.bottomKneeAngle <= 130)) return []
      const bound = rep.bottomKneeAngle < 60 ? 60 : 130
      return [repFinding(
        rep, 'SQ-SE-02', '最低点膝角偏离参考区间',
        `第 ${rep.index} 次最低点膝角 ${rep.bottomKneeAngle}°`,
        rep.bottomKneeAngle, '°', '60°–130°（70–120° ±10° 容差）', SQUAT_SOURCE.label,
        absoluteConfidence(rep, viewConfidence, rep.bottomKneeAngle, bound, 20), 10
      )]
    })
  },
  {
    id: 'SQ-SE-03',
    output: 'finding',
    evaluate: ({ reps, viewConfidence }) => reps.flatMap(rep => {
      if (rep.bottomTrunkAngle === null || rep.bottomTrunkAngle <= 53) return []
      return [repFinding(
        rep, 'SQ-SE-03', '躯干前倾偏大',
        `第 ${rep.index} 次最低点躯干与竖直夹角 ${rep.bottomTrunkAngle}°`,
        rep.bottomTrunkAngle, '°', '≤ 53°（45° + 8° 容差）', SQUAT_SOURCE.label,
        absoluteConfidence(rep, viewConfidence, rep.bottomTrunkAngle, 53, 15), 8
      )]
    })
  },
  {
    id: 'SQ-SE-04',
    output: 'metric',
    evaluate: ({ reps }) => {
      const eccentric = reps.map(rep => rep.eccentricMs).filter((value): value is number => value !== null)
      const hold = reps.map(rep => rep.bottomHoldMs).filter((value): value is number => value !== null)
      return [
        { id: 'metric-rep-count', label: '完整重复次数', value: reps.length },
        { id: 'metric-eccentric', label: '平均下蹲时长', value: seconds(average(eccentric)), unit: '秒' },
        { id: 'metric-bottom-hold', label: '平均底部停留', value: seconds(average(hold)), unit: '秒' }
      ]
    }
  }
]

const squatFrontRules: MotionRule[] = [
  {
    id: 'SQ-FR-01',
    output: 'finding',
    requires: { views: ['front'], minViewReliability: 0.6 },
    tolerance: 0.1,
    evaluate: ({ reps, viewConfidence }) => reps.flatMap(rep => {
      if (rep.kneeAnkleRatio === null || rep.kneeAnkleRatio >= 0.7) return []
      return [repFinding(
        rep, 'SQ-FR-01', '膝内扣',
        `第 ${rep.index} 次最低点膝间距 / 踝间距 ${round2(rep.kneeAnkleRatio)}`,
        round2(rep.kneeAnkleRatio), '（膝间/踝间）', '膝间距 / 踝间距 ≥ 0.7（0.8 − 0.1 容差）', VALGUS_SOURCE.label,
        absoluteConfidence(rep, viewConfidence, round2(rep.kneeAnkleRatio), 0.7, 0.2), 0.1
      )]
    })
  },
  {
    id: 'SQ-FR-02',
    output: 'metric',
    evaluate: ({ reps }) => {
      const diffs = reps
        .map(rep => rep.leftKneeAngle !== null && rep.rightKneeAngle !== null
          ? Math.abs(rep.leftKneeAngle - rep.rightKneeAngle) : null)
        .filter((value): value is number => value !== null)
      return [
        { id: 'metric-rep-count', label: '完整重复次数', value: reps.length },
        { id: 'metric-knee-asymmetry', label: '左右膝角差', value: average(diffs) === null ? '—' : Math.round(average(diffs)!), unit: '°' }
      ]
    }
  }
]

const deadliftSideRules: MotionRule[] = [
  {
    id: 'DL-SE-03',
    output: 'finding',
    requires: { views: ['side'], minViewReliability: 0.6 },
    tolerance: 10,
    evaluate: ({ reps, viewConfidence }) => reps.flatMap(rep => {
      // 158° 落在 165°±10° 的不确定带内：可能是测量误差，不生成关注项
      if (rep.endHipAngle === null || rep.endHipAngle >= 155) return []
      return [repFinding(
        rep, 'DL-SE-03', '锁定伸髋不完整',
        `第 ${rep.index} 次动作结束时髋角 ${rep.endHipAngle}°`,
        rep.endHipAngle, '°', '锁定帧髋角 ≥ 155°（165° − 10° 容差）', DEADLIFT_SOURCE.label,
        absoluteConfidence(rep, viewConfidence, rep.endHipAngle, 155, 15), 10
      )]
    })
  },
  {
    id: 'DL-SE-02',
    output: 'finding',
    requires: { views: ['side'], minViewReliability: 0.6 },
    tolerance: 8,
    evaluate: ({ reps, viewConfidence }) => reps.flatMap(rep => {
      if (rep.endTrunkAngle === null || rep.endTrunkAngle <= 23) return []
      return [repFinding(
        rep, 'DL-SE-02', '锁定姿态偏离竖直',
        `第 ${rep.index} 次动作结束时躯干与竖直夹角 ${rep.endTrunkAngle}°`,
        rep.endTrunkAngle, '°', '锁定帧躯干与竖直夹角 ≤ 23°（15° + 8° 容差）', DEADLIFT_SOURCE.label,
        absoluteConfidence(rep, viewConfidence, rep.endTrunkAngle, 23, 10), 8
      )]
    })
  },
  {
    id: 'DL-SE-04',
    output: 'metric',
    evaluate: ({ reps }) => {
      const trunk = reps.map(rep => rep.bottomTrunkAngle).filter((value): value is number => value !== null)
      const eccentric = reps.map(rep => rep.eccentricMs).filter((value): value is number => value !== null)
      return [
        { id: 'metric-rep-count', label: '完整重复次数', value: reps.length },
        { id: 'metric-bottom-trunk', label: '最低点躯干角', value: average(trunk) === null ? '—' : Math.round(average(trunk)!), unit: '°' },
        { id: 'metric-eccentric', label: '平均离心时长', value: seconds(average(eccentric)), unit: '秒' }
      ]
    }
  }
]

const deadliftFrontRules: MotionRule[] = [
  {
    id: 'DL-FR-01',
    output: 'metric',
    evaluate: ({ reps }) => {
      const shoulders = reps.map(rep => rep.shoulderHeightDiff).filter((value): value is number => value !== null)
      const hips = reps.map(rep => rep.hipHeightDiff).filter((value): value is number => value !== null)
      return [
        { id: 'metric-rep-count', label: '完整重复次数', value: reps.length },
        { id: 'metric-shoulder-diff', label: '双肩高度差', value: average(shoulders) === null ? '—' : round2(average(shoulders)!), unit: '（归一化）' },
        { id: 'metric-hip-diff', label: '双髋高度差', value: average(hips) === null ? '—' : round2(average(hips)!), unit: '（归一化）' }
      ]
    }
  }
]

const runningSideRules: MotionRule[] = [
  {
    id: 'RUN-SE-01',
    output: 'finding',
    requires: { views: ['side'], minViewReliability: 0.6 },
    tolerance: 8,
    evaluate: ({ gait, viewConfidence, poseReliability }) => {
      if (!gait || gait.trunkAngle === null) return []
      const angle = Math.round(gait.trunkAngle)
      // 单目躯干前倾误差约 ±8°：3°–15° 外扩后再判断，避免边界值报警
      if (angle >= -5 && angle <= 23) return []
      return [{
        ruleId: 'RUN-SE-01',
        title: '躯干前倾偏离参考区间',
        detail: `全程平均躯干与竖直夹角 ${angle}°`,
        timeMs: gait.sampleTimeMs,
        measured: angle,
        unit: '°',
        thresholdLabel: '3°–15°（±8° 容差）',
        sourceLabel: RUNNING_SOURCE.label,
        tolerance: 8,
        confidence: findingConfidence({ repVisibilityMean: poseReliability, viewConfidence, measured: angle, threshold: angle < 3 ? 3 : 15, scale: 8 })
      }]
    }
  },
  {
    id: 'RUN-SE-02',
    output: 'finding',
    requires: { views: ['side'], minViewReliability: 0.6 },
    tolerance: 5,
    evaluate: ({ gait, viewConfidence, poseReliability }) => {
      if (!gait || gait.contactKneeAngle === null || gait.contactKneeAngle <= 175) return []
      return [{
        ruleId: 'RUN-SE-02',
        title: '触地瞬间膝角过伸',
        detail: `触地时平均膝角 ${Math.round(gait.contactKneeAngle)}°`,
        timeMs: gait.sampleTimeMs,
        measured: Math.round(gait.contactKneeAngle),
        unit: '°',
        thresholdLabel: '触地膝角 ≤ 175°（170° + 5° 容差）',
        sourceLabel: RUNNING_SOURCE.label,
        tolerance: 5,
        confidence: findingConfidence({ repVisibilityMean: poseReliability, viewConfidence, measured: Math.round(gait.contactKneeAngle), threshold: 175, scale: 5 })
      }]
    }
  },
  {
    id: 'RUN-SE-03',
    output: 'metric',
    evaluate: ({ gait }) => {
      if (!gait) return []
      return [
        { id: 'metric-gait-cycles', label: '步态周期', value: gait.cycles },
        { id: 'metric-cadence', label: '步频', value: gait.cadence ?? '—', unit: '步/分' },
        { id: 'metric-contact-time', label: '触地时间（代理）', value: seconds(gait.contactTimeMs), unit: '秒' },
        { id: 'metric-contact-diff', label: '左右触地时间差（代理）', value: seconds(gait.contactTimeDiffMs), unit: '秒' },
        { id: 'metric-vertical', label: '垂直振幅（代理）', value: gait.verticalOscillation === null ? '—' : round2(gait.verticalOscillation), unit: '（髋部波动/躯干长）' }
      ]
    }
  }
]

const runningFrontRules: MotionRule[] = [
  {
    id: 'RUN-FR-01',
    output: 'finding',
    requires: { views: ['front'], minViewReliability: 0.6 },
    tolerance: 0.1,
    evaluate: ({ gait, viewConfidence, poseReliability }) => {
      if (!gait || gait.contactKneeAnkleRatio === null || gait.contactKneeAnkleRatio >= 0.7) return []
      return [{
        ruleId: 'RUN-FR-01',
        title: '触地帧膝内扣',
        detail: `触地时膝间距 / 踝间距 ${round2(gait.contactKneeAnkleRatio)}`,
        timeMs: gait.sampleTimeMs,
        measured: round2(gait.contactKneeAnkleRatio),
        unit: '（膝间/踝间）',
        thresholdLabel: '膝间距 / 踝间距 ≥ 0.7（0.8 − 0.1 容差）',
        sourceLabel: VALGUS_SOURCE.label,
        tolerance: 0.1,
        confidence: findingConfidence({ repVisibilityMean: poseReliability, viewConfidence, measured: round2(gait.contactKneeAnkleRatio), threshold: 0.7, scale: 0.2 })
      }]
    }
  },
  {
    id: 'RUN-FR-02',
    output: 'metric',
    evaluate: ({ gait }) => {
      if (!gait) return []
      return [
        { id: 'metric-shoulder-diff', label: '双肩高度差', value: gait.shoulderHeightDiff === null ? '—' : round2(gait.shoulderHeightDiff), unit: '（归一化）' },
        { id: 'metric-hip-diff', label: '双髋高度差', value: gait.hipHeightDiff === null ? '—' : round2(gait.hipHeightDiff), unit: '（归一化）' }
      ]
    }
  }
]

const numbers = (values: (number | null | undefined)[]) =>
  values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))

/**
 * 站姿弯举：只做测量，不设阈值。
 * 本项目没有可核验的弯举“标准肘角”文献，按 ADR-0003 不得进入关注项。
 */
const curlSideRules: MotionRule[] = [
  {
    id: 'CURL-SE-METRICS',
    output: 'metric',
    evaluate: ({ reps }) => {
      const rom = numbers(reps.map(rep => rep.rangeOfMotion))
      const bottoms = numbers(reps.map(rep => rep.bottomPrimaryAngle))
      // 弯举的肘角减小（bottom 之前）是举起；bottom 之后回到伸展是下放
      const lift = numbers(reps.map(rep => rep.eccentricMs))
      const lower = numbers(reps.map(rep => rep.endMs - rep.bottomMs))
      return [
        { id: 'metric-rep-count', label: '完整重复次数', value: reps.length },
        { id: 'metric-elbow-rom', label: '平均每次肘角幅度', value: average(rom) === null ? '—' : Math.round(average(rom)!), unit: '°' },
        { id: 'metric-bottom-elbow', label: '平均底部肘角', value: average(bottoms) === null ? '—' : Math.round(average(bottoms)!), unit: '°' },
        { id: 'metric-curl-lift', label: '平均举起时长', value: seconds(average(lift)), unit: '秒' },
        { id: 'metric-curl-lower', label: '平均下放时长', value: seconds(average(lower)), unit: '秒' }
      ]
    }
  }
]

const curlFrontRules: MotionRule[] = [
  {
    id: 'CURL-FR-METRICS',
    output: 'metric',
    evaluate: ({ reps }) => {
      const rom = numbers(reps.map(rep => rep.rangeOfMotion))
      const bottoms = numbers(reps.map(rep => rep.bottomPrimaryAngle))
      const diffs = numbers(reps.map(rep =>
        rep.leftPrimaryAngle != null && rep.rightPrimaryAngle != null
          ? Math.abs(rep.leftPrimaryAngle - rep.rightPrimaryAngle) : null
      ))
      const shoulders = numbers(reps.map(rep => rep.shoulderHeightDiff))
      return [
        { id: 'metric-rep-count', label: '完整重复次数', value: reps.length },
        { id: 'metric-elbow-rom', label: '平均每次肘角幅度', value: average(rom) === null ? '—' : Math.round(average(rom)!), unit: '°' },
        { id: 'metric-bottom-elbow', label: '平均底部肘角', value: average(bottoms) === null ? '—' : Math.round(average(bottoms)!), unit: '°' },
        { id: 'metric-elbow-asymmetry', label: '左右肘角差', value: average(diffs) === null ? '—' : Math.round(average(diffs)!), unit: '°' },
        { id: 'metric-shoulder-diff', label: '双肩高度差', value: average(shoulders) === null ? '—' : round2(average(shoulders)!), unit: '（归一化）' }
      ]
    }
  }
]

/**
 * 视角-规则能力矩阵：规则只在能观测到它的机位下执行。
 * 斜侧（oblique）刻意只留"测量型"规则：计数、时长、节律、相对幅度可以给，
 * 矢状面（深度/锁定/前倾）与冠状面（膝内扣/对称）的绝对角度结论一律不出。
 * 这不是"降级标注"，是根本不生成结论（ADR-0003 的证据闸门）。
 */
/**
 * 步行：只做测量，不套跑姿阈值。
 * 用户拍到快走/通勤步行时，应给步频/触地等基础节律，而不是硬判成深蹲或跑步。
 */
const walkMetricRules: MotionRule[] = [
  {
    id: 'WALK-METRICS',
    output: 'metric',
    evaluate: ({ gait }) => {
      if (!gait) return []
      return [
        { id: 'metric-gait-cycles', label: '步态周期', value: gait.cycles },
        { id: 'metric-cadence', label: '步频', value: gait.cadence ?? '—', unit: '步/分' },
        { id: 'metric-contact-time', label: '触地时间（代理）', value: seconds(gait.contactTimeMs), unit: '秒' },
        { id: 'metric-vertical', label: '垂直振幅（代理）', value: gait.verticalOscillation === null ? '—' : round2(gait.verticalOscillation), unit: '（髋部波动/躯干长）' }
      ]
    }
  }
]

const RULES_BY_ACTION: Record<string, Record<AnalysisView, MotionRule[]>> = {
  squat: { side: squatSideRules, front: squatFrontRules, oblique: [squatSideRules[3]] },
  deadlift: { side: deadliftSideRules, front: deadliftFrontRules, oblique: [deadliftSideRules[2]] },
  running: { side: runningSideRules, front: runningFrontRules, oblique: [runningSideRules[2]] },
  curl: { side: curlSideRules, front: curlFrontRules, oblique: [curlSideRules[0]] },
  walk: { side: walkMetricRules, front: walkMetricRules, oblique: walkMetricRules }
}

export function rulesFor(action: AnalysisAction, view: AnalysisView): MotionRule[] {
  return RULES_BY_ACTION[action]?.[view] ?? []
}
