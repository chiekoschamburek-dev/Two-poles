// 周报聚合：负荷只在 RPE 有记录的日子计算，缺失的日子保持"未记录"而不是 0。
import type { FoodCategory, Meal, TrainingSession, WeeklyReport } from '@/types/domain'
import { toISODate } from '@/utils/time'
import { isPlanDay } from './planRules'
import { FOOD_CATEGORIES, RULE_VERSION } from './mealRules'

export const WEEK_LABELS = ['一', '二', '三', '四', '五', '六', '日']

export function weekStart(d: Date): Date {
  const x = new Date(d)
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7))
  x.setHours(0, 0, 0, 0)
  return x
}

export function weekDates(start: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => {
    const x = new Date(start)
    x.setDate(start.getDate() + i)
    return x
  })
}

/** 单次训练的负荷 = 时长 × RPE；缺任一项则不可计算 */
export function loadOf(session: TrainingSession): number | null {
  if (session.rpe === null || !session.actualDuration) return null
  return Math.round(session.actualDuration * session.rpe)
}

export function buildWeeklyReport(sessions: TrainingSession[], meals: Meal[], reference: Date): WeeklyReport {
  const start = weekStart(reference)
  const days = weekDates(start)
  const isoDays = days.map(toISODate)
  const inWeek = sessions.filter(s => isoDays.includes(s.date))
  const weekMeals = meals.filter(m => isoDays.includes(m.date))

  const loadByDay = isoDays.map(date => {
    const ofDay = inWeek.filter(s => s.date === date)
    if (!ofDay.length) return null
    const loads = ofDay.map(loadOf)
    if (loads.some(l => l === null)) return null
    return loads.reduce<number>((sum, l) => sum + (l ?? 0), 0)
  })

  const plannedDays = days.filter(isPlanDay)
  const completedDates = [...new Set(inWeek.map(s => s.date))]
  const totalLoad = loadByDay.some(l => l !== null)
    ? loadByDay.reduce<number>((sum, l) => sum + (l ?? 0), 0)
    : null
  const rpeMissing = inWeek.filter(s => s.rpe === null).map(s => `${s.date.slice(5)} ${s.exerciseName}`)

  const categoryCoverage = Object.fromEntries(FOOD_CATEGORIES.map(c => [c, 0])) as Record<FoodCategory, number>
  for (const meal of weekMeals) {
    for (const item of meal.items) categoryCoverage[item.category] += 1
  }

  const mealDays = new Set(weekMeals.map(m => m.date))
  const dataQuality: string[] = []
  if (!inWeek.length) dataQuality.push('本周还没有训练记录，负荷图表为空而不是 0。')
  if (rpeMissing.length) dataQuality.push(`${rpeMissing.length} 条训练未记录 RPE：${rpeMissing.join('、')}。这些条目不参与负荷计算。`)
  if (completedDates.length < plannedDays.length) {
    dataQuality.push(`计划 ${plannedDays.length} 天，有记录 ${completedDates.length} 天；未记录不等于没练，也不计入完成率。`)
  }
  dataQuality.push(`餐食：本周 ${mealDays.size} 天有记录，其余显示"未记录"，不代表未摄入。`)

  return {
    userId: sessions[0]?.userId ?? 'demo-user',
    weekStartDate: isoDays[0],
    weekEndDate: isoDays[6],
    plannedSessions: plannedDays.length,
    completedSessions: completedDates.length,
    totalDuration: inWeek.reduce((sum, s) => sum + (s.actualDuration ?? 0), 0),
    totalDistance: inWeek.reduce((sum, s) => sum + (s.actualDistance ?? 0), 0),
    totalLoad,
    loadByDay,
    missingSessions: rpeMissing,
    totalMeals: weekMeals.length,
    recordedMeals: weekMeals.filter(m => m.completeness !== 'unknown').length,
    completeMeals: weekMeals.filter(m => m.completeness === 'complete').length,
    categoryCoverage,
    dataQuality,
    ruleVersion: `report-rules-v1 / ${RULE_VERSION}`
  }
}
