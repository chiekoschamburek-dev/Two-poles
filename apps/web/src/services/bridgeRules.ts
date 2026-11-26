// 两仪之间的"同期对照"层：只把运动和饮食放在同一时间窗口里并排看，
// 不推断因果、不提供营养处方、不因为训练记录建议加量或减量。
//
// 三条口径：
// 1) 未记录 ≠ 没发生：没记的餐次与没记的训练都只标"未记录"，不补 0。
// 2) 训练日 / 无训练日按"当天是否有训练记录"分，不按计划分——这里比较的是已经发生的事。
// 3) 类别覆盖只数"出现过哪些类"，不是份量、热量或营养摄入。
import type { FoodCategory, Meal, TrainingSession } from '@/types/domain'
import { toISODate } from '@/utils/time'
import { FOOD_CATEGORIES, MEAL_SLOTS } from './mealRules'
import { weekDates, weekStart } from './weekRules'

export const BRIDGE_RULE_VERSION = 'bridge-rules-v1'

/** 与饮食页同一口径：只要求这 8 类，油脂与其他不做要求 */
export const EXPECTED_CATEGORIES: FoodCategory[] = FOOD_CATEGORIES.slice(0, 8)

/** 计划里的正餐数（加餐不计入 3 餐） */
export const MAIN_MEAL_SLOTS = MEAL_SLOTS.length

export interface DayFacts {
  date: string
  /** 当天训练记录条数 */
  sessions: number
  /** 当天训练记录的总时长（分钟） */
  sessionMinutes: number
  /** 只统计记了 RPE 的场次；一场都没记时为 null */
  avgRpe: number | null
  discomfort: boolean
  /** 当天餐食记录条数（含加餐） */
  meals: number
  /** 已记录的正餐档数 0–3；同餐次记两条只算一档 */
  recordedSlots: number
  completeMeals: number
  coverage: FoodCategory[]
  missing: FoodCategory[]
  snackCount: number
}

export interface WeekFacts {
  dates: string[]
  days: DayFacts[]
  /** 有训练记录的天数 */
  sessionDays: number
  /** 有训练记录且报了不适的天数 */
  discomfortDays: number
  /** 有餐食记录的天数 */
  mealDays: number
  /** 两边都有记录的天数 */
  pairedDays: number
  movementOnlyDays: number
  nutritionOnlyDays: number
  emptyDays: number
  sessionCount: number
  sessionMinutes: number
  mealCount: number
  completeMeals: number
  /** 有训练记录的日子里，平均出现过几类食物（保留 1 位） */
  avgCoverageTraining: number | null
  /** 无训练记录但有餐食记录的日子里，平均出现过几类食物 */
  avgCoverageRest: number | null
  trainingSampleDays: number
  restSampleDays: number
  /** 训练日 − 无训练日（类）；任一侧样本 < 2 天时为 null */
  coverageGap: number | null
  /** 本周有训练记录的天数占比 0–1，用于双极环 */
  movementRate: number
  /** 本周有餐食记录的天数占比 0–1，用于双极环 */
  nutritionRate: number
}

export type BridgeTone = 'movement' | 'nutrition' | 'caution' | 'neutral'
export type BridgeTarget = 'movement' | 'nutrition' | 'plan' | 'meals' | 'report' | 'execution'

export interface BridgeSignal {
  id: string
  tone: BridgeTone
  kind: 'today' | 'week' | 'safety'
  title: string
  detail: string
  action: { label: string; target: BridgeTarget }
}

export const BRIDGE_LIMITS = [
  '运动与饮食只做同期对照：同一天出现不代表因果。',
  '未记录不等于没发生：餐食没记不代表没吃，训练没记不代表没练。',
  '类别覆盖不等于营养摄入：不判断份量、烹调方式与油盐糖。',
  '负荷只在有 RPE 与时长时计算；缺一项就留空，不按 0 补齐。',
  '这里没有营养处方，也不会根据训练记录建议加量或减量。'
]

const round1 = (value: number) => Math.round(value * 10) / 10
const mean = (values: number[]): number | null =>
  values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : null

/**
 * 一天的事实。计划不参与：这里回答的是"实际记录了什么"，
 * 计划与完成率的对照留给 movement / nutrition 两个面板各自呈现。
 */
