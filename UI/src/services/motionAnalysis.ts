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
import type { RepInterval } from '@/composables/repMachine'
import { angleAt, clampVisibility, frameVisibility, jointScore, jointVisibility, trunkAngleAt, LANDMARK_INDEX } from '@/composables/poseMath'
import { templateFor, repRuleForTemplate, type MotionActionTemplate } from '@/services/motionTemplates'
import { rulesFor } from '@/services/motionRules'
import { consistencyRulesFor } from '@/services/motionConsistency'
import { computeKinematics, kinematicsMetrics } from '@/services/motionKinematics'

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
    /** 上肢动作需要；旧夹具/旧序列可能没有 */
    elbow?: { left: MotionPoint | null; right: MotionPoint | null }
    wrist?: { left: MotionPoint | null; right: MotionPoint | null }
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
  /** 本次分析实际覆盖的区间；V2 由活跃区间精扫给出，旧调用不传按全片处理 */
  range?: { startMs: number; endMs: number; source: string }
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
  /** 该次所有帧的平均可见度，参与 finding 置信度推导 */
  visibilityMean: number | null
  /** 通用分段口径：本次实际用的主关节与底部/结束角度；旧记录可能没有 */
  primaryJoint?: 'knee' | 'hip' | 'elbow'
  bottomPrimaryAngle?: number | null
  endPrimaryAngle?: number | null
  rangeOfMotion?: number | null
  /** 底部帧肩-髋-踝夹角；平板/俯卧撑类动作的身体对齐测量 */
  bodyAlignment?: number | null
  leftPrimaryAngle?: number | null
  rightPrimaryAngle?: number | null
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
/**
 * 视角分档：侧面 ≤0.34、正面 ≥0.40，中间留给用户选。
 * 原来的 0.28/0.42 是拍脑袋定的，用真实素材量出来：侧面硬拉到 0.320（deadlift-demo），
 * 正面深蹲可以低到 0.422（squat-front）——正好压在旧阈值线上，规范视频也会被判「无法判定」。
 * 阈值只决定「自动判定是否有把握」，真正的兜底是让用户点一下视角（view-unclear）。
 */
const SIDE_MAX_RATIO = 0.34
const FRONT_MIN_RATIO = 0.40
const FINDINGS_LIMIT = 20
const METRICS_LIMIT = 30

function readPoint(landmarks: NormalizedLandmark[], index: number): MotionPoint | null {
  const landmark = landmarks[index]
  if (!landmark || !Number.isFinite(landmark.x) || !Number.isFinite(landmark.y)) return null
  return { x: landmark.x, y: landmark.y, visibility: clampVisibility(landmark.visibility) }
}

function midpoint(a: MotionPoint | null, b: MotionPoint | null): MotionPoint | null {
  if (!a || !b) return null
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, visibility: Math.min(a.visibility, b.visibility) }
}

/** 供验证夹具直接断言逐帧测量口径，与内部计数/规则用的是同一个函数。 */
export function measureJointAngle(frame: MotionFrame, joint: 'knee' | 'hip' | 'elbow'): { angle: number | null; visibility: number } {
  return jointAngle(frame, joint)
}

export function measureTrunkAngle(shoulder: MotionPoint | null, hip: MotionPoint | null): number | null {
  return trunkAngle(shoulder, hip)
}

function trunkAngle(shoulder: MotionPoint | null, hip: MotionPoint | null): number | null {
  const exact = trunkAngleAt(shoulder, hip)
  return exact === null ? null : Math.round(exact)
}

/**
 * 选侧口径：用顶点关节自身可见度（膝角看膝、髋角看髋），与实时侧统一。
 * 对外返回的 visibility 仍是三点最小值——那是喂状态机的口径，不改。
 */
function sideTriple(frame: MotionFrame, joint: 'knee' | 'hip' | 'elbow'): { side: 'left' | 'right'; score: number; visibility: number } | null {
  const read = (side: 'left' | 'right') => {
    const shoulder = frame.points.shoulder[side]
    const elbow = frame.points.elbow?.[side]
    const wrist = frame.points.wrist?.[side]
    const hip = frame.points.hip[side]
    const knee = frame.points.knee[side]
    const ankle = frame.points.ankle[side]
    const points = joint === 'knee'
      ? (hip && knee && ankle ? [hip, knee, ankle] : null)
      : joint === 'hip'
        ? (shoulder && hip && knee ? [shoulder, hip, knee] : null)
        : (shoulder && elbow && wrist ? [shoulder, elbow, wrist] : null)
    if (!points) return null
    const angle = angleAt(points[0], points[1], points[2])
    return {
      side,
      score: angle === null ? 0 : jointScore(points[1]),
      visibility: angle === null ? 0 : jointVisibility(points)
    }
  }
  const left = read('left')
  const right = read('right')
  if (!left && !right) return null
  if (!left) return right
  if (!right) return left
  return right.score > left.score ? right : left
}

