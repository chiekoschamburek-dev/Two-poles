// 计划生成的单一来源：PlanView 与周报都用它，避免"计划数"两处算得不一样。
import type { AlternativeExercise, PlanItem, TrainingType } from '@/types/domain'
import { toISODate } from '@/utils/time'

export const PLAN_VERSION = 2

export const alternatives: Record<string, AlternativeExercise[]> = {
  站姿弯举: [
    { id: 'alt-band', name: '弹力带弯举', reason: '同等负荷，关节压力更小', sets: 2, reps: 10 },
    { id: 'alt-water', name: '水瓶替代弯举', reason: '无器材时的等效动作', sets: 2, reps: 12 }
  ]
}

export function itemsFor(d: Date, version: number = PLAN_VERSION): PlanItem[] {
  const date = toISODate(d)
  const build = (
    name: string, type: TrainingType, note: string, minutes: number,
    extra: Partial<PlanItem> = {}
  ): PlanItem => ({
    id: `${date}-${name}`,
    planId: `plan-v${version}`,
    date,
    exerciseName: name,
    type,
    note,
    plannedDuration: minutes,
    locked: false,
    completed: false,
    alternatives: alternatives[name],
    ...extra
  }) as PlanItem

  switch (d.getDay()) {
    case 1:
      return [
        build('动态热身', '动态热身', '舒展 · 激活全身', 4),
        build('无器材循环', '其他', '4 个动作 · 低冲击', 16)
      ]
    case 3:
      return [
        build('动态热身', '动态热身', '舒展 · 激活全身', 4),
        build('坐站训练', '坐站训练', '2 组 × 8 次', 6, { plannedSets: 2, plannedReps: 8, locked: true }),
        build('站姿弯举', '站姿弯举', '2 组 × 10 次', 6, { plannedSets: 2, plannedReps: 10 })
      ]
    case 5:
      return [
        build('跑步', '跑步', '轻松跑 · 保持可对话节奏', 20),
        build('舒缓整理', '舒缓整理', '呼吸 · 放松', 4)
      ]
    default:
      return []
  }
}

export function isPlanDay(d: Date): boolean {
  return itemsFor(d).length > 0
}
