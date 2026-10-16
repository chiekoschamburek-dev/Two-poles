// ===== Demo Camera Service =====
// Pre-scripted counting events for demonstration (one timeline per set)

import type { DemoEvent, ExercisePhase, TrainingType, TrainingSession } from '@/types/domain'

export interface DemoExercise {
  name: string
  type: TrainingType
  sets: number
  repsPerSet: number
  /** length of one set timeline, ms */
  setDuration: number
  /** rest between sets, ms */
  restDuration: number
  /** events for a single set; `count` restarts at 1 every set */
  setEvents: DemoEvent[]
}

const CONF = [0.88, 0.92, 0.90, 0.93, 0.89, 0.91]

function buildSet(
  reps: number,
  countOn: ExercisePhase,
  otherOn: ExercisePhase,
  occlusionAfterMs?: number
): DemoEvent[] {
  const events: DemoEvent[] = [
    { time: 0, state: 'ready', confidence: 0, message: '准备开始' },
    { time: 1000, state: 'ready', confidence: 0.88, message: '保持全身入镜，跟随节奏' }
  ]

  for (let rep = 1; rep <= reps; rep++) {
    const start = 2000 + (rep - 1) * 2600
    events.push({ time: start, state: otherOn, confidence: CONF[rep % CONF.length] })
    events.push({
      time: start + 1300,
      state: countOn,
      confidence: CONF[(rep + 1) % CONF.length],
      count: rep
    })
    if (occlusionAfterMs && start < occlusionAfterMs && start + 1300 >= occlusionAfterMs) {
      events.push({ time: start + 1600, state: 'occluded', confidence: 0.45, message: '身体被遮挡，请保持全身入镜' })
      events.push({ time: start + 2200, state: otherOn, confidence: CONF[rep % CONF.length] })
    }
  }

  const last = 2000 + (reps - 1) * 2600 + 1300
  events.push({ time: last + 600, state: 'complete', confidence: 0.91, count: reps, message: '本组完成' })
  return events
}

function makeExercise(
  name: string,
  type: TrainingType,
  sets: number,
  repsPerSet: number,
  setEvents: DemoEvent[]
): DemoExercise {
  return {
    name,
    type,
    sets,
    repsPerSet,
    setDuration: setEvents[setEvents.length - 1].time,
    restDuration: 6000,
    setEvents
  }
}

export const demoExercises: DemoExercise[] = [
  makeExercise('坐站训练', '坐站训练', 2, 8, buildSet(8, 'up', 'down', 8000)),
  makeExercise('站姿弯举', '站姿弯举', 2, 10, buildSet(10, 'down', 'up'))
]

export function getDemoExercise(name: string | undefined): DemoExercise {
  return demoExercises.find(e => e.name === name) || demoExercises[0]
}

/**
 * Get phase display text
 */
export function getPhaseText(phase: ExercisePhase): string {
  const phaseMap: Record<ExercisePhase, string> = {
    idle: '待机',
    ready: '准备',
    down: '下蹲阶段',
    up: '起身阶段',
    occluded: '遮挡',
    complete: '完成'
  }
  return phaseMap[phase] || '未知'
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
