// 期间报告：近四周与自然月共用同一套聚合口径。
// 负荷只在“当天所有场次都有 RPE 与时长”时计算；缺失的一天不计入，也不补 0。
import type { FoodCategory, Meal, TrainingSession, UserProfile } from '@/types/domain'
import { toISODate } from '@/utils/time'
import { isPlanDay } from '@/services/planRules'
import { FOOD_CATEGORIES, RULE_VERSION } from '@/services/mealRules'
import { loadOf } from '@/services/weekRules'

export type LoadCompleteness = 'complete' | 'incomplete' | 'none'

export interface ReportBlock {
  start: string
  end: string
  label: string
  load: number | null
  loadCompleteness: LoadCompleteness
  trainingDays: number
  sessions: number
  minutes: number
  plannedDays: number
  mealDays: number
  completeMeals: number
  partialMeals: number
}

export interface LongTermPoint {
  /** YYYY-MM */
  month: string
  label: string
  load: number | null
  loadCompleteness: LoadCompleteness
  trainingDays: number
  hasSession: boolean
  partialMonth: boolean
}

export interface PeriodReport {
  start: string
  end: string
  blocks: ReportBlock[]
  totalLoad: number | null
  loadDays: number
  unloadedDays: number
  trainingDays: number
  totalSessions: number
  totalMinutes: number
  plannedDays: number
  completionRate: number | null
  mealDays: number
  totalMeals: number
  completeMeals: number
  partialMeals: number
  categoryCoverage: Record<FoodCategory, number>
  dataQuality: string[]
  ruleVersion: string
}

export interface PeriodContext {
  profile?: UserProfile | null
}

const startOfDay = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const addDays = (d: Date, n: number): Date => {
  const next = new Date(d)
  next.setDate(next.getDate() + n)
  return next
}
const md = (iso: string): string => {
  const [, m, d] = iso.split('-')
  return `${Number(m)}.${Number(d)}`
}
const blockLabel = (start: string, end: string): string => `${md(start)}–${md(end)}`

function dayList(start: Date, end: Date): string[] {
  const days: string[] = []
  for (let d = startOfDay(start); d <= end; d = addDays(d, 1)) days.push(toISODate(d))
  return days
}

function blockOf(
  start: Date,
  end: Date,
  sessions: TrainingSession[],
  meals: Meal[],
  ctx: PeriodContext
): ReportBlock {
  const days = dayList(start, end)
  const inBlock = sessions.filter(s => days.includes(s.date))
  const trainingDays = new Set(inBlock.map(s => s.date))
  let completeLoad = 0
  let hasCompleteLoad = false
  let hasIncompleteLoad = false
  for (const day of trainingDays) {
    const loads = inBlock.filter(s => s.date === day).map(loadOf)
    if (loads.some(l => l === null)) {
      hasIncompleteLoad = true
      continue
    }
    completeLoad += loads.reduce<number>((sum, l) => sum + (l ?? 0), 0)
    hasCompleteLoad = true
  }
  const blockMeals = meals.filter(m => days.includes(m.date))
  const completeMeals = blockMeals.filter(m => m.completeness === 'complete').length
  return {
    start: days[0],
    end: days[days.length - 1],
    label: blockLabel(days[0], days[days.length - 1]),
    load: hasCompleteLoad ? completeLoad : null,
    loadCompleteness: !inBlock.length ? 'none' : hasIncompleteLoad ? 'incomplete' : 'complete',
    trainingDays: trainingDays.size,
    sessions: inBlock.length,
    minutes: inBlock.reduce((sum, s) => sum + (s.actualDuration ?? 0), 0),
    plannedDays: days.filter(day => isPlanDay(new Date(`${day}T00:00:00`), ctx.profile ?? null)).length,
    mealDays: new Set(blockMeals.map(m => m.date)).size,
    completeMeals,
    partialMeals: blockMeals.length - completeMeals
  }
}

