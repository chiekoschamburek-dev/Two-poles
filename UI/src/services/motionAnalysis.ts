// 视频动作分析的纯函数接缝：不碰 DOM、不依赖 Vue，selfcheck 可直接断言。
import type { NormalizedLandmark } from '@mediapipe/tasks-vision'
import type {
  AnalysisAction,
  AnalysisView,
  MotionAnalysisFinding,
  MotionAnalysisMetric,
  MotionAnalysisResult,
  MotionPrecheckResult
} from '@/types/domain'
import { createRepMachine } from '@/composables/repMachine'
import type { RepInterval, RepRule } from '@/composables/repMachine'
import { rulesFor } from '@/services/motionRules'

export interface MotionPoint {
  x: number
  y: number
  visibility: number
}

export interface MotionFrame {
  timeMs: number
  /** 八点核心关节的平均可见度，用于预检与低置信度判定 */
  visibility: number
  points: {
    shoulder: { left: MotionPoint | null; right: MotionPoint | null }
    hip: { left: MotionPoint | null; right: MotionPoint | null }
    knee: { left: MotionPoint | null; right: MotionPoint | null }
    ankle: { left: MotionPoint | null; right: MotionPoint | null }
    heel: { left: MotionPoint | null; right: MotionPoint | null }
    toe: { left: MotionPoint | null; right: MotionPoint | null }
  }
}

export interface MotionFramesInput {
  action: AnalysisAction
  fps: number
  frames: MotionFrame[]
}

export interface MotionFrameSeries extends MotionFramesInput {
  view: AnalysisView
}

export interface RepAnalysis {
  index: number
  startMs: number
  endMs: number
  bottomMs: number
  bottomKneeAngle: number | null
  bottomHipAngle: number | null
  bottomTrunkAngle: number | null
  endKneeAngle: number | null
  endHipAngle: number | null
  endTrunkAngle: number | null
  /** 髋点相对膝点的垂直差，按躯干长度归一化；正值表示髋在膝下 */
  depthOffset: number | null
  leftKneeAngle: number | null
  rightKneeAngle: number | null
  /** 正面：底部膝间距 / 踝间距；越小越像膝内扣 */
  kneeAnkleRatio: number | null
  shoulderHeightDiff: number | null
  hipHeightDiff: number | null
  eccentricMs: number | null
  bottomHoldMs: number | null
}

export interface GaitAnalysis {
  footStrikes: number
  cycles: number
  cadence: number | null
  contactTimeMs: number | null
  contactTimeDiffMs: number | null
  contactKneeAngle: number | null
  contactKneeAnkleRatio: number | null
  shoulderHeightDiff: number | null
  hipHeightDiff: number | null
  trunkAngle: number | null
  verticalOscillation: number | null
  durationSec: number
  /** 左右脚交替触地且间隔合理；用于区分跑步与双脚同时起落的动作 */
  alternating: boolean
  /** 首个触地或中间帧，供关键帧与结果定位使用 */
  sampleTimeMs: number | null
}

export const MIN_FRAME_VISIBILITY = 0.5
const SIDE_MAX_RATIO = 0.28
const FRONT_MIN_RATIO = 0.42
const FINDINGS_LIMIT = 20
const METRICS_LIMIT = 30

const SQUAT_REP_RULE: RepRule = {
  neutral: 172, bottom: 95, hysteresis: 8, minStageMs: 200,
  minRepMs: 500, maxStageMs: 8000, minVisibility: MIN_FRAME_VISIBILITY
}
const DEADLIFT_REP_RULE: RepRule = {
  neutral: 165, bottom: 95, hysteresis: 8, minStageMs: 200,
  minRepMs: 500, maxStageMs: 8000, minVisibility: MIN_FRAME_VISIBILITY
}

const LANDMARKS = {
  shoulder: { left: 11, right: 12 },
  hip: { left: 23, right: 24 },
  knee: { left: 25, right: 26 },
  ankle: { left: 27, right: 28 },
  heel: { left: 29, right: 30 },
  toe: { left: 31, right: 32 }
} as const

const CORE_INDICES = [11, 12, 23, 24, 25, 26, 27, 28]

function clampVisibility(value: unknown): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value as number)) : 0
}