export function readDayFacts(sessions: TrainingSession[], meals: Meal[], date: string): DayFacts {
  const daySessions = sessions.filter(s => s.date === date)
  const dayMeals = meals.filter(m => m.date === date)
  const items = dayMeals.flatMap(m => m.items)
  const present = new Set<FoodCategory>(items.map(i => i.category))
  const mainSlots = new Set(
    dayMeals.filter(m => m.mealType !== 'snack').map(m => m.mealType)
  )
  const rpes = daySessions
    .map(s => s.rpe)
    .filter((rpe): rpe is number => rpe !== null)

  return {
    date,
    sessions: daySessions.length,
    sessionMinutes: daySessions.reduce((sum, s) => sum + (s.actualDuration ?? 0), 0),
    avgRpe: rpes.length ? round1(rpes.reduce((sum, rpe) => sum + rpe, 0) / rpes.length) : null,
    discomfort: daySessions.some(s => s.discomfort),
    meals: dayMeals.length,
    recordedSlots: mainSlots.size,
    completeMeals: dayMeals.filter(m => m.completeness === 'complete').length,
    coverage: EXPECTED_CATEGORIES.filter(c => present.has(c)),
    missing: EXPECTED_CATEGORIES.filter(c => !present.has(c)),
    snackCount: dayMeals.filter(m => m.mealType === 'snack').length
  }
}

/** 自然周（周一起）的同期事实 */
export function buildWeekFacts(
  sessions: TrainingSession[],
  meals: Meal[],
  reference: Date = new Date()
): WeekFacts {
  const dates = weekDates(weekStart(reference)).map(toISODate)
  const days = dates.map(date => readDayFacts(sessions, meals, date))

  const sessionDays = days.filter(d => d.sessions > 0).length
  const discomfortDays = days.filter(d => d.discomfort).length
  const mealDays = days.filter(d => d.meals > 0).length
  const pairedDays = days.filter(d => d.sessions > 0 && d.meals > 0).length
  const movementOnlyDays = days.filter(d => d.sessions > 0 && d.meals === 0).length
  const nutritionOnlyDays = days.filter(d => d.sessions === 0 && d.meals > 0).length
  const emptyDays = days.filter(d => d.sessions === 0 && d.meals === 0).length

  // 训练日看"有训练记录"的日子；无训练日只取"有餐食记录"的日子，
  // 否则整周没记的空白天会以 0 类把这一侧拉平——那会把缺失当成事实。
  const trainingDays = days.filter(d => d.sessions > 0)
  const restDays = days.filter(d => d.sessions === 0 && d.meals > 0)
  const trainingCoverage = trainingDays.map(d => d.coverage.length)
  const restCoverage = restDays.map(d => d.coverage.length)
  const avgTraining = mean(trainingCoverage)
  const avgRest = mean(restCoverage)
  const hasSamples = trainingDays.length >= 2 && restDays.length >= 2

  return {
    dates,
    days,
    sessionDays,
    discomfortDays,
    mealDays,
    pairedDays,
    movementOnlyDays,
    nutritionOnlyDays,
    emptyDays,
    sessionCount: days.reduce((sum, d) => sum + d.sessions, 0),
    sessionMinutes: days.reduce((sum, d) => sum + d.sessionMinutes, 0),
    mealCount: days.reduce((sum, d) => sum + d.meals, 0),
    completeMeals: days.reduce((sum, d) => sum + d.completeMeals, 0),
    avgCoverageTraining: avgTraining === null ? null : round1(avgTraining),
    avgCoverageRest: avgRest === null ? null : round1(avgRest),
    trainingSampleDays: trainingDays.length,
    restSampleDays: restDays.length,
    coverageGap: hasSamples && avgTraining !== null && avgRest !== null
      ? round1(avgTraining - avgRest)
      : null,
    movementRate: sessionDays / 7,
    nutritionRate: mealDays / 7
  }
}

/**
 * 今日 + 本周的联动提示。顺序按"今天的事实 → 本周的结构 → 安全"，
 * 最多四条；文案一律只陈述同期，不给建议。
 */
