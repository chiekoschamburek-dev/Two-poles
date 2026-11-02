// ===== Demo Camera Service =====
// Pre-scripted counting events for demonstration (one timeline per set)

import type { DemoEvent, ExercisePhase, TrainingType, TrainingSession } from '@/types/domain'

/** 课次类型（F18）：reps 计次 / time 计时保持 / steps 计步（DeviceMotion，降级手动计时） */
export type FollowMode = 'reps' | 'time' | 'steps'

export interface DemoExercise {
  name: string
  type: TrainingType
  /** 演示剪影与阶段文案按哪套姿态渲染：knee 下蹲起身 / elbow 弯举还原 / shoulder 上举下摆 / calf 提踵落下 */
  kind: FigureKind
  mode: FollowMode
  sets: number
  /** reps 模式每组次数 */
  repsPerSet: number
  /** time 模式每组保持秒数 */
  holdSeconds?: number
  /** steps 模式目标时长（分钟） */
  targetMinutes?: number
  /** 单次行程的演示时长，ms；快动作（高抬腿）要短一些 */
  repMs: number
  /** length of one set timeline, ms */
  setDuration: number
  /** rest between sets, ms */
  restDuration: number
  /** events for a single set; `count` restarts at 1 every set（仅 reps 模式） */
  setEvents: DemoEvent[]
}

/** 跟练页剪影的姿态类别；有摄像头计数规则的动作与规则关节保持一致 */
export type FigureKind = 'knee' | 'elbow' | 'shoulder' | 'calf'

const CONF = [0.88, 0.92, 0.90, 0.93, 0.89, 0.91]

function buildSet(
  reps: number,
  countOn: ExercisePhase,
  otherOn: ExercisePhase,
  repMs = 2600,
  occlusionAfterMs?: number
): DemoEvent[] {
  const countOffset = Math.round(repMs * 0.5)
  const events: DemoEvent[] = [
    { time: 0, state: 'ready', confidence: 0, message: '准备开始' },
    { time: 1000, state: 'ready', confidence: 0.88, message: '保持全身入镜，跟随节奏' }
  ]

  for (let rep = 1; rep <= reps; rep++) {
    const start = 2000 + (rep - 1) * repMs
    events.push({ time: start, state: otherOn, confidence: CONF[rep % CONF.length] })
    events.push({
      time: start + countOffset,
      state: countOn,
      confidence: CONF[(rep + 1) % CONF.length],
      count: rep
    })
    if (occlusionAfterMs && start < occlusionAfterMs && start + countOffset >= occlusionAfterMs) {
      events.push({ time: start + countOffset + 300, state: 'occluded', confidence: 0.45, message: '身体被遮挡，请保持全身入镜' })
      events.push({ time: start + countOffset + 900, state: otherOn, confidence: CONF[rep % CONF.length] })
    }
  }

  const last = 2000 + (reps - 1) * repMs + countOffset
  events.push({ time: last + 600, state: 'complete', confidence: 0.91, count: reps, message: '本组完成' })
  return events
}

function makeExercise(
  name: string,
  type: TrainingType,
  kind: FigureKind,
  sets: number,
  repsPerSet: number,
  repMs: number,
  setEvents: DemoEvent[]
): DemoExercise {
  return {
    name,
    type,
    kind,
    mode: 'reps',
    sets,
    repsPerSet,
    repMs,
    setDuration: setEvents[setEvents.length - 1].time,
    restDuration: 6000,
    setEvents
  }
}

/** 计时保持型（F18）：每组按 holdSeconds 倒计时，没有次数 */
function makeHold(name: string, type: TrainingType, sets: number, holdSeconds: number): DemoExercise {
  return {
    name,
    type,
    kind: 'knee',
    mode: 'time',
    sets,
    repsPerSet: 0,
    holdSeconds,
    repMs: 0,
    setDuration: holdSeconds * 1000,
    restDuration: 6000,
    setEvents: []
  }
}

/** 计步型（F18）：一组到底，DeviceMotion 计步，传感器不可用时退回手动计时 */
function makeSteps(name: string, type: TrainingType, targetMinutes: number): DemoExercise {
  return {
    name,
    type,
    kind: 'knee',
    mode: 'steps',
    sets: 1,
    repsPerSet: 0,
    targetMinutes,
    repMs: 0,
    setDuration: targetMinutes * 60_000,
    restDuration: 0,
    setEvents: []
  }
}