function readPoint(landmarks: NormalizedLandmark[], index: number): MotionPoint | null {
  const landmark = landmarks[index]
  if (!landmark || !Number.isFinite(landmark.x) || !Number.isFinite(landmark.y)) return null
  return { x: landmark.x, y: landmark.y, visibility: clampVisibility(landmark.visibility) }
}

function angleAt(a: MotionPoint, vertex: MotionPoint, b: MotionPoint): number | null {
  const v1x = a.x - vertex.x
  const v1y = a.y - vertex.y
  const v2x = b.x - vertex.x
  const v2y = b.y - vertex.y
  const magnitude = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y)
  if (!magnitude) return null
  const cos = Math.min(1, Math.max(-1, (v1x * v2x + v1y * v2y) / magnitude))
  return Math.round((Math.acos(cos) * 180) / Math.PI)
}

function midpoint(a: MotionPoint | null, b: MotionPoint | null): MotionPoint | null {
  if (!a || !b) return null
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, visibility: Math.min(a.visibility, b.visibility) }
}

function trunkAngle(shoulder: MotionPoint | null, hip: MotionPoint | null): number | null {
  if (!shoulder || !hip) return null
  const dx = shoulder.x - hip.x
  const dy = hip.y - shoulder.y
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null
  if (dx === 0 && dy === 0) return null
  return Math.round((Math.atan2(Math.abs(dx), Math.max(0, dy)) * 180) / Math.PI)
}

function sideJointPoint(frame: MotionFrame, joint: 'knee' | 'hip'): { point: MotionPoint; side: 'left' | 'right' } | null {
  const left = frame.points[joint].left
  const right = frame.points[joint].right
  if (!left && !right) return null
  if (!left) return { point: right!, side: 'right' }
  if (!right) return { point: left, side: 'left' }
  return right.visibility > left.visibility ? { point: right, side: 'right' } : { point: left, side: 'left' }
}

function jointAngle(frame: MotionFrame, joint: 'knee' | 'hip'): { angle: number | null; visibility: number } {
  const side = sideJointPoint(frame, joint)?.side ?? 'left'
  const hip = frame.points.hip[side]
  const knee = frame.points.knee[side]
  const ankle = frame.points.ankle[side]
  const shoulder = frame.points.shoulder[side]
  if (!hip || !knee || !ankle) return { angle: null, visibility: 0 }
  const angle = joint === 'knee' ? angleAt(hip, knee, ankle) : shoulder ? angleAt(shoulder, hip, knee) : null
  const visibility = Math.min(hip.visibility, knee.visibility, joint === 'knee' ? ankle.visibility : shoulder?.visibility ?? 0)
  return { angle, visibility }
}

export function extractMotionFrame(landmarks: NormalizedLandmark[], timeMs: number): MotionFrame {
  const point = (joint: keyof typeof LANDMARKS, side: 'left' | 'right') => readPoint(landmarks, LANDMARKS[joint][side])
  const visibility = CORE_INDICES.reduce((sum, index) => sum + clampVisibility(landmarks[index]?.visibility), 0) / CORE_INDICES.length
  return {
    timeMs,
    visibility,
    points: {
      shoulder: { left: point('shoulder', 'left'), right: point('shoulder', 'right') },
      hip: { left: point('hip', 'left'), right: point('hip', 'right') },
      knee: { left: point('knee', 'left'), right: point('knee', 'right') },
      ankle: { left: point('ankle', 'left'), right: point('ankle', 'right') },
      heel: { left: point('heel', 'left'), right: point('heel', 'right') },
      toe: { left: point('toe', 'left'), right: point('toe', 'right') }
    }
  }
}

