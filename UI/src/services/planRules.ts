// 计划生成的单一来源：PlanView、周报与侧栏都用它，避免"计划数"两处算得不一样。
// F04 的条件过滤在这里落地：先按年龄与模式决定能否自动推荐，再按器材、场地、时长与"需要避开的"筛动作库。
// 约束无解时如实返回冲突原因，不强行安排（文档 §3.4.3(1)、§7）。
import type { AlternativeExercise, Mode, PlanItem, TrainingType, UserProfile } from '@/types/domain'
import { toISODate } from '@/utils/time'
import {
  activeExercises,
  gateReason,
  hasEquipment,
  passesRestrictions,
  type Exercise,
  type Venue
} from './exercises'

export const PLAN_VERSION = 3
export const PLAN_RULES_VERSION = 'plan-rules-v3'

/** 每周固定安排的星期：周一、周三、周五（0=周日） */
const TRAINING_WEEKDAYS = [1, 3, 5]

/** 自动推荐的年龄下限，与首期适用范围一致 */
export const AUTO_RECOMMEND_MIN_AGE = 18

const VENUE_LABELS: Record<string, Venue> = {
  宿舍或家: '宿舍或家',
  家: '宿舍或家',
  健身房: '健身房',
  户外: '户外'
}

export interface DayPlan {
  items: PlanItem[]
  /** 无法满足的条件，界面要逐条显示 */
  conflicts: string[]
  /** false 表示只允许手工录入，不生成自动推荐 */
  auto: boolean
  /** auto=false 时给用户的说明 */
  gateNote?: string
  ruleVersion: string
}

function budgetMinutes(times: string[]): number {
  const nums = times.map(t => parseInt(t, 10)).filter(n => Number.isFinite(n) && n > 0)
  return nums.length ? Math.max(...nums) : 20
}

function venuesOf(profile: UserProfile | null): Venue[] {
  const raw = (profile?.availableVenues ?? []).map(v => VENUE_LABELS[v]).filter(Boolean)
  return raw.length ? [...new Set(raw)] : ['宿舍或家', '健身房', '户外']
}

/** 一条动作能否进入这个档案的计划；返回拦截原因数组（空数组即通过） */
function blockers(ex: Exercise, profile: UserProfile | null, venues: Venue[]): string[] {
  const out: string[] = []
  if (ex.status === 'retired') out.push(`${ex.name} 已停用，不再用于新推荐`)
  if (!venues.some(v => ex.venues.includes(v))) out.push(`${ex.name} 需要${ex.venues.join('/')}场地，与档案里的场地不符`)
  if (profile && profile.equipment.length && !hasEquipment(ex, profile.equipment)) {
    out.push(`${ex.name} 需要${ex.equipment.join('或')}，档案里没有`)
  }
  if (profile) out.push(...passesRestrictions(ex, profile.restrictions))
  return out
}

function pick(
  type: TrainingType,
  profile: UserProfile | null,
  venues: Venue[],
  used: Set<string>,
  maxMinutes: number
): { ex?: Exercise; blocked: string[] } {
  const pool = activeExercises().filter(e => e.type === type && !used.has(e.id))
  let blocked: string[] = []
  for (const e of pool) {
    const b = blockers(e, profile, venues)
    if (b.length) { blocked = blocked.concat(b); continue }
    if (e.minutes > maxMinutes) continue
    return { ex: e, blocked }
  }
  if (!blocked.length && pool.length) blocked = pool.map(e => `${e.name} 约 ${e.minutes} 分钟，超出本次可用的 ${maxMinutes} 分钟`)
  return { blocked }
}

function toPlanItem(ex: Exercise, date: string, version: number): PlanItem {
  return {
    id: `${date}-${ex.id}`,
    planId: `plan-v${version}`,
    date,
    exerciseId: ex.id,
    exerciseName: ex.name,
    type: ex.type,
    note: ex.reason ?? ex.howto,
    plannedDuration: ex.minutes,
    plannedSets: ex.sets,
    plannedReps: ex.reps,
    locked: ex.type === '坐站训练',
    completed: false,
    alternatives: []
  }
}

/**
 * 生成某一天的计划。profile 为空时退回"不过滤"的基础模板（未建档用户的默认视图）。
 */