// 演示条目与动作库同名（exercises.ts），摄像头计数规则在库里按动作配置。
// 坐站训练放第一位：没有带 exercise 参数进入时默认跟练它。
export const demoExercises: DemoExercise[] = [
  // —— 计次型 ——
  makeExercise('坐站训练', '坐站训练', 'knee', 2, 8, 2600, buildSet(8, 'up', 'down', 2600, 8000)),
  makeExercise('肩环绕', '动态热身', 'shoulder', 1, 10, 2000, buildSet(10, 'down', 'up', 2000)),
  makeExercise('髋部摆动', '动态热身', 'knee', 1, 10, 2400, buildSet(10, 'up', 'down', 2400)),
  makeExercise('高抬腿走', '动态热身', 'knee', 1, 20, 1500, buildSet(20, 'up', 'down', 1500)),
  makeExercise('动态弓步转体', '动态热身', 'knee', 1, 8, 3000, buildSet(8, 'up', 'down', 3000)),
  makeExercise('站姿弯举', '站姿弯举', 'elbow', 2, 10, 2600, buildSet(10, 'down', 'up', 2600)),
  makeExercise('弹力带弯举', '站姿弯举', 'elbow', 2, 10, 2600, buildSet(10, 'down', 'up', 2600)),
  makeExercise('水瓶替代弯举', '站姿弯举', 'elbow', 2, 12, 2400, buildSet(12, 'down', 'up', 2400)),
  makeExercise('弹力带划船', '其他', 'elbow', 2, 12, 2600, buildSet(12, 'down', 'up', 2600)),
  makeExercise('台阶上下', '其他', 'knee', 2, 10, 2800, buildSet(10, 'up', 'down', 2800)),
  makeExercise('提踵', '其他', 'calf', 2, 15, 1800, buildSet(15, 'up', 'down', 1800)),
  // —— 计时保持型（F18）——
  makeHold('靠墙静蹲', '其他', 2, 30),
  makeHold('平板支撑', '其他', 2, 30),
  makeHold('侧支撑（屈膝）', '其他', 2, 20),
  makeHold('大腿后侧拉伸', '舒缓整理', 2, 25),
  makeHold('腹式呼吸放松', '舒缓整理', 1, 60),
  // —— 计步型（F18）——
  makeSteps('快走', '跑步', 20),
  makeSteps('轻松跑', '跑步', 20)
]

export function getDemoExercise(name: string | undefined): DemoExercise {
  return demoExercises.find(e => e.name === name) || demoExercises[0]
}

/** 从计划页带进跟练页的覆盖参数；只接受有限范围内的整数，非法值直接忽略 */
export interface PlanExerciseOverride {
  planItemId?: string
  sets?: number
  reps?: number
  hold?: number
  minutes?: number
}

function readInt(value: unknown, min: number, max: number): number | undefined {
  const raw = Array.isArray(value) ? value[0] : value
  const n = typeof raw === 'string' ? Number(raw) : typeof raw === 'number' ? raw : NaN
  if (!Number.isFinite(n)) return undefined
  const i = Math.round(n)
  return i >= min && i <= max ? i : undefined
}

export function readPlanOverrides(query: Record<string, unknown>): PlanExerciseOverride {
  const planItemId = typeof query.planItemId === 'string' && query.planItemId.trim()
    ? query.planItemId.trim().slice(0, 120)
    : undefined
  return {
    planItemId,
    sets: readInt(query.sets, 1, 20),
    reps: readInt(query.reps, 1, 200),
    hold: readInt(query.hold, 5, 600),
    minutes: readInt(query.minutes, 1, 240)
  }
}

/** 从现有时间线反推计数相位，再按新的每组次数重建演示节奏 */
function rebuildRepTimeline(base: DemoExercise, reps: number): DemoEvent[] {
  const countEvent = base.setEvents.find(e => e.count === 1)
  if (!countEvent) return base.setEvents
  const countIndex = base.setEvents.indexOf(countEvent)
  const countOn = countEvent.state
  const otherOn = [...base.setEvents.slice(0, countIndex)]
    .reverse()
    .find(e => e.state !== 'ready' && e.state !== 'occluded')?.state
    ?? (countOn === 'down' ? 'up' : 'down')
  return buildSet(reps, countOn, otherOn, base.repMs)
}

/** 不可变覆盖：计划项只改启动参数，不修改 demoExercises 里的共享对象 */
export function applyPlanOverrides(exercise: DemoExercise, override: PlanExerciseOverride = {}): DemoExercise {
  const next = { ...exercise }
  if (exercise.mode === 'reps') {
    next.sets = override.sets ?? exercise.sets
    next.repsPerSet = override.reps ?? exercise.repsPerSet
    if (next.repsPerSet !== exercise.repsPerSet) {
      next.setEvents = rebuildRepTimeline(exercise, next.repsPerSet)
      next.setDuration = next.setEvents[next.setEvents.length - 1]?.time ?? exercise.setDuration
    }
    return next
  }
  if (exercise.mode === 'time') {
    next.sets = override.sets ?? exercise.sets
    next.holdSeconds = override.hold ?? exercise.holdSeconds ?? 30
    next.repsPerSet = 0
    next.setDuration = next.holdSeconds * 1000
    next.setEvents = []
    return next
  }
  next.sets = 1
  next.targetMinutes = override.minutes ?? exercise.targetMinutes ?? 20
  next.repsPerSet = 0
  next.setDuration = next.targetMinutes * 60_000
  next.setEvents = []
  return next
}