/** 侧面时左右肩/髋几乎重合，正面时明显分开；用分离度/躯干高度判断。 */
export function detectView(frames: MotionFrame[]): { view: AnalysisView | null; confidence: number } {
  const ratios: number[] = []
  for (const frame of frames) {
    const { shoulder, hip } = frame.points
    if (!shoulder.left || !shoulder.right || !hip.left || !hip.right) continue
    const shoulderSep = Math.abs(shoulder.left.x - shoulder.right.x)
    const hipSep = Math.abs(hip.left.x - hip.right.x)
    const torso = (Math.abs(shoulder.left.y - hip.left.y) + Math.abs(shoulder.right.y - hip.right.y)) / 2
    if (!Number.isFinite(torso) || torso < 0.05) continue
    ratios.push(Math.max(shoulderSep, hipSep) / torso)
  }
  if (ratios.length < 5) return { view: null, confidence: 0 }
  ratios.sort((a, b) => a - b)
  const median = ratios[Math.floor(ratios.length / 2)]
  if (median <= SIDE_MAX_RATIO) return { view: 'side', confidence: Math.min(1, 1 - median / SIDE_MAX_RATIO) }
  if (median >= FRONT_MIN_RATIO) return { view: 'front', confidence: Math.min(1, (median - FRONT_MIN_RATIO) / 0.35) }
  return { view: null, confidence: 0 }
}

function segmentReps(frames: MotionFrame[], action: AnalysisAction): { intervals: RepInterval[]; count: number } {
  const machine = createRepMachine(action === 'deadlift' ? DEADLIFT_REP_RULE : SQUAT_REP_RULE)
  const intervals: RepInterval[] = []
  for (const frame of frames) {
    const sample = jointAngle(frame, action === 'deadlift' ? 'hip' : 'knee')
    const snapshot = machine.feed(sample.angle, sample.visibility, frame.timeMs)
    if (snapshot.counted && snapshot.lastRep) intervals.push(snapshot.lastRep)
  }
  return { intervals, count: machine.snapshot().count }
}

function analyzeRep(frames: MotionFrame[], interval: RepInterval, index: number, fps: number, action: AnalysisAction): RepAnalysis {
  const repFrames = frames.filter(frame => frame.timeMs >= interval.startMs && frame.timeMs <= interval.endMs)
  let bottomFrame: MotionFrame | null = null
  let bottomAngle: number | null = null
  for (const frame of repFrames) {
    const sample = jointAngle(frame, action === 'deadlift' ? 'hip' : 'knee')
    if (sample.angle === null) continue
    if (bottomAngle === null || sample.angle < bottomAngle) {
      bottomAngle = sample.angle
      bottomFrame = frame
    }
  }
  if (!bottomFrame) {
    return {
      index, startMs: interval.startMs, endMs: interval.endMs, bottomMs: interval.endMs,
      bottomKneeAngle: null, bottomHipAngle: null, bottomTrunkAngle: null,
      endKneeAngle: null, endHipAngle: null, endTrunkAngle: null,
      depthOffset: null, leftKneeAngle: null, rightKneeAngle: null, kneeAnkleRatio: null,
      shoulderHeightDiff: null, hipHeightDiff: null, eccentricMs: null, bottomHoldMs: null
    }
  }
  const endFrame = repFrames[repFrames.length - 1] ?? bottomFrame
  const endKnee = jointAngle(endFrame, 'knee')
  const endHip = jointAngle(endFrame, 'hip')
  const endSide = sideJointPoint(endFrame, 'knee')?.side ?? 'left'
  const endTrunk = trunkAngle(endFrame.points.shoulder[endSide], endFrame.points.hip[endSide])
  const leftKnee = bottomFrame.points.hip.left && bottomFrame.points.knee.left && bottomFrame.points.ankle.left
    ? angleAt(bottomFrame.points.hip.left, bottomFrame.points.knee.left, bottomFrame.points.ankle.left) : null
  const rightKnee = bottomFrame.points.hip.right && bottomFrame.points.knee.right && bottomFrame.points.ankle.right
    ? angleAt(bottomFrame.points.hip.right, bottomFrame.points.knee.right, bottomFrame.points.ankle.right) : null
  const knee = jointAngle(bottomFrame, 'knee')
  const hipJoint = jointAngle(bottomFrame, 'hip')
  const side = sideJointPoint(bottomFrame, 'knee')?.side ?? 'left'
  const shoulder = bottomFrame.points.shoulder[side]
  const hipPoint = bottomFrame.points.hip[side]
  const trunk = trunkAngle(shoulder, hipPoint)
  const hipMid = midpoint(bottomFrame.points.hip.left, bottomFrame.points.hip.right)
  const kneeMid = midpoint(bottomFrame.points.knee.left, bottomFrame.points.knee.right)
  const torsoLength = shoulder && hipPoint ? Math.hypot(shoulder.x - hipPoint.x, shoulder.y - hipPoint.y) : 0
  const depthOffset = hipMid && kneeMid && torsoLength > 0.05 ? (hipMid.y - kneeMid.y) / torsoLength : null
  const kneeSep = bottomFrame.points.knee.left && bottomFrame.points.knee.right
    ? Math.abs(bottomFrame.points.knee.left.x - bottomFrame.points.knee.right.x) : null
  const ankleSep = bottomFrame.points.ankle.left && bottomFrame.points.ankle.right
    ? Math.abs(bottomFrame.points.ankle.left.x - bottomFrame.points.ankle.right.x) : null
  const kneeAnkleRatio = kneeSep !== null && ankleSep !== null && ankleSep > 0.01 ? kneeSep / ankleSep : null
  const shoulderHeightDiff = bottomFrame.points.shoulder.left && bottomFrame.points.shoulder.right
    ? Math.abs(bottomFrame.points.shoulder.left.y - bottomFrame.points.shoulder.right.y) : null
  const hipHeightDiff = bottomFrame.points.hip.left && bottomFrame.points.hip.right
    ? Math.abs(bottomFrame.points.hip.left.y - bottomFrame.points.hip.right.y) : null
  const frameStep = 1000 / Math.max(1, fps)
  const holdWindow = 10
  const holdFrames = repFrames.filter(frame => {
    const sample = jointAngle(frame, action === 'deadlift' ? 'hip' : 'knee')
    return sample.angle !== null && bottomAngle !== null && sample.angle <= bottomAngle + holdWindow
  })
  const bottomHoldMs = holdFrames.length ? Math.max(0, (holdFrames.length - 1) * frameStep + frameStep) : null
  return {
    index,
    startMs: interval.startMs,
    endMs: interval.endMs,
    bottomMs: bottomFrame.timeMs,
    bottomKneeAngle: action === 'deadlift' ? (knee.angle ?? bottomAngle) : bottomAngle,
    bottomHipAngle: hipJoint.angle,
    bottomTrunkAngle: trunk,
    endKneeAngle: endKnee.angle,
    endHipAngle: endHip.angle,
    endTrunkAngle: endTrunk,
    depthOffset,
    leftKneeAngle: leftKnee,
    rightKneeAngle: rightKnee,
    kneeAnkleRatio,
    shoulderHeightDiff,
    hipHeightDiff,
    eccentricMs: Math.max(0, bottomFrame.timeMs - interval.startMs),
    bottomHoldMs
  }
}