function sideJointPoint(frame: MotionFrame, joint: 'knee' | 'hip' | 'elbow'): { point: MotionPoint; side: 'left' | 'right' } | null {
  const chosen = sideTriple(frame, joint)
  const sidePoints = frame.points[joint]
  if (!chosen || !sidePoints) return null
  const point = sidePoints[chosen.side]
  return point ? { point, side: chosen.side } : null
}

function jointAngle(frame: MotionFrame, joint: 'knee' | 'hip' | 'elbow'): { angle: number | null; visibility: number } {
  const chosen = sideTriple(frame, joint)
  if (!chosen) return { angle: null, visibility: 0 }
  const side = chosen.side
  const shoulder = frame.points.shoulder[side]
  const elbow = frame.points.elbow?.[side]
  const wrist = frame.points.wrist?.[side]
  const hip = frame.points.hip[side]
  const knee = frame.points.knee[side]
  const ankle = frame.points.ankle[side]
  if (joint === 'knee') {
    if (!hip || !knee || !ankle) return { angle: null, visibility: 0 }
    return { angle: angleAt(hip, knee, ankle), visibility: chosen.visibility }
  }
  if (joint === 'hip') {
    if (!shoulder || !hip || !knee) return { angle: null, visibility: 0 }
    return { angle: angleAt(shoulder, hip, knee), visibility: chosen.visibility }
  }
  if (!shoulder || !elbow || !wrist) return { angle: null, visibility: 0 }
  return { angle: angleAt(shoulder, elbow, wrist), visibility: chosen.visibility }
}

/** 指定侧的主关节角；用于左右对称测量，不参与选侧 */
function sideAngleAt(frame: MotionFrame, joint: 'knee' | 'hip' | 'elbow', side: 'left' | 'right'): number | null {
  const shoulder = frame.points.shoulder[side]
  const elbow = frame.points.elbow?.[side]
  const wrist = frame.points.wrist?.[side]
  const hip = frame.points.hip[side]
  const knee = frame.points.knee[side]
  const ankle = frame.points.ankle[side]
  if (joint === 'knee') return hip && knee && ankle ? angleAt(hip, knee, ankle) : null
  if (joint === 'hip') return shoulder && hip && knee ? angleAt(shoulder, hip, knee) : null
  return shoulder && elbow && wrist ? angleAt(shoulder, elbow, wrist) : null
}

export function extractMotionFrame(landmarks: NormalizedLandmark[], timeMs: number): MotionFrame {
  const point = (joint: keyof typeof LANDMARK_INDEX, side: 'left' | 'right') => readPoint(landmarks, LANDMARK_INDEX[joint][side])
  const visibility = frameVisibility(landmarks)
  return {
    timeMs,
    visibility,
    points: {
      shoulder: { left: point('shoulder', 'left'), right: point('shoulder', 'right') },
      elbow: { left: point('elbow', 'left'), right: point('elbow', 'right') },
      wrist: { left: point('wrist', 'left'), right: point('wrist', 'right') },
      hip: { left: point('hip', 'left'), right: point('hip', 'right') },
      knee: { left: point('knee', 'left'), right: point('knee', 'right') },
      ankle: { left: point('ankle', 'left'), right: point('ankle', 'right') },
      heel: { left: point('heel', 'left'), right: point('heel', 'right') },
      toe: { left: point('toe', 'left'), right: point('toe', 'right') }
    }
  }
}

/** 侧面时左右肩/髋几乎重合，正面时明显分开；用分离度/躯干高度判断。 */
export function detectView(frames: MotionFrame[]): {
  view: AnalysisView | null
  confidence: number
  /** 判不准时按中位数离哪边更近给出建议；判准了就等于 view */
  suggested: AnalysisView | null
} {
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
  if (ratios.length < 5) return { view: null, confidence: 0, suggested: null }
  ratios.sort((a, b) => a - b)
  const median = ratios[Math.floor(ratios.length / 2)]
  if (median <= SIDE_MAX_RATIO) return { view: 'side', confidence: Math.min(1, 1 - median / SIDE_MAX_RATIO), suggested: 'side' }
  if (median >= FRONT_MIN_RATIO) return { view: 'front', confidence: Math.min(1, (median - FRONT_MIN_RATIO) / 0.25), suggested: 'front' }
  const boundary = (SIDE_MAX_RATIO + FRONT_MIN_RATIO) / 2
  return { view: null, confidence: 0, suggested: median >= boundary ? 'front' : 'side' }
}

function segmentReps(frames: MotionFrame[], template: MotionActionTemplate): { intervals: RepInterval[]; count: number } {
  const rule = repRuleForTemplate(template)
  if (!rule || !template.segmentation) return { intervals: [], count: 0 }
  const machine = createRepMachine(rule)
  const joint = template.segmentation.joint
  const intervals: RepInterval[] = []
  for (const frame of frames) {
    const sample = jointAngle(frame, joint)
    const snapshot = machine.feed(sample.angle, sample.visibility, frame.timeMs)
    if (snapshot.counted && snapshot.lastRep) intervals.push(snapshot.lastRep)
  }
  return { intervals, count: machine.snapshot().count }
}

