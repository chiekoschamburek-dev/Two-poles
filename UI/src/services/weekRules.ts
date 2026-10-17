// 周报聚合：负荷只在 RPE 有记录的日子计算，缺失的日子保持"未记录"而不是 0。
import type { FoodCategory, Meal, Mode, TrainingSession, UserProfile, WeeklyReport } from '@/types/domain'
import { toISODate } from '@/utils/time'
import { isPlanDay } from './planRules'
import { FOOD_CATEGORIES, RULE_VERSION } from './mealRules'

export const WEEK_LABELS = ['一', '二', '三', '四', '五', '六', '日']

export interface ReportContext {
  profile?: UserProfile | null
  mode?: Mode
}

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

export interface WeekSummary extends WeeklyReport {
  /** 本周模板安排的天数（按档案过滤后的实际安排） */
  plannedDays: string[]
  /** 有完整 RPE 因而计入负荷的天数 */
  loadDays: number
  /** 因缺 RPE 而未计入负荷的天数 */
  unloadedDays: number
  /** 没有安排训练时不计算完成率 */
  completionRate: number | null
  /** 本周任一天报了不适：阻止自动加量建议（文档 §7） */
  blockedByDiscomfort: boolean
}

export function buildWeeklyReport(
  sessions: TrainingSession[],
  meals: Meal[],
  reference: Date,
  ctx: ReportContext = {}
): WeekSummary {
  const profile = ctx.profile ?? null
  const mode = ctx.mode ?? 'public'
  const start = weekStart(reference)
  const days = weekDates(start)
  const isoDays = days.map(toISODate)
  const inWeek = sessions.filter(s => isoDays.includes(s.date))
  const weekMeals = meals.filter(m => isoDays.includes(m.date))

  const loadByDay = isoDays.map(date => {
    const ofDay = inWeek.filter(s => s.date === date)
    if (!ofDay.length) return null
    const loads = ofDay.map(loadOf)
    // 当天只要有一条缺 RPE，整天都不出数——避免把缺失当成 0 拉平趋势
    if (loads.some(l => l === null)) return null
    return loads.reduce<number>((sum, l) => sum + (l ?? 0), 0)
  })

  const plannedDays = days.filter(d => isPlanDay(d, profile, mode)).map(toISODate)
  const completedDates = [...new Set(inWeek.map(s => s.date))]
  const countedDays = loadByDay.filter(l => l !== null)
  // 合计只累加有 RPE 的天；缺的天不进合计，并在数据质量里说明覆盖范围
  const totalLoad = countedDays.length ? countedDays.reduce((sum, l) => sum + (l ?? 0), 0) : null
  const rpeMissing = inWeek.filter(s => s.rpe === null).map(s => `${s.date.slice(5)} ${s.exerciseName}`)

  const categoryCoverage = Object.fromEntries(FOOD_CATEGORIES.map(c => [c, 0])) as Record<FoodCategory, number>
  for (const meal of weekMeals) {
    for (const item of meal.items) categoryCoverage[item.category] += 1
  }

  const mealDays = new Set(weekMeals.map(m => m.date))
  const dataQuality: string[] = []
  if (!inWeek.length) dataQuality.push('本周还没有训练记录，负荷图表为空而不是 0。')
  if (rpeMissing.length) dataQuality.push(`${rpeMissing.length} 条训练未记录 RPE：${rpeMissing.join('、')}。这些条目不参与负荷计算。`)
  if (totalLoad !== null) {
    dataQuality.push(`负荷合计覆盖 ${countedDays.length} 天（本周有记录的 ${new Set(inWeek.map(s => s.date)).size} 天中）；缺 RPE 的天按未计入处理，不按 0 补齐。`)
  }
  if (!plannedDays.length) {
    dataQuality.push('按你的档案，这一周没有安排训练，因此不计算完成率。')
  } else if (completedDates.length < plannedDays.length) {
    dataQuality.push(`安排 ${plannedDays.length} 天，有记录 ${completedDates.length} 天；未记录不等于没练，也不计入完成率。`)
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
    ruleVersion: `report-rules-v2 / ${RULE_VERSION}`,
    plannedDays,
    loadDays: countedDays.length,
    unloadedDays: new Set(inWeek.map(s => s.date)).size - countedDays.length,
    completionRate: plannedDays.length ? completedDates.length / plannedDays.length : null,
    blockedByDiscomfort: inWeek.some(s => s.discomfort)
  }
}
