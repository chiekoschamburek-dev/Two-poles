// ===== Demo Camera Service =====
// Pre-scripted counting events for demonstration (one timeline per set)

import type { DemoEvent, ExercisePhase, TrainingType, TrainingSession } from '@/types/domain'

export interface DemoExercise {
  name: string
  type: TrainingType
  /** 演示剪影与阶段文案按哪套姿态渲染：knee 下蹲起身 / elbow 弯举还原 / shoulder 上举下摆 / calf 提踵落下 */
  kind: FigureKind
  sets: number
  repsPerSet: number
  /** 单次行程的演示时长，ms；快动作（高抬腿）要短一些 */
  repMs: number
  /** length of one set timeline, ms */
  setDuration: number
  /** rest between sets, ms */
  restDuration: number
  /** events for a single set; `count` restarts at 1 every set */
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
    sets,
    repsPerSet,
    repMs,
    setDuration: setEvents[setEvents.length - 1].time,
    restDuration: 6000,
    setEvents
  }
}

// 演示条目与动作库同名（exercises.ts），摄像头计数规则在库里按动作配置。
// 坐站训练放第一位：没有带 exercise 参数进入时默认跟练它。
export const demoExercises: DemoExercise[] = [
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
  makeExercise('提踵', '其他', 'calf', 2, 15, 1800, buildSet(15, 'up', 'down', 1800))
]

export function getDemoExercise(name: string | undefined): DemoExercise {
  return demoExercises.find(e => e.name === name) || demoExercises[0]
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
  setsCompleted: number
  repsBySet: number[]
  averageConfidence: number
  manualCorrections: number
  elapsedMs: number
}

/**
 * Turn a played demo run into a training session record
 */
export function summarizeSession(input: SessionInput): Omit<TrainingSession, 'id' | 'userId' | 'createdAt'> {
  const { exercise, setsCompleted, repsBySet } = input
  const plannedReps = exercise.repsPerSet * exercise.sets
  const actualReps = repsBySet.reduce((sum, n) => sum + n, 0)
  const allSetsDone = setsCompleted >= exercise.sets && repsBySet.length === exercise.sets

  return {
    planItemId: undefined,
    date: new Date().toISOString().slice(0, 10),
    exerciseName: exercise.name,
    type: exercise.type,
    actualDuration: Math.round(input.elapsedMs / 1000),
    actualSets: repsBySet.length,
    actualReps,
    completionStatus: allSetsDone && actualReps >= plannedReps ? 'completed' : 'partial',
    rpe: null,
    discomfort: false,
    cameraUsed: true,
    manualCorrections: input.manualCorrections,
    confidence: Math.round(input.averageConfidence * 100) / 100
  }
}