/** 动作选择 chip 的文案：计次 2×8 / 计时 2×30秒 / 计步 20分钟 */
export function exerciseChipLabel(e: DemoExercise): string {
  if (e.mode === 'time') return `${e.sets}×${e.holdSeconds}秒`
  if (e.mode === 'steps') return `${e.targetMinutes}分钟`
  return `${e.sets}×${e.repsPerSet}`
}

/** 阶段文案按姿态类别区分：同一个 'down'，蹲类是"下蹲"，弯举类是"弯起" */
const PHASE_TEXT: Record<FigureKind, { down: string; up: string }> = {
  knee: { down: '下蹲', up: '起身' },
  elbow: { down: '弯起', up: '还原' },
  shoulder: { down: '下摆', up: '上举' },
  calf: { down: '落下', up: '提起' }
}

/**
 * Get phase display text
 */
export function getPhaseText(phase: ExercisePhase, kind: FigureKind = 'knee'): string {
  if (phase === 'down') return PHASE_TEXT[kind].down
  if (phase === 'up') return PHASE_TEXT[kind].up
  const phaseMap: Record<Exclude<ExercisePhase, 'down' | 'up'>, string> = {
    idle: '待机',
    ready: '准备',
    occluded: '遮挡',
    complete: '完成'
  }
  return phaseMap[phase as Exclude<ExercisePhase, 'down' | 'up'>] || '未知'
}

/**
 * Get confidence level display
 */
export function getConfidenceLevel(confidence: number): {
  level: 'high' | 'medium' | 'low'
  text: string
} {
  if (confidence >= 0.8) {
    return { level: 'high', text: '识别良好' }
  } else if (confidence >= 0.5) {
    return { level: 'medium', text: '识别一般' }
  } else {
    return { level: 'low', text: '识别较差' }
  }
}

export interface SessionInput {
  exercise: DemoExercise
  /** 从计划项启动时带上，便于把训练反馈与该条计划关联 */
  planItemId?: string
  /** 已完成的组数（三种模式通用） */
  setsCompleted: number
  /** reps 模式每组次数；time/steps 模式传空数组 */
  repsBySet: number[]
  /** steps 模式：DeviceMotion 计到的步数（0 = 未计步，落库时不写 actualReps） */
  steps?: number
  averageConfidence: number
  manualCorrections: number
  elapsedMs: number
}

/**
 * 把一次跟练写成训练记录（按课次类型分型，F18）。
 * actualDuration 的契约是「分钟」（weekRules.loadOf 按分钟×RPE 算负荷），
 * 之前写成秒是单位错误，这里统一按分钟落库，短于 1 分钟记 0.5 的倍数。
 */
export function summarizeSession(input: SessionInput): Omit<TrainingSession, 'id' | 'userId' | 'createdAt'> {
  const { exercise, setsCompleted, repsBySet } = input
  const minutes = Math.max(Math.round((input.elapsedMs / 60_000) * 10) / 10, 0.1)
  const base = {
    planItemId: input.planItemId,
    date: new Date().toISOString().slice(0, 10),
    exerciseName: exercise.name,
    type: exercise.type,
    actualDuration: minutes,
    actualSets: setsCompleted,
    rpe: null,
    discomfort: false,
    cameraUsed: false,
    manualCorrections: input.manualCorrections
  }

  if (exercise.mode === 'time') {
    return {
      ...base,
      actualReps: undefined,
      completionStatus: setsCompleted >= exercise.sets ? 'completed' : 'partial',
      confidence: Math.round(input.averageConfidence * 100) / 100
    }
  }

  if (exercise.mode === 'steps') {
    const hitTarget = input.elapsedMs >= (exercise.targetMinutes ?? 0) * 60_000
    return {
      ...base,
      // 计步口径（plan.md §4.3）：只给步数与时长；距离要么标估算要么不给——这里不给
      actualReps: input.steps && input.steps > 0 ? input.steps : undefined,
      completionStatus: hitTarget ? 'completed' : 'partial',
      confidence: undefined
    }
  }

  const plannedReps = exercise.repsPerSet * exercise.sets
  const actualReps = repsBySet.reduce((sum, n) => sum + n, 0)
  const allSetsDone = setsCompleted >= exercise.sets && repsBySet.length === exercise.sets
  return {
    ...base,
    cameraUsed: true,
    actualReps,
    completionStatus: allSetsDone && actualReps >= plannedReps ? 'completed' : 'partial',
    confidence: Math.round(input.averageConfidence * 100) / 100
  }
}