function periodOf(blocks: ReportBlock[], sessions: TrainingSession[], meals: Meal[]): PeriodReport {
  const start = blocks[0].start
  const end = blocks[blocks.length - 1].end
  const inRange = sessions.filter(s => s.date >= start && s.date <= end)
  const inMeals = meals.filter(m => m.date >= start && m.date <= end)
  const trainingDays = new Set(inRange.map(s => s.date))
  let totalLoad: number | null = null
  let loadDays = 0
  let unloadedDays = 0
  for (const day of trainingDays) {
    const loads = inRange.filter(s => s.date === day).map(loadOf)
    if (loads.some(l => l === null)) {
      unloadedDays++
      continue
    }
    totalLoad = (totalLoad ?? 0) + loads.reduce<number>((sum, l) => sum + (l ?? 0), 0)
    loadDays++
  }
  const plannedDays = blocks.reduce((sum, b) => sum + b.plannedDays, 0)
  const categoryCoverage = Object.fromEntries(FOOD_CATEGORIES.map(c => [c, 0])) as Record<FoodCategory, number>
  for (const meal of inMeals) for (const item of meal.items) categoryCoverage[item.category] += 1
  const mealDays = new Set(inMeals.map(m => m.date)).size
  const completeMeals = inMeals.filter(m => m.completeness === 'complete').length

  const dataQuality: string[] = []
  if (!inRange.length) dataQuality.push('这段窗口还没有训练记录，负荷留空而不是 0。')
  const missing = inRange.filter(s => loadOf(s) === null)
  if (missing.length) {
    const sample = missing.slice(0, 6).map(s => `${s.date.slice(5)} ${s.exerciseName}`)
    dataQuality.push(`${missing.length} 条训练未记录 RPE 或时长：${sample.join('、')}${missing.length > sample.length ? ' 等' : ''}。这些条目不参与负荷计算。`)
  }
  if (totalLoad !== null) {
    dataQuality.push(`负荷合计覆盖 ${loadDays} 天（有记录的 ${trainingDays.size} 天中）；缺 RPE 的天按未计入处理，不按 0 补齐。`)
  }
  if (!plannedDays) dataQuality.push('按你的档案，这段窗口没有安排训练，因此不计算完成率。')
  else if (trainingDays.size < plannedDays) {
    dataQuality.push(`安排 ${plannedDays} 天，有记录 ${trainingDays.size} 天；未记录不等于没练，也不计入完成率。`)
  }
  dataQuality.push(`餐食：${mealDays} 天有记录，其余显示"未记录"，不代表未摄入。`)

  return {
    start,
    end,
    blocks,
    totalLoad,
    loadDays,
    unloadedDays,
    trainingDays: trainingDays.size,
    totalSessions: inRange.length,
    totalMinutes: inRange.reduce((sum, s) => sum + (s.actualDuration ?? 0), 0),
    plannedDays,
    completionRate: plannedDays ? trainingDays.size / plannedDays : null,
    mealDays,
    totalMeals: inMeals.length,
    completeMeals,
    partialMeals: inMeals.length - completeMeals,
    categoryCoverage,
    dataQuality,
    ruleVersion: `report-rules-v2 / ${RULE_VERSION}`
  }
}

/** 近四周：以 reference 当天为终点往前 28 天，4 个 7 天块 */
export function buildRollingFourWeeksReport(
  sessions: TrainingSession[],
  meals: Meal[],
  reference: Date = new Date(),
  ctx: PeriodContext = {}
): PeriodReport {
  const end = startOfDay(reference)
  const start = addDays(end, -27)
  const blocks = Array.from({ length: 4 }, (_, i) => {
    const blockStart = addDays(start, i * 7)
    return blockOf(blockStart, addDays(blockStart, 6), sessions, meals, ctx)
  })
  return periodOf(blocks, sessions, meals)
}

/** 长期趋势：最近 months 个自然月，按月聚合；当前月只统计到今天 */
export function buildLongTermTrend(
  sessions: TrainingSession[],
  now: Date = new Date(),
  months = 6
): LongTermPoint[] {
  const points: LongTermPoint[] = []
  for (let offset = months - 1; offset >= 0; offset--) {
    const monthDate = new Date(now.getFullYear(), now.getMonth() - offset, 1)
    const year = monthDate.getFullYear()
    const month = monthDate.getMonth()
    const current = year === now.getFullYear() && month === now.getMonth()
    const start = new Date(year, month, 1)
    const end = current ? startOfDay(now) : new Date(year, month + 1, 0)
    const days = dayList(start, end)
    const inMonth = sessions.filter(s => days.includes(s.date))
    const trainingDays = new Set(inMonth.map(s => s.date))
    let load = 0
    let hasComplete = false
    let hasIncomplete = false
    for (const day of trainingDays) {
      const loads = inMonth.filter(s => s.date === day).map(loadOf)
      if (loads.some(l => l === null)) {
        hasIncomplete = true
        continue
      }
      load += loads.reduce<number>((sum, l) => sum + (l ?? 0), 0)
      hasComplete = true
    }
    points.push({
      month: `${year}-${String(month + 1).padStart(2, '0')}`,
      label: `${month + 1}月`,
      load: hasComplete ? load : null,
      loadCompleteness: !inMonth.length ? 'none' : hasIncomplete ? 'incomplete' : 'complete',
      trainingDays: trainingDays.size,
      hasSession: inMonth.length > 0,
      partialMonth: current
    })
  }
  return points
}

/** 自然月：1 日起 7 天块；当前月只统计到今天 */
export function buildMonthlyReport(
  sessions: TrainingSession[],
  meals: Meal[],
  reference: Date,
  ctx: PeriodContext = {},
  now: Date = new Date()
): PeriodReport {
  const year = reference.getFullYear()
  const month = reference.getMonth()
  const monthLast = new Date(year, month + 1, 0)
  const current = year === now.getFullYear() && month === now.getMonth()
  const end = current ? startOfDay(now) : startOfDay(monthLast)
  const starts = [1, 8, 15, 22, 29]
  const blocks: ReportBlock[] = []
  for (const day of starts) {
    const blockStart = new Date(year, month, day)
    if (blockStart > end) break
    const blockEnd = addDays(blockStart, 6) > end ? end : addDays(blockStart, 6)
    blocks.push(blockOf(blockStart, blockEnd, sessions, meals, ctx))
  }
  const report = periodOf(blocks, sessions, meals)
  if (current) report.dataQuality.unshift(`当前月统计到 ${now.getMonth() + 1} 月 ${now.getDate()} 日。`)
  return report
}