export function buildBridgeSignals(day: DayFacts, week: WeekFacts): BridgeSignal[] {
  const signals: BridgeSignal[] = []
  const missingMeals = Math.max(0, MAIN_MEAL_SLOTS - day.recordedSlots)

  if (day.discomfort) {
    signals.push({
      id: 'discomfort',
      tone: 'caution',
      kind: 'safety',
      title: '今天有训练记录报了不适',
      detail: '协同分析不会据此建议加量，也不会把某一餐当作处理办法。持续或明显的不适请按周报里的说明处理。',
      action: { label: '看周报', target: 'report' }
    })
  } else if (week.discomfortDays > 0) {
    signals.push({
      id: 'week-discomfort',
      tone: 'caution',
      kind: 'safety',
      title: `本周有 ${week.discomfortDays} 天训练记录报了不适`,
      detail: '周报只保留事实记录，不给出加量建议；协同分析也不会据此改餐。',
      action: { label: '看周报', target: 'report' }
    })
  }

  if (day.sessions > 0 && missingMeals > 0) {
    signals.push({
      id: 'training-with-missing-meals',
      tone: 'nutrition',
      kind: 'today',
      title: `今天已记录运动 ${day.sessionMinutes} 分钟，饮食还差 ${missingMeals} 餐没记`,
      detail: '只是记录提醒：未记录不等于没吃，也不代表现在该吃什么。',
      action: { label: '去记一餐', target: 'nutrition' }
    })
  } else if (day.sessions > 0) {
    signals.push({
      id: 'both-recorded-today',
      tone: 'neutral',
      kind: 'today',
      title: '今天两仪都有记录',
      detail: `${day.sessionMinutes} 分钟运动 · 正餐 ${day.recordedSlots}/3 · 覆盖 ${day.coverage.length}/8 类。两组数字只是并排出现。`,
      action: { label: '看完整对照', target: 'report' }
    })
  } else if (day.recordedSlots > 0) {
    signals.push({
      id: 'meals-without-movement',
      tone: 'movement',
      kind: 'today',
      title: `今天已记 ${day.recordedSlots} 餐，运动这一极还没有记录`,
      detail: '没有记录不等于没运动；想动一动时再记一笔就行。',
      action: { label: '去运动', target: 'movement' }
    })
  } else {
    signals.push({
      id: 'both-empty-today',
      tone: 'neutral',
      kind: 'today',
      title: '今天两仪都还空着',
      detail: '空着是合法状态。想记录的时候，先记其中一边也可以。',
      action: { label: '记一餐', target: 'nutrition' }
    })
  }

  if (week.sessionDays > 0 && week.mealDays === 0) {
    signals.push({
      id: 'week-movement-only',
      tone: 'nutrition',
      kind: 'week',
      title: `本周 ${week.sessionDays} 天有训练记录，餐食一次还没记`,
      detail: '这周的两仪目前只有运动一极；餐食记录只统计类别，不评价吃法。',
      action: { label: '去记一餐', target: 'nutrition' }
    })
  } else if (week.mealDays > 0 && week.sessionDays === 0) {
    signals.push({
      id: 'week-nutrition-only',
      tone: 'movement',
      kind: 'week',
      title: `本周 ${week.mealDays} 天有餐食记录，训练一次还没记`,
      detail: '记录餐食不等于完成训练；没有训练记录也不代表没练。',
      action: { label: '去运动', target: 'movement' }
    })
  }

  if (week.coverageGap !== null && Math.abs(week.coverageGap) >= 0.8) {
    signals.push({
      id: 'week-coverage-gap',
      tone: 'neutral',
      kind: 'week',
      title: '训练日与无训练日的类别覆盖有差',
      detail: `训练日平均 ${week.avgCoverageTraining} 类（${week.trainingSampleDays} 天），无训练日 ${week.avgCoverageRest} 类（${week.restSampleDays} 天）。同期出现，不代表因果。`,
      action: { label: '看周报', target: 'report' }
    })
  } else if (week.pairedDays >= 2) {
    signals.push({
      id: 'week-paired',
      tone: 'neutral',
      kind: 'week',
      title: `本周有 ${week.pairedDays} 天两边都有记录`,
      detail: `共 ${week.sessionDays} 天运动、${week.mealDays} 天餐食记录；这是并排对照，不是配对结论。`,
      action: { label: '看周报', target: 'report' }
    })
  }

  return signals.slice(0, 4)
}

/** 移动端底部"另一极"的主行文案；周次与类别覆盖由调用方放在下一行，避免重复 */
export function peekLine(pole: 'movement' | 'nutrition', day: DayFacts): string {
  if (pole === 'movement') {
    return day.sessions > 0 ? `今天 ${day.sessionMinutes} 分钟` : '今天还没记录'
  }
  return day.recordedSlots > 0 ? `今天 ${day.recordedSlots}/3 餐` : '今天还没记录'
}
