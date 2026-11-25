// 周报聚合：负荷只在 RPE 有记录的日子计算，缺失的日子保持"未记录"而不是 0。
import type { FoodCategory, Meal, Plan, TrainingSession, WeeklyReport } from '@/types/domain'
import { toISODate } from '@/utils/time'
import { FOOD_CATEGORIES, RULE_VERSION } from './mealRules'

export const WEEK_LABELS = ['一', '二', '三', '四', '五', '六', '日']

export interface ReportContext {
  /**
   * 这一周的计划日（ISO 日期），来源是**计划条目**，不是按档案规则推算。
   * 服务端 `/reports/weekly` 就是这么算的；前端如果改按档案规则推算，
   * 同一周联网看服务端结果、离线看本地结果会出现两个覆盖率。
   * 没有计划就是空数组，此时不计算覆盖率。
   */
  plannedDates?: string[]
}

/**
 * 从计划（含历史版本）里取出落在区间内的计划日。
 * 各视图都从这里取，避免「哪些天算计划日」在五处各写一套。
 */
export function plannedDatesOf(plans: Plan[], fromISO: string, toISO: string): string[] {
  const dates = new Set<string>()
  for (const plan of plans) {
    for (const item of plan.items) {
      if (item.date >= fromISO && item.date <= toISO) dates.add(item.date)
    }
  }
  return [...dates].sort()
}

/** 所有计划日（不限区间）：报告层自己会按窗口过滤，视图不必重复算区间 */
export function allPlannedDates(plans: Plan[]): string[] {
  return plannedDatesOf(plans, '0000-01-01', '9999-12-31')
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
  /** 本周的计划日（计划条目所在日期） */
  plannedDays: string[]
  /** 有完整 RPE 因而计入负荷的天数 */
  loadDays: number
  /** 因缺 RPE 而未计入负荷的天数 */
  unloadedDays: number
  /**
   * 计划记录覆盖率 = 计划日中有记录的天数 / 计划日数。
   * 必须能用 recordedPlannedSessions / plannedSessions 复算出来；没有计划时为 null。
   */
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

  const plannedDays = (ctx.plannedDates ?? []).filter(date => isoDays.includes(date)).sort()
  const recordedDays = [...new Set(inWeek.map(s => s.date))].sort()
  // 覆盖率只看计划日有没有记录；非计划日的训练单独说明，不把分子做大
  const recordedPlannedDays = plannedDays.filter(date => recordedDays.includes(date))
  const offPlanDays = recordedDays.filter(date => !plannedDays.includes(date))
  const countedDays = loadByDay.filter(l => l !== null)
  // 合计只累加有 RPE 的天；缺的天不进合计，并在数据质量里说明覆盖范围
  const totalLoad = countedDays.length ? countedDays.reduce<number>((sum, l) => sum + (l ?? 0), 0) : null
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
    dataQuality.push(`负荷合计覆盖 ${countedDays.length} 天（本周有记录的 ${recordedDays.length} 天中）；缺 RPE 的天按未计入处理，不按 0 补齐。`)
  }
  if (!plannedDays.length) {
    dataQuality.push('这一周没有计划条目，因此不计算计划记录覆盖率。到计划页可以生成这一周的安排。')
  } else if (recordedPlannedDays.length < plannedDays.length) {
    dataQuality.push(`计划 ${plannedDays.length} 天，其中有记录 ${recordedPlannedDays.length} 天；未记录的计划日按未覆盖计（未记录不等于没练）。`)
  }
  if (offPlanDays.length) {
    dataQuality.push(`另有 ${offPlanDays.length} 天有训练记录但不在计划日，不计入计划记录覆盖率。`)
  }
  dataQuality.push(`餐食：本周 ${mealDays.size} 天有记录，其余显示"未记录"，不代表未摄入。`)

  return {
    userId: sessions[0]?.userId ?? 'demo-user',
    weekStartDate: isoDays[0],
    weekEndDate: isoDays[6],
    plannedSessions: plannedDays.length,
    // 有记录场次：本周有训练记录的天数，含非计划日；与计划场次不是同一个分母
    completedSessions: recordedDays.length,
    // 计划日中有记录的天数：completionRate 的分子，单独给出来才能被复算
    recordedPlannedSessions: recordedPlannedDays.length,
    offPlanSessions: offPlanDays.length,
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
    unloadedDays: recordedDays.length - countedDays.length,
    completionRate: plannedDays.length ? recordedPlannedDays.length / plannedDays.length : null,
    blockedByDiscomfort: inWeek.some(s => s.discomfort)
  }
}