function dedupeFindings(findings: MotionAnalysisFinding[]): MotionAnalysisFinding[] {
  const seen = new Set<string>()
  const out: MotionAnalysisFinding[] = []
  for (const finding of findings) {
    const key = `${finding.ruleId}|${finding.timeMs}|${finding.title}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(finding)
    if (out.length >= FINDINGS_LIMIT) break
  }
  return out
}

function capMetrics(metrics: MotionAnalysisMetric[]): MotionAnalysisMetric[] {
  const seen = new Set<string>()
  const out: MotionAnalysisMetric[] = []
  for (const metric of metrics) {
    if (seen.has(metric.id)) continue
    seen.add(metric.id)
    out.push(metric)
    if (out.length >= METRICS_LIMIT) break
  }
  return out
}

export function analyzeGait(frames: MotionFrame[], fps: number): GaitAnalysis {
  const frameStep = 1000 / Math.max(1, fps)
  const durationSec = frames.length > 1 ? Math.max(0, (frames[frames.length - 1].timeMs - frames[0].timeMs) / 1000) : 0
  const strikeRecords: { timeMs: number; side: 'left' | 'right' }[] = []
  const contactDurations: number[] = []
  const contactBySide: { left: number[]; right: number[] } = { left: [], right: [] }
  const contactKnees: number[] = []
  const contactRatios: number[] = []
  const shoulderDiffs: number[] = []
  const hipDiffs: number[] = []
  for (const side of ['left', 'right'] as const) {
    const series = frames
      .map(frame => ({ frame, ankle: frame.points.ankle[side] }))
      .filter((row): row is { frame: MotionFrame; ankle: MotionPoint } => !!row.ankle && row.ankle.visibility >= MIN_FRAME_VISIBILITY)
      .map(row => ({ timeMs: row.frame.timeMs, y: row.ankle.y, frame: row.frame }))
    const sideStrikes: number[] = []
    for (let index = 1; index < series.length - 1; index++) {
      const current = series[index]
      if (!(current.y <= series[index - 1].y && current.y <= series[index + 1].y)) continue
      const window = series.slice(Math.max(0, index - 3), Math.min(series.length, index + 4))
      const prominence = Math.max(...window.map(point => point.y)) - current.y
      if (prominence < 0.01) continue
      if (sideStrikes.length && current.timeMs - sideStrikes[sideStrikes.length - 1] < 150) continue
      sideStrikes.push(current.timeMs)
    }
    for (const timeMs of sideStrikes) {
      strikeRecords.push({ timeMs, side })
      const window = series.filter(point => Math.abs(point.timeMs - timeMs) <= 120)
      const lowest = Math.min(...window.map(point => point.y))
      const contact = window.filter(point => point.y <= lowest + 0.012)
      const contactMs = Math.max(frameStep, contact.length * frameStep)
      contactDurations.push(contactMs)
      contactBySide[side].push(contactMs)
      const strike = window.find(point => point.timeMs === timeMs)
      if (strike) {
        const knee = jointAngle(strike.frame, 'knee')
        if (knee.angle !== null) contactKnees.push(knee.angle)
        const { knee: knees, ankle: ankles, shoulder: shoulders, hip: hips } = strike.frame.points
        if (knees.left && knees.right && ankles.left && ankles.right) {
          const kneeSep = Math.abs(knees.left.x - knees.right.x)
          const ankleSep = Math.abs(ankles.left.x - ankles.right.x)
          if (ankleSep > 0.01) contactRatios.push(kneeSep / ankleSep)
        }
        if (shoulders.left && shoulders.right) shoulderDiffs.push(Math.abs(shoulders.left.y - shoulders.right.y))
        if (hips.left && hips.right) hipDiffs.push(Math.abs(hips.left.y - hips.right.y))
      }
    }
  }
  const strikeTimes = strikeRecords.map(record => record.timeMs).sort((a, b) => a - b)
  strikeRecords.sort((a, b) => a.timeMs - b.timeMs)
  const footStrikes = strikeTimes.length
  const cadence = durationSec > 0 && footStrikes > 0 ? Math.round(footStrikes / (durationSec / 60)) : null
  const average = (values: number[]) => values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length : null
  const leftContact = average(contactBySide.left)
  const rightContact = average(contactBySide.right)
  let alternating = strikeRecords.length >= 4
    && contactBySide.left.length >= 2 && contactBySide.right.length >= 2
  for (let index = 1; index < strikeRecords.length; index++) {
    const previous = strikeRecords[index - 1]
    const current = strikeRecords[index]
    if (previous.side === current.side || current.timeMs - previous.timeMs < 80) {
      alternating = false
      break
    }
  }
  const trunkValues = frames.map(frame => {
    const side = sideJointPoint(frame, 'knee')?.side ?? 'left'
    return trunkAngle(frame.points.shoulder[side], frame.points.hip[side])
  }).filter((value): value is number => value !== null)
  const hipYs = frames.map(frame => midpoint(frame.points.hip.left, frame.points.hip.right)?.y)
    .filter((value): value is number => typeof value === 'number')
  const torsoLengths = frames.map(frame => {
    const shoulder = midpoint(frame.points.shoulder.left, frame.points.shoulder.right)
    const hip = midpoint(frame.points.hip.left, frame.points.hip.right)
    return shoulder && hip ? Math.hypot(shoulder.x - hip.x, shoulder.y - hip.y) : null
  }).filter((value): value is number => value !== null && value > 0.05)
  const averageTorso = average(torsoLengths)
  const hipRange = hipYs.length ? Math.max(...hipYs) - Math.min(...hipYs) : null
  return {
    footStrikes,
    cycles: Math.floor(footStrikes / 2),
    cadence,
    contactTimeMs: average(contactDurations),
    contactTimeDiffMs: leftContact !== null && rightContact !== null ? Math.abs(leftContact - rightContact) : null,
    contactKneeAngle: average(contactKnees),
    contactKneeAnkleRatio: average(contactRatios),
    shoulderHeightDiff: average(shoulderDiffs),
    hipHeightDiff: average(hipDiffs),
    trunkAngle: average(trunkValues),
    verticalOscillation: hipRange !== null && averageTorso ? hipRange / averageTorso : null,
    durationSec,
    alternating,
    sampleTimeMs: strikeRecords[0]?.timeMs ?? frames[Math.floor(frames.length / 2)]?.timeMs ?? null
  }
}

export function analyzeMotion(series: MotionFrameSeries): MotionAnalysisResult {
  const usable = series.frames.filter(frame => frame.visibility >= MIN_FRAME_VISIBILITY)
  const usableRatio = series.frames.length ? usable.length / series.frames.length : 0
  const segmented = series.action === 'running' ? { intervals: [], count: 0 } : segmentReps(series.frames, series.action)
  const reps = segmented.intervals.map((interval, index) =>
    analyzeRep(series.frames, interval, index + 1, series.fps, series.action)
  )
  const gait = series.action === 'running' ? analyzeGait(series.frames, series.fps) : undefined
  const context = { action: series.action, view: series.view, reps, fps: series.fps, gait }
  const findings: MotionAnalysisFinding[] = []
  const metrics: MotionAnalysisMetric[] = []
  for (const rule of rulesFor(series.action, series.view)) {
    const output = rule.evaluate(context)
    if (rule.output === 'finding') findings.push(...(output as MotionAnalysisFinding[]))
    else metrics.push(...(output as MotionAnalysisMetric[]))
  }
  return {
    findings: dedupeFindings(findings),
    metrics: capMetrics(metrics),
    repCount: series.action === 'running' ? null : segmented.count,
    gaitCycles: gait?.cycles ?? null,
    usableRatio
  }
}

/** 动作自动判定阈值：端侧启发式，未经标注样本校准；判定结果允许用户在分析前/后改判 */
export const ACTION_CLASSIFY_THRESHOLDS = {
  /** 全程最小膝角（髋膝踝角，伸直为 180°）≤ 该值视为深蹲特征 */
  squatMaxKneeAngle: 100,
  /** 全程最大躯干前倾（相对竖直，度数）≥ 该值视为硬拉特征 */
  deadliftMinTrunkLean: 55,
  /** 跑姿判定（置信档）沿用原「动作不符」拒绝口径：交替触地次数与步频下限 */
  runMinFootStrikes: 8,
  runMinCadence: 140,
  /** 跑姿判定（存疑档）：像跑步但不够典型，按跑姿分析并降级标注，避免整段误判成力量动作 */
  runIshMinFootStrikes: 3,
  runIshMinCadence: 120
} as const

export interface ActionClassification {
  action: AnalysisAction
  /** false = 特征不明确，默认按深蹲分析并降级标注，用户可改判 */
  confident: boolean
  signals: {
    minKneeAngle: number | null
    maxTrunkLean: number | null
    gaitFootStrikes: number
    gaitCadence: number | null
  }
}

/**
 * 自动判定动作：交替足触地达标判跑姿；否则按「深蹲膝屈深、硬拉髋铰链躯干前倾大」二分。
 * 正面视角的躯干前倾在画面上投影很弱，判不出时走默认（深蹲）并标 confident=false，
 * 由用户改判兜底——不在端侧硬猜。
 */
export function classifyAction(frames: MotionFrame[], fps: number): ActionClassification {
  const gait = analyzeGait(frames, fps)
  const signals: ActionClassification['signals'] = {
    minKneeAngle: null,
    maxTrunkLean: null,
    gaitFootStrikes: gait.footStrikes,
    gaitCadence: gait.cadence
  }
  if (gait.alternating && gait.footStrikes >= ACTION_CLASSIFY_THRESHOLDS.runMinFootStrikes
    && gait.cadence !== null && gait.cadence >= ACTION_CLASSIFY_THRESHOLDS.runMinCadence) {
    return { action: 'running', confident: true, signals }
  }
  // 存疑档必须看 alternating：深蹲的踝部起伏也会被算成「触地」，但左右不交替；
  // alternating 要求 ≥4 次触地，很短的跑步片段可能判不出来——宁可按力量降级 + 用户改判，不硬猜
  if (gait.alternating && gait.footStrikes >= ACTION_CLASSIFY_THRESHOLDS.runIshMinFootStrikes
    && gait.cadence !== null && gait.cadence >= ACTION_CLASSIFY_THRESHOLDS.runIshMinCadence) {
    return { action: 'running', confident: false, signals }
  }
  for (const frame of frames) {
    if (frame.visibility < MIN_FRAME_VISIBILITY) continue
    const knee = jointAngle(frame, 'knee')
    if (knee.angle !== null && (signals.minKneeAngle === null || knee.angle < signals.minKneeAngle)) {
      signals.minKneeAngle = knee.angle
    }
    const side = sideJointPoint(frame, 'knee')?.side ?? 'left'
    const lean = trunkAngle(frame.points.shoulder[side], frame.points.hip[side])
    if (lean !== null && (signals.maxTrunkLean === null || lean > signals.maxTrunkLean)) {
      signals.maxTrunkLean = lean
    }
  }
  const kneeHit = signals.minKneeAngle !== null && signals.minKneeAngle <= ACTION_CLASSIFY_THRESHOLDS.squatMaxKneeAngle
  const trunkHit = signals.maxTrunkLean !== null && signals.maxTrunkLean >= ACTION_CLASSIFY_THRESHOLDS.deadliftMinTrunkLean
  if (kneeHit && !trunkHit) return { action: 'squat', confident: true, signals }
  if (trunkHit && !kneeHit) return { action: 'deadlift', confident: true, signals }
  return { action: 'squat', confident: false, signals }
}

export function precheckMotion(input: { fps: number; frames: MotionFrame[] }): MotionPrecheckResult {
  const usable = input.frames.filter(frame => frame.visibility >= MIN_FRAME_VISIBILITY)
  if (!input.frames.length || !usable.length) {
    return { verdict: 'rejected', reasons: ['没有检测到人体：请确认全身入镜、光线充足后重试'], view: null, repCount: null, gaitCycles: null, action: null, actionConfident: false }
  }
  const reasons: string[] = []
  let degraded = false
  const usableRatio = usable.length / input.frames.length
  if (usableRatio < 0.4) {
    degraded = true
    reasons.push(`关键点可见度偏低（可用帧 ${Math.round(usableRatio * 100)}%），结果置信度低`)
  }
  const viewResult = detectView(input.frames)
  if (!viewResult.view) {
    return { verdict: 'rejected', reasons: ['无法判定分析视角：请从侧面或正面全身入镜，手机与髋同高'], view: null, repCount: null, gaitCycles: null, action: null, actionConfident: false }
  }
  const classification = classifyAction(input.frames, input.fps)
  let repCount: number | null = null
  let gaitCycles: number | null = null
  if (classification.action === 'running') {
    const gait = analyzeGait(input.frames, input.fps)
    gaitCycles = gait.cycles
    if (gait.cycles === 0) {
      return { verdict: 'rejected', reasons: ['没有检测到连续跑步步态：请拍摄包含至少 5 个步态周期的侧面或正面跑步画面'], view: viewResult.view, repCount: null, gaitCycles, action: 'running', actionConfident: true }
    }
    if (gait.cycles < 5) {
      degraded = true
      reasons.push(`步态周期不足（识别到 ${gait.cycles} 个，至少 5 个），结果置信度低`)
    } else if (!classification.confident) {
      degraded = true
      reasons.push('跑步步态特征不够明显：结果按跑姿分析，如这不是跑步视频请重新拍摄')
    }
  } else {
    repCount = segmentReps(input.frames, classification.action).count
    if (repCount === 0) {
      degraded = true
      reasons.push('未识别到完整重复动作：请完整拍摄至少 1 次动作后重试')
    }
    if (!classification.confident) {
      degraded = true
      reasons.push('深蹲与硬拉特征不明确：已默认按深蹲分析，分析前可切换动作')
    }
  }
  return {
    verdict: degraded ? 'degraded' : 'ok',
    reasons,
    view: viewResult.view,
    repCount,
    gaitCycles,
    action: classification.action,
    actionConfident: classification.confident
  }
}