export function buildDayPlan(d: Date, profile: UserProfile | null = null, mode: Mode = 'public', version = PLAN_VERSION): DayPlan {
  const date = toISODate(d)
  const empty = { items: [], conflicts: [], auto: true, ruleVersion: PLAN_RULES_VERSION }
  if (!TRAINING_WEEKDAYS.includes(d.getDay())) return { ...empty, items: [] }

  if (profile && profile.age < AUTO_RECOMMEND_MIN_AGE) {
    return {
      items: [],
      conflicts: [],
      auto: false,
      gateNote: `未满 ${AUTO_RECOMMEND_MIN_AGE} 岁：可以记录训练与三餐，但不生成自动推荐。需要安排请在计划页手工录入。`,
      ruleVersion: PLAN_RULES_VERSION
    }
  }

  const gate = gateReason(profile)
  if (gate) {
    return { items: [], conflicts: [], auto: false, gateNote: gate, ruleVersion: PLAN_RULES_VERSION }
  }

  const venues = venuesOf(profile)
  const budget = budgetMinutes(profile?.availableTimes ?? [])
  const used = new Set<string>()
  const items: PlanItem[] = []
  const conflicts: string[] = []
  let remaining = budget

  // 运动员首期以录入的跑步周期为基准，主项是有氧；大众模式主项是力量类
  const mainTypes: TrainingType[] = mode === 'athlete'
    ? ['跑步', '舒缓整理']
    : ['坐站训练', '站姿弯举', '其他']

  if (mode === 'athlete') {
    // 有氧主项按整段可用时间安排，不能被"留 6 分钟给别的"挤掉
    const run = pick('跑步', profile, venues, used, remaining)
    if (run.ex) { items.push(toPlanItem(run.ex, date, version)); used.add(run.ex.id); remaining -= run.ex.minutes }
    else conflicts.push(...(run.blocked.length ? run.blocked : ['动作库里没有符合条件的跑步或快走条目']))
    if (remaining >= 4) {
      const helper = pick('其他', profile, venues, used, remaining - 2)
      if (helper.ex) { items.unshift(toPlanItem(helper.ex, date, version)); used.add(helper.ex.id); remaining -= helper.ex.minutes }
      else conflicts.push(...helper.blocked)
    }
  } else {
    const warm = pick('动态热身', profile, venues, used, Math.min(4, budget))
    if (warm.ex) { items.push(toPlanItem(warm.ex, date, version)); used.add(warm.ex.id); remaining -= warm.ex.minutes }
    else conflicts.push(...warm.blocked)

    for (const t of mainTypes) {
      if (remaining < 3) break
      const got = pick(t, profile, venues, used, remaining)
      if (got.ex) { items.push(toPlanItem(got.ex, date, version)); used.add(got.ex.id); remaining -= got.ex.minutes }
      else if (got.blocked.length) conflicts.push(...got.blocked)
      if (t === '坐站训练' || t === '站姿弯举') continue
    }
    if (!items.some(i => i.type === '坐站训练' || i.type === '站姿弯举' || i.type === '其他')) {
      conflicts.push('今天没有可安排的力量动作：可能是器材与"需要避开的"把候选都筛掉了')
    }
  }

  if (remaining >= 2) {
    const cool = pick('舒缓整理', profile, venues, used, remaining)
    if (cool.ex) { items.push(toPlanItem(cool.ex, date, version)); used.add(cool.ex.id); remaining -= cool.ex.minutes }
  }

  // 替换候选：同类型、符合档案条件、时长不超过原项 +2 分钟
  for (const item of items) {
    const origin = activeExercises().find(e => e.name === item.exerciseName)
    if (!origin) continue
    item.alternatives = alternativesFor(origin, profile, venues).slice(0, 2)
  }

  return {
    items,
    conflicts: [...new Set(conflicts)],
    auto: true,
    ruleVersion: PLAN_RULES_VERSION
  }
}

/** F04：给出可替换候选并说明原因 */
export function alternativesFor(
  origin: Exercise,
  profile: UserProfile | null = null,
  venues: Venue[] = ['宿舍或家', '健身房', '户外']
): AlternativeExercise[] {
  return activeExercises()
    .filter(e => e.id !== origin.id && e.type === origin.type)
    .filter(e => !blockers(e, profile, venues).length)
    .filter(e => e.minutes <= origin.minutes + 2)
    .map(e => ({
      id: e.id,
      name: e.name,
      reason: e.reason ?? `同为${e.type}，约 ${e.minutes} 分钟，强度${e.intensity}`,
      duration: e.minutes,
      sets: e.sets,
      reps: e.reps
    }))
}

export function itemsFor(d: Date, profile: UserProfile | null = null, mode: Mode = 'public', version = PLAN_VERSION): PlanItem[] {
  return buildDayPlan(d, profile, mode, version).items
}

export function isPlanDay(d: Date, profile: UserProfile | null = null, mode: Mode = 'public'): boolean {
  return buildDayPlan(d, profile, mode).items.length > 0
}
