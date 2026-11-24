import type {
  AnalysisAction,
  AnalysisView,
  MotionAnalysisFinding,
  MotionAnalysisMetric
} from '@/types/domain'
import type { GaitAnalysis, HoldAnalysis, RepAnalysis } from '@/services/motionAnalysis'
import { findingConfidence } from '@/services/motionConsistency'

export const MOTION_RULES_VERSION = 'motion-analysis-rules-v3'

export interface MotionRuleContext {
  action: AnalysisAction
  view: AnalysisView
  reps: RepAnalysis[]
  fps: number
  gait?: GaitAnalysis
  /** 静态保持型动作的测量结果 */
  hold?: HoldAnalysis
  /** detectView 的判定置信度，参与 finding 置信度推导 */
  viewConfidence?: number
}

export interface MotionRule {
  id: string
  output: 'finding' | 'metric'
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
  confidence?: number
): MotionAnalysisFinding {
  return { ruleId, title, detail, timeMs: rep.bottomMs, measured, unit, thresholdLabel, sourceLabel, ...(confidence !== undefined ? { confidence } : {}) }
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
    evaluate: ({ reps, viewConfidence }) => reps.flatMap(rep => {
      if (rep.depthOffset === null || rep.depthOffset >= 0) return []
      return [repFinding(
        rep, 'SQ-SE-01', '下蹲深度不足',
        `第 ${rep.index} 次最低点髋部没有低于膝部（髋-膝垂直差 ${round2(rep.depthOffset)}）`,
        round2(rep.depthOffset), '（归一化差值）', '最低点髋点低于膝点（≥ 0）', SQUAT_SOURCE.label,
        absoluteConfidence(rep, viewConfidence, round2(rep.depthOffset), 0, 0.3)
      )]
    })
  },
  {
    id: 'SQ-SE-02',
    output: 'finding',
    evaluate: ({ reps, viewConfidence }) => reps.flatMap(rep => {
      if (rep.bottomKneeAngle === null || (rep.bottomKneeAngle >= 70 && rep.bottomKneeAngle <= 120)) return []
      const bound = rep.bottomKneeAngle < 70 ? 70 : 120
      return [repFinding(
        rep, 'SQ-SE-02', '最低点膝角偏离参考区间',
        `第 ${rep.index} 次最低点膝角 ${rep.bottomKneeAngle}°`,
        rep.bottomKneeAngle, '°', '70°–120°', SQUAT_SOURCE.label,
        absoluteConfidence(rep, viewConfidence, rep.bottomKneeAngle, bound, 20)
      )]
    })
  },
  {
    id: 'SQ-SE-03',
    output: 'finding',
    evaluate: ({ reps, viewConfidence }) => reps.flatMap(rep => {
      if (rep.bottomTrunkAngle === null || rep.bottomTrunkAngle <= 45) return []
      return [repFinding(
        rep, 'SQ-SE-03', '躯干前倾偏大',
        `第 ${rep.index} 次最低点躯干与竖直夹角 ${rep.bottomTrunkAngle}°`,
        rep.bottomTrunkAngle, '°', '≤ 45°', SQUAT_SOURCE.label,
        absoluteConfidence(rep, viewConfidence, rep.bottomTrunkAngle, 45, 15)
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
    evaluate: ({ reps, viewConfidence }) => reps.flatMap(rep => {
      if (rep.kneeAnkleRatio === null || rep.kneeAnkleRatio >= 0.8) return []
      return [repFinding(
        rep, 'SQ-FR-01', '膝内扣',
        `第 ${rep.index} 次最低点膝间距 / 踝间距 ${round2(rep.kneeAnkleRatio)}`,
        round2(rep.kneeAnkleRatio), '（膝间/踝间）', '膝间距 / 踝间距 ≥ 0.8', VALGUS_SOURCE.label,
        absoluteConfidence(rep, viewConfidence, round2(rep.kneeAnkleRatio), 0.8, 0.2)
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
    evaluate: ({ reps, viewConfidence }) => reps.flatMap(rep => {
      if (rep.endHipAngle === null || rep.endHipAngle >= 165) return []
      return [repFinding(
        rep, 'DL-SE-03', '锁定伸髋不完整',
        `第 ${rep.index} 次动作结束时髋角 ${rep.endHipAngle}°`,
        rep.endHipAngle, '°', '锁定帧髋角 ≥ 165°', DEADLIFT_SOURCE.label,
        absoluteConfidence(rep, viewConfidence, rep.endHipAngle, 165, 15)
      )]
    })
  },
  {
    id: 'DL-SE-02',
    output: 'finding',
    evaluate: ({ reps, viewConfidence }) => reps.flatMap(rep => {
      if (rep.endTrunkAngle === null || rep.endTrunkAngle <= 15) return []
      return [repFinding(
        rep, 'DL-SE-02', '锁定姿态偏离竖直',
        `第 ${rep.index} 次动作结束时躯干与竖直夹角 ${rep.endTrunkAngle}°`,
        rep.endTrunkAngle, '°', '锁定帧躯干与竖直夹角 ≤ 15°', DEADLIFT_SOURCE.label,
        absoluteConfidence(rep, viewConfidence, rep.endTrunkAngle, 15, 10)
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
    evaluate: ({ gait }) => {
      if (!gait || gait.trunkAngle === null) return []
      const angle = Math.round(gait.trunkAngle)
      if (angle >= 3 && angle <= 15) return []
      return [{
        ruleId: 'RUN-SE-01',
        title: '躯干前倾偏离参考区间',
        detail: `全程平均躯干与竖直夹角 ${angle}°`,
        timeMs: gait.sampleTimeMs,
        measured: angle,
        unit: '°',
        thresholdLabel: '3°–15°',
        sourceLabel: RUNNING_SOURCE.label
      }]
    }
  },
  {
    id: 'RUN-SE-02',
    output: 'finding',
    evaluate: ({ gait }) => {
      if (!gait || gait.contactKneeAngle === null || gait.contactKneeAngle <= 170) return []
      return [{
        ruleId: 'RUN-SE-02',
        title: '触地瞬间膝角过伸',
        detail: `触地时平均膝角 ${Math.round(gait.contactKneeAngle)}°`,
        timeMs: gait.sampleTimeMs,
        measured: Math.round(gait.contactKneeAngle),
        unit: '°',
        thresholdLabel: '触地膝角 ≤ 170°',
        sourceLabel: RUNNING_SOURCE.label
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
    evaluate: ({ gait }) => {
      if (!gait || gait.contactKneeAnkleRatio === null || gait.contactKneeAnkleRatio >= 0.8) return []
      return [{
        ruleId: 'RUN-FR-01',
        title: '触地帧膝内扣',
        detail: `触地时膝间距 / 踝间距 ${round2(gait.contactKneeAnkleRatio)}`,
        timeMs: gait.sampleTimeMs,
        measured: round2(gait.contactKneeAnkleRatio),
        unit: '（膝间/踝间）',
        thresholdLabel: '膝间距 / 踝间距 ≥ 0.8',
        sourceLabel: VALGUS_SOURCE.label
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

const RULES_BY_ACTION: Record<string, Record<AnalysisView, MotionRule[]>> = {
  squat: { side: squatSideRules, front: squatFrontRules },
  deadlift: { side: deadliftSideRules, front: deadliftFrontRules },
  running: { side: runningSideRules, front: runningFrontRules },
  curl: { side: curlSideRules, front: curlFrontRules }
}

export function rulesFor(action: AnalysisAction, view: AnalysisView): MotionRule[] {
  return RULES_BY_ACTION[action]?.[view] ?? []
}