/** 供实时模式复用：rep 结束时该次所有帧都是过去/当前，摘要与离线逐位相同 */
export function analyzeRep(frames: MotionFrame[], interval: RepInterval, index: number, fps: number, action: AnalysisAction): RepAnalysis {
  const template = templateFor(action)
  // 主关节只由模板决定；未登记动作退回膝角，不再按动作名特判
  const joint: 'knee' | 'hip' | 'elbow' = template.segmentation?.joint ?? 'knee'
  const repFrames = frames.filter(frame => frame.timeMs >= interval.startMs && frame.timeMs <= interval.endMs)
  let bottomFrame: MotionFrame | null = null
  let bottomAngle: number | null = null
  for (const frame of repFrames) {
    const sample = jointAngle(frame, joint)
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
      shoulderHeightDiff: null, hipHeightDiff: null, eccentricMs: null, bottomHoldMs: null, visibilityMean: null,
      primaryJoint: joint, bottomPrimaryAngle: null, endPrimaryAngle: null, rangeOfMotion: null,
      bodyAlignment: null, leftPrimaryAngle: null, rightPrimaryAngle: null
    }
  }
  const visibilityMean = repFrames.length
    ? repFrames.reduce((sum, frame) => sum + frame.visibility, 0) / repFrames.length
    : null
  const endFrame = repFrames[repFrames.length - 1] ?? bottomFrame
  const endKnee = jointAngle(endFrame, 'knee')
  const endHip = jointAngle(endFrame, 'hip')
  const endSide = sideJointPoint(endFrame, joint)?.side ?? 'left'
  const endTrunk = trunkAngle(endFrame.points.shoulder[endSide], endFrame.points.hip[endSide])
  const leftKnee = bottomFrame.points.hip.left && bottomFrame.points.knee.left && bottomFrame.points.ankle.left
    ? angleAt(bottomFrame.points.hip.left, bottomFrame.points.knee.left, bottomFrame.points.ankle.left) : null
  const rightKnee = bottomFrame.points.hip.right && bottomFrame.points.knee.right && bottomFrame.points.ankle.right
    ? angleAt(bottomFrame.points.hip.right, bottomFrame.points.knee.right, bottomFrame.points.ankle.right) : null
  const knee = jointAngle(bottomFrame, 'knee')
  const hipJoint = jointAngle(bottomFrame, 'hip')
  const side = sideJointPoint(bottomFrame, joint)?.side ?? 'left'
  const shoulder = bottomFrame.points.shoulder[side]
  const hipPoint = bottomFrame.points.hip[side]
  const anklePoint = bottomFrame.points.ankle[side]
  const trunk = trunkAngle(shoulder, hipPoint)
  const leftPrimaryAngle = sideAngleAt(bottomFrame, joint, 'left')
  const rightPrimaryAngle = sideAngleAt(bottomFrame, joint, 'right')
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
    const sample = jointAngle(frame, joint)
    return sample.angle !== null && bottomAngle !== null && sample.angle <= bottomAngle + holdWindow
  })
  const bottomHoldMs = holdFrames.length ? Math.max(0, (holdFrames.length - 1) * frameStep + frameStep) : null
  const endPrimary = jointAngle(endFrame, joint)
  const rangeOfMotion = bottomAngle !== null && endPrimary.angle !== null
    ? Math.abs(endPrimary.angle - bottomAngle) : null
  const bodyAlignment = shoulder && hipPoint && anklePoint
    ? angleAt(shoulder, hipPoint, anklePoint) : null
  return {
    index,
    startMs: interval.startMs,
    endMs: interval.endMs,
    bottomMs: bottomFrame.timeMs,
    // 膝角只在主关节是膝时取主关节角；否则老实读膝角，读不到就留空。
    // 这里绝不拿髋角去顶膝角：那会让"最低点膝角"显示成髋角数值。
    bottomKneeAngle: joint === 'knee' ? bottomAngle : knee.angle,
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
    bottomHoldMs,
    visibilityMean,
    primaryJoint: joint,
    bottomPrimaryAngle: bottomAngle,
    endPrimaryAngle: endPrimary.angle,
    rangeOfMotion,
    bodyAlignment,
    leftPrimaryAngle,
    rightPrimaryAngle
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

export interface HoldAnalysis {
  durationSec: number
  usableRatio: number
  meanAlignment: number | null
  maxHipSag: number | null
  sway: number | null
  sampleTimeMs: number | null
}

function bodySide(frame: MotionFrame): 'left' | 'right' {
  const score = (side: 'left' | 'right') => {
    const shoulder = frame.points.shoulder[side]
    const hip = frame.points.hip[side]
    const ankle = frame.points.ankle[side]
    return shoulder && hip && ankle
      ? Math.min(shoulder.visibility, hip.visibility, ankle.visibility)
      : -1
  }
  return score('right') > score('left') ? 'right' : 'left'
}

export const HOLD_SEGMENT_THRESHOLDS = {
  /** 躯干与竖直方向夹角；站立准备约 0°，平板接近 90° */
  minTrunkAngle: 50,
  /** 膝盖基本伸直；屈膝准备位不算支撑 */
  minKneeAngle: 140,
  /** 肩-髋-踝不能折成锐角；允许一定程度的塌腰 */
  minAlignment: 120
} as const

/** 静态保持型动作：只测支撑段、肩-髋-踝对齐、髋部偏离与晃动，不出结论 */
export function analyzeHold(frames: MotionFrame[], fps: number): HoldAnalysis {
  const usable = frames.filter(frame => frame.visibility >= MIN_FRAME_VISIBILITY)
  const usableRatio = frames.length ? usable.length / frames.length : 0
  const frameStep = 1000 / Math.max(1, fps)
  const isHoldFrame = (frame: MotionFrame): boolean => {
    if (frame.visibility < MIN_FRAME_VISIBILITY) return false
    const side = bodySide(frame)
    const shoulder = frame.points.shoulder[side]
    const hip = frame.points.hip[side]
    const ankle = frame.points.ankle[side]
    if (!shoulder || !hip || !ankle) return false
    const knee = jointAngle(frame, 'knee').angle
    const trunk = trunkAngle(shoulder, hip)
    const alignment = angleAt(shoulder, hip, ankle)
    return knee !== null && knee >= HOLD_SEGMENT_THRESHOLDS.minKneeAngle
      && trunk !== null && trunk >= HOLD_SEGMENT_THRESHOLDS.minTrunkAngle
      && alignment !== null && alignment >= HOLD_SEGMENT_THRESHOLDS.minAlignment
  }

  // 站立准备/走动进入机位不算保持；取最长的一段连续支撑帧
  const runs: { start: number; end: number }[] = []
  let runStart = -1
  for (let index = 0; index < frames.length; index++) {
    if (isHoldFrame(frames[index])) {
      if (runStart < 0) runStart = index
    } else if (runStart >= 0) {
      runs.push({ start: runStart, end: index - 1 })
      runStart = -1
    }
  }
  if (runStart >= 0) runs.push({ start: runStart, end: frames.length - 1 })
  const best = runs.sort((a, b) => (b.end - b.start) - (a.end - a.start))[0]
  if (!best) {
    return { durationSec: 0, usableRatio, meanAlignment: null, maxHipSag: null, sway: null, sampleTimeMs: null }
  }

  const holdFrames = frames.slice(best.start, best.end + 1)
  const durationSec = Math.max(0, (holdFrames[holdFrames.length - 1].timeMs - holdFrames[0].timeMs + frameStep) / 1000)
  const alignments: number[] = []
  const sags: number[] = []
  const hipXs: number[] = []
  const torsoLengths: number[] = []
  for (const frame of holdFrames) {
    const side = bodySide(frame)
    const shoulder = frame.points.shoulder[side]
    const hip = frame.points.hip[side]
    const ankle = frame.points.ankle[side]
    if (!shoulder || !hip || !ankle) continue
    const alignment = angleAt(shoulder, hip, ankle)
    if (alignment !== null) alignments.push(alignment)
    const dx = ankle.x - shoulder.x
    const dy = ankle.y - shoulder.y
    const lineLength = Math.hypot(dx, dy)
    const torso = Math.hypot(hip.x - shoulder.x, hip.y - shoulder.y)
    if (lineLength > 0.05) {
      sags.push(Math.abs((hip.x - shoulder.x) * dy - (hip.y - shoulder.y) * dx) / lineLength)
    }
    if (torso > 0.05) torsoLengths.push(torso)
    hipXs.push(hip.x)
  }
  const mean = (values: number[]) => values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length : null
  const meanAlignment = mean(alignments)
  const maxHipSag = sags.length ? Math.max(...sags) : null
  const meanTorso = mean(torsoLengths)
  let sway: number | null = null
  if (hipXs.length > 1 && meanTorso) {
    const hipMean = mean(hipXs)!
    const variance = hipXs.reduce((sum, value) => sum + (value - hipMean) ** 2, 0) / hipXs.length
    sway = Math.sqrt(variance) / meanTorso
  }
  return {
    durationSec,
    usableRatio,
    meanAlignment,
    maxHipSag,
    sway,
    sampleTimeMs: holdFrames[Math.floor(holdFrames.length / 2)]?.timeMs ?? null
  }
}

function holdMetrics(hold: HoldAnalysis): MotionAnalysisMetric[] {
  const round2 = (value: number) => Math.round(value * 100) / 100
  return [
    { id: 'metric-hold-duration', label: '保持时长（分析区间）', value: round2(hold.durationSec), unit: '秒' },
    { id: 'metric-body-alignment', label: '肩-髋-踝平均对齐角', value: hold.meanAlignment === null ? '—' : Math.round(hold.meanAlignment), unit: '°' },
    { id: 'metric-hip-sag', label: '髋部偏离肩-踝连线', value: hold.maxHipSag === null ? '—' : round2(hold.maxHipSag), unit: '（归一化）' },
    { id: 'metric-sway', label: '髋部左右晃动', value: hold.sway === null ? '—' : round2(hold.sway), unit: '（归一化）' }
  ]
}

export function analyzeMotion(series: MotionFrameSeries): MotionAnalysisResult {
  const template = templateFor(series.action)
  const usable = series.frames.filter(frame => frame.visibility >= MIN_FRAME_VISIBILITY)
  const usableRatio = series.frames.length ? usable.length / series.frames.length : 0
  const segmented = template.kind === 'reps'
    ? segmentReps(series.frames, template)
    : { intervals: [], count: 0 }
  const reps = segmented.intervals.map((interval, index) =>
    analyzeRep(series.frames, interval, index + 1, series.fps, series.action)
  )
  const kinematics = template.kinematics
    ? computeKinematics({ frames: series.frames, action: series.action, fps: series.fps, reps })
    : undefined
  const gait = template.kind === 'gait' ? analyzeGait(series.frames, series.fps) : undefined
  const hold = template.kind === 'hold' ? analyzeHold(series.frames, series.fps) : undefined
  const viewConfidence = detectView(series.frames).confidence
  const context = { action: series.action, view: series.view, reps, fps: series.fps, gait, hold, viewConfidence }
  const findings: MotionAnalysisFinding[] = []
  const metrics: MotionAnalysisMetric[] = []
  for (const rule of [...rulesFor(series.action, series.view), ...consistencyRulesFor(series.action)]) {
    const output = rule.evaluate(context)
    if (rule.output === 'finding') findings.push(...(output as MotionAnalysisFinding[]))
    else metrics.push(...(output as MotionAnalysisMetric[]))
  }
  if (kinematics) metrics.push(...kinematicsMetrics(kinematics, series.action))
  if (hold) metrics.push(...holdMetrics(hold))
  // 分析区间必须跟着结论走：V2 不再默认全片，用户要知道结论覆盖了哪几秒
  if (series.range) {
    const seconds = (ms: number) => (Math.max(0, ms) / 1000).toFixed(1)
    metrics.push({
      id: 'metric-analyzed-range',
      label: '分析区间',
      value: `${seconds(series.range.startMs)}–${seconds(series.range.endMs)}`,
      unit: '秒'
    })
  }
  // 模板没配可核验阈值时一律不出关注项：即使将来有人给该动作加了 finding 规则，
  // 也不会把测量值包装成结论（ADR-0003 的最后一道闸）
  if (!template.findingsReady) findings.length = 0
  const primaryJoint = template.segmentation?.joint ?? 'knee'
  const angles = series.frames.map(frame => {
    const knee = jointAngle(frame, 'knee')
    const hip = jointAngle(frame, 'hip')
    const elbow = jointAngle(frame, 'elbow')
    const side = sideJointPoint(frame, primaryJoint)?.side ?? 'left'
    return {
      timeMs: frame.timeMs,
      visibility: frame.visibility,
      kneeAngle: knee.angle,
      hipAngle: hip.angle,
      trunkAngle: trunkAngle(frame.points.shoulder[side], frame.points.hip[side]),
      elbowAngle: elbow.angle
    }
  })
  // 弯举类短片段可能只拍到半次往返：逐次统计是空的，但全程肘角范围仍是可核对测量
  if (template.segmentation?.joint === 'elbow') {
    const elbowAngles = angles
      .map(sample => sample.elbowAngle)
      .filter((value): value is number => typeof value === 'number')
    if (elbowAngles.length) {
      metrics.push({
        id: 'metric-elbow-range',
        label: '全程肘角极差',
        value: Math.round(Math.max(...elbowAngles) - Math.min(...elbowAngles)),
        unit: '°'
      })
    }
  }
  return {
    findings: dedupeFindings(findings),
    metrics: capMetrics(metrics),
    repCount: template.kind === 'reps' ? segmented.count : null,
    gaitCycles: gait?.cycles ?? null,
    ...(hold ? { holdSeconds: hold.durationSec } : {}),
    usableRatio,
    fps: series.fps,
    reps,
    angles,
    ...(series.range ? { analyzedRange: series.range } : {}),
    ...(kinematics ? { kinematics } : {})
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

/**
 * 通用运动特征：分类器只看这些可解释的量，不直接看动作名字。
 * 新增动作时优先判断能否用这些特征区分，而不是给每个动作写一套全量分析。
 */
export interface MotionFeatures {
  durationSec: number
  usableRatio: number
  minKneeAngle: number | null
  maxKneeAngle: number | null
  meanKneeAngle: number | null
  kneeRange: number | null
  minElbowAngle: number | null
  maxElbowAngle: number | null
  elbowRange: number | null
  meanTrunkAngle: number | null
  maxTrunkAngle: number | null
  meanBodyAlignment: number | null
  /** 髋部竖直位移 / 躯干长；站立动作大，平板接近 0 */
  hipVerticalRange: number | null
  gait: GaitAnalysis
}

const meanOf = (values: number[]) => values.length
  ? values.reduce((sum, value) => sum + value, 0) / values.length : null
const rangeOf = (values: number[]) => values.length ? Math.max(...values) - Math.min(...values) : null

export function summarizeMotionFeatures(frames: MotionFrame[], fps: number): MotionFeatures {
  const usable = frames.filter(frame => frame.visibility >= MIN_FRAME_VISIBILITY)
  const usableRatio = frames.length ? usable.length / frames.length : 0
  const durationSec = frames.length > 1
    ? Math.max(0, (frames[frames.length - 1].timeMs - frames[0].timeMs) / 1000) : 0
  const kneeAngles: number[] = []
  const elbowAngles: number[] = []
  const trunkAngles: number[] = []
  const alignments: number[] = []
  const hipYs: number[] = []
  const torsoLengths: number[] = []
  for (const frame of usable) {
    const knee = jointAngle(frame, 'knee')
    if (knee.angle !== null) kneeAngles.push(knee.angle)
    const elbow = jointAngle(frame, 'elbow')
    if (elbow.angle !== null) elbowAngles.push(elbow.angle)
    const side = sideJointPoint(frame, 'knee')?.side ?? 'left'
    const lean = trunkAngle(frame.points.shoulder[side], frame.points.hip[side])
    if (lean !== null) trunkAngles.push(lean)
    const bodyS = bodySide(frame)
    const shoulder = frame.points.shoulder[bodyS]
    const hip = frame.points.hip[bodyS]
    const ankle = frame.points.ankle[bodyS]
    if (shoulder && hip && ankle) {
      const alignment = angleAt(shoulder, hip, ankle)
      if (alignment !== null) alignments.push(alignment)
    }
    const hipMid = midpoint(frame.points.hip.left, frame.points.hip.right)
    const shoulderMid = midpoint(frame.points.shoulder.left, frame.points.shoulder.right)
    if (hipMid && shoulderMid) {
      const torso = Math.hypot(hipMid.x - shoulderMid.x, hipMid.y - shoulderMid.y)
      if (torso > 0.05) {
        torsoLengths.push(torso)
        hipYs.push(hipMid.y)
      }
    }
  }
  const meanTorso = meanOf(torsoLengths)
  return {
    durationSec,
    usableRatio,
    minKneeAngle: kneeAngles.length ? Math.min(...kneeAngles) : null,
    maxKneeAngle: kneeAngles.length ? Math.max(...kneeAngles) : null,
    meanKneeAngle: meanOf(kneeAngles),
    kneeRange: rangeOf(kneeAngles),
    minElbowAngle: elbowAngles.length ? Math.min(...elbowAngles) : null,
    maxElbowAngle: elbowAngles.length ? Math.max(...elbowAngles) : null,
    elbowRange: rangeOf(elbowAngles),
    meanTrunkAngle: meanOf(trunkAngles),
    maxTrunkAngle: trunkAngles.length ? Math.max(...trunkAngles) : null,
    meanBodyAlignment: meanOf(alignments),
    hipVerticalRange: hipYs.length > 1 && meanTorso
      ? (Math.max(...hipYs) - Math.min(...hipYs)) / meanTorso : null,
    gait: analyzeGait(frames, fps)
  }
}

export const TEMPLATE_CLASSIFY_THRESHOLDS = {
  /** 弯举：肘角大幅往返、腿部稳定、躯干不过度前倾 */
  curlMinElbowRange: 60,
  curlStrongElbowRange: 90,
  curlMinFlexion: 100,
  curlMaxKneeRange: 30,
  curlMaxTrunkLean: 50,
  /** 平板：保持够久、躯干接近水平、髋部几乎不动、肘角不往返 */
  plankMinDurationSec: 3,
  plankStrongDurationSec: 5,
  plankMinMeanTrunkAngle: 65,
  plankStrongMeanTrunkAngle: 80,
  plankMaxHipVerticalRange: 0.12,
  plankMaxElbowRange: 35,
  plankMinAlignment: 150,
  /** 候选/置信门控：特征不够强时只预选，仍要求用户确认 */
  candidateMinScore: 0.55,
  confidentMinScore: 0.9,
  confidentMinMargin: 0.1
} as const

function curlScore(features: MotionFeatures): number {
  if (features.elbowRange === null || features.minElbowAngle === null || features.maxElbowAngle === null) return 0
  let score = 0
  if (features.elbowRange >= TEMPLATE_CLASSIFY_THRESHOLDS.curlMinElbowRange) score += 0.4
  if (features.elbowRange >= TEMPLATE_CLASSIFY_THRESHOLDS.curlStrongElbowRange) score += 0.15
  if (features.minElbowAngle <= TEMPLATE_CLASSIFY_THRESHOLDS.curlMinFlexion) score += 0.15
  if (features.minElbowAngle <= 70) score += 0.05
  if (features.maxElbowAngle >= 140) score += 0.15
  if (features.kneeRange !== null && features.kneeRange <= TEMPLATE_CLASSIFY_THRESHOLDS.curlMaxKneeRange) score += 0.1
  if (features.maxTrunkAngle !== null && features.maxTrunkAngle <= TEMPLATE_CLASSIFY_THRESHOLDS.curlMaxTrunkLean) score += 0.1
  if (features.usableRatio >= 0.5) score += 0.05
  return Math.min(1, score)
}

function plankScore(features: MotionFeatures): number {
  // 膝盖弯曲的静止姿势是硬拉/靠墙静蹲的准备位，不是平板；先排除
  if (features.meanKneeAngle === null || features.meanKneeAngle < 150) return 0
  // 躯干不够水平或身体明显不直，不当作平板候选（硬拉准备位常见）
  if (features.meanTrunkAngle === null
    || features.meanTrunkAngle < 60) return 0
  if (features.meanBodyAlignment === null
    || features.meanBodyAlignment < TEMPLATE_CLASSIFY_THRESHOLDS.plankMinAlignment) return 0
  let score = 0
  if (features.durationSec >= TEMPLATE_CLASSIFY_THRESHOLDS.plankMinDurationSec) score += 0.2
  if (features.durationSec >= TEMPLATE_CLASSIFY_THRESHOLDS.plankStrongDurationSec) score += 0.1
  if (features.meanTrunkAngle !== null
    && features.meanTrunkAngle >= TEMPLATE_CLASSIFY_THRESHOLDS.plankMinMeanTrunkAngle) score += 0.2
  if (features.meanTrunkAngle !== null
    && features.meanTrunkAngle >= TEMPLATE_CLASSIFY_THRESHOLDS.plankStrongMeanTrunkAngle) score += 0.1
  if (features.hipVerticalRange !== null
    && features.hipVerticalRange <= TEMPLATE_CLASSIFY_THRESHOLDS.plankMaxHipVerticalRange) score += 0.2
  if (features.elbowRange !== null
    && features.elbowRange <= TEMPLATE_CLASSIFY_THRESHOLDS.plankMaxElbowRange) score += 0.1
  if (features.meanBodyAlignment !== null
    && features.meanBodyAlignment >= TEMPLATE_CLASSIFY_THRESHOLDS.plankMinAlignment) score += 0.1
  if (features.meanKneeAngle >= 160) score += 0.1
  if (features.usableRatio >= 0.5) score += 0.05
  return Math.min(1, score)
}

export interface TemplateClassification extends ActionClassification {
  signals: ActionClassification['signals'] & {
    kneeRange: number | null
    elbowRange: number | null
    meanTrunkAngle: number | null
    hipVerticalRange: number | null
  }
}

/**
 * 模板级自动识别：先保留三个既有动作的判定；未命中时再用通用特征评估
 * 弯举（肘主导往返）与平板（水平静止保持）。
 * 特征不够强时只返回候选并标 confident=false，由用户确认，不硬猜。
 */
export function classifyTemplate(frames: MotionFrame[], fps: number): TemplateClassification {
  const base = classifyAction(frames, fps)
  const features = summarizeMotionFeatures(frames, fps)
  const signals = {
    ...base.signals,
    kneeRange: features.kneeRange,
    elbowRange: features.elbowRange,
    meanTrunkAngle: features.meanTrunkAngle,
    hipVerticalRange: features.hipVerticalRange
  }
  // 跑姿的步态特征最强，维持既有口径，不让其他分类器覆盖
  if (base.action === 'running') return { ...base, signals }
  const curl = curlScore(features)
  const plank = plankScore(features)
  const bestScore = Math.max(curl, plank)
  const bestAction: AnalysisAction = curl >= plank ? 'curl' : 'plank'
  const margin = Math.abs(curl - plank)
  if (bestScore >= TEMPLATE_CLASSIFY_THRESHOLDS.candidateMinScore) {
    return {
      action: bestAction,
      confident: bestScore >= TEMPLATE_CLASSIFY_THRESHOLDS.confidentMinScore
        && margin >= TEMPLATE_CLASSIFY_THRESHOLDS.confidentMinMargin,
      signals
    }
  }
  return { ...base, signals }
}

export function precheckMotion(input: {
  fps: number
  frames: MotionFrame[]
  templateId?: string
  /** 预检覆盖区间；不传时按传入帧的首尾时间推断 */
  range?: { startMs: number; endMs: number; source: string }
}): MotionPrecheckResult {
  const analyzedRange = input.range ?? {
    startMs: input.frames[0]?.timeMs ?? 0,
    endMs: input.frames[input.frames.length - 1]?.timeMs ?? 0,
    source: 'whole-clip'
  }
  /**
   * 视角判不准或模板不支持该视角时的统一返回形状：不直接拒绝，把视角交给用户选。
   * 三条分支（判不出视角 / hold 模板 / 自动识别到单视角模板）都走这里，
   * 免得字段各拼一份、漏一个就少一个 null。
   */
  const viewUnclear = (args: {
    reasons: string[]
    suggestedView?: AnalysisView | null
    action: AnalysisAction
    actionConfident: boolean
  }): MotionPrecheckResult => ({
    verdict: 'view-unclear',
    reasons: args.reasons,
    view: null,
    suggestedView: args.suggestedView ?? null,
    repCount: null,
    gaitCycles: null,
    holdSeconds: null,
    action: args.action,
    actionConfident: args.actionConfident,
    analyzedRange
  })
  const selected = input.templateId ? templateFor(input.templateId) : undefined
  const usable = input.frames.filter(frame => frame.visibility >= MIN_FRAME_VISIBILITY)
  if (!input.frames.length || !usable.length) {
    return {
      verdict: 'rejected', reasons: ['没有检测到人体：请确认全身入镜、光线充足后重试'],
      view: null, repCount: null, gaitCycles: null, holdSeconds: null,
      action: selected?.id ?? null, actionConfident: !!selected, analyzedRange
    }
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
    // 人体和动作都在，只是机位判不准：不再一刀切拒绝，把视角交给用户点一下。
    // 选完按降级结果走，规则仍按所选视角执行，结果页会明确标注低置信度。
    const classification = selected
      ? { action: selected.id, confident: true }
      : classifyTemplate(input.frames, input.fps)
    return viewUnclear({
      reasons: [...reasons, '无法自动判定拍摄视角：请确认这段视频是侧面还是正面，选完按低置信度分析'],
      suggestedView: viewResult.suggested,
      action: classification.action,
      actionConfident: classification.confident
    })
  }
  const classification = selected
    ? { action: selected.id, confident: true }
    : classifyTemplate(input.frames, input.fps)
  const template = templateFor(classification.action)
  if (!template.views.includes(viewResult.view)) {
    const supported = template.views.map(view => view === 'side' ? '侧面' : '正面').join(' / ')
    const source = selected ? `「${template.label}」` : `自动识别为「${template.label}」`
    // 平板/静态保持的身体接近水平，detectView 用竖直躯干高度做分母会把侧拍误判成正面；
    // 这类动作不直接拒绝，交给用户确认实际机位（只提供模板支持的视角）。
    if (template.kind === 'hold') {
      return viewUnclear({
        reasons: [...reasons, `${source} 需要${supported}视角；自动判断为${viewResult.view === 'side' ? '侧面' : '正面'}，请确认实际机位`],
        suggestedView: template.views[0] ?? 'side',
        action: template.id,
        actionConfident: classification.confident
      })
    }
    if (selected) {
      return {
        verdict: 'rejected',
        reasons: [`「${template.label}」只支持${supported}视角：请按支持的机位重拍`],
        view: viewResult.view,
        repCount: null,
        gaitCycles: null,
        holdSeconds: null,
        action: template.id,
        actionConfident: true,
        analyzedRange
      }
    }
    // 自动识别猜到了只支持单一视角的模板时，不按不支持的机位直接分析，
    // 也不直接拒绝：交给用户确认支持的视角。
    return viewUnclear({
      reasons: [...reasons, `${source} 只支持${supported}视角；自动判断为${viewResult.view === 'side' ? '侧面' : '正面'}，请确认实际机位`],
      suggestedView: template.views[0] ?? 'side',
      action: template.id,
      actionConfident: classification.confident
    })
  }
  let repCount: number | null = null
  let gaitCycles: number | null = null
  let holdSeconds: number | null = null
  if (template.kind === 'gait') {
    const gait = analyzeGait(input.frames, input.fps)
    gaitCycles = gait.cycles
    // V2：帧数/周期不足是"这段素材能支撑什么分析"的问题，不是视频采集质量问题。
    // 不能因为周期为 0 就整段拒诊——基础测量与节律仍可交付，只是不出步态结论。
    if (gait.cycles === 0) {
      degraded = true
      reasons.push('没有识别到连续步态周期：结果只保留命中项与基础测量，步态节律类结论不出')
    } else if (gait.cycles < 5) {
      degraded = true
      reasons.push(`步态周期不足（识别到 ${gait.cycles} 个，至少 5 个），结果置信度低`)
    } else if (!classification.confident) {
      degraded = true
      reasons.push('跑步步态特征不够明显：结果按跑姿分析，如这不是跑步视频请重新拍摄')
    }
  } else if (template.kind === 'hold') {
    const hold = analyzeHold(input.frames, input.fps)
    holdSeconds = Math.round(hold.durationSec * 10) / 10
    if (hold.durationSec < 3) {
      degraded = true
      reasons.push('静态保持区间不足 3 秒：请拍摄完整的支撑过程后重试')
    }
  } else {
    repCount = segmentReps(input.frames, template).count
    if (repCount === 0) {
      degraded = true
      reasons.push('未识别到完整重复动作：请完整拍摄至少 1 次动作后重试')
    }
    if (!classification.confident) {
      degraded = true
      // 文案必须用实际模板名：自动识别可能预选的是弯举/平板候选，不是深蹲
      reasons.push(`动作特征不明确：已按「${template.label}」预检，请在分析前选择实际动作`)
    }
  }
  return {
    verdict: degraded ? 'degraded' : 'ok',
    reasons,
    view: viewResult.view,
    repCount,
    gaitCycles,
    holdSeconds,
    action: template.id,
    actionConfident: classification.confident,
    analyzedRange
  }
}
