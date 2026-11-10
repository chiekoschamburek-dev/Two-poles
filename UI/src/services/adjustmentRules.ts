// 计划调整建议：时间冲突与训练反馈都只产出建议，不直接改计划。
// 用户接受后才走 store.acceptAdjustment；拒绝/暂不调整只记录已处理 key。
import type {
  AdjustmentResolutions,
  Plan,
  PlanChange,
  PlanItem,
  TrainingSession,
  UserProfile
} from '@/types/domain'
import { shortDate, toISODate } from '@/utils/time'
import { findExercise, gateReason } from '@/services/exercises'
import { AUTO_RECOMMEND_MIN_AGE } from '@/services/planRules'

export type AdjustmentSource = 'time-conflict' | 'feedback'
export type FeedbackDirection = 'down' | 'up' | 'safety'

/** 反馈调整的硬规则；集中在这里，避免数字散落在实现里 */
const FEEDBACK_WINDOW_DAYS = 21
const MIN_REPS = 5
const MAX_REPS = 200
const REPS_STEP = 2
const MIN_HOLD_SECONDS = 10
const MAX_HOLD_SECONDS = 600
const HOLD_STEP_SECONDS = 5
const MIN_STEPS_MINUTES = 10
const MAX_STEPS_MINUTES = 240
const STEPS_STEP_MINUTES = 5
const MAX_SETS = 20

export interface FeedbackEvidence {
  sessionId: string
  date: string
  rpe: number | null
  completionStatus: TrainingSession['completionStatus']
  discomfort: boolean
  completionReason?: string
}

export interface FeedbackIntent {
  key: string
  exerciseName: string
  direction: FeedbackDirection
  evidence: FeedbackEvidence[]
  reason: string
  allowNumeric: boolean
}

export interface AdjustmentSuggestion {
  key: string
  source: AdjustmentSource
  planId: string
  itemId: string
  date: string
  exerciseName: string
  title: string
  from: string
  to: string
  fromDetail?: string
  toDetail?: string
  reason: string
  changes: PlanChange[]
  safetyOnly: boolean
  needsPlan?: 'current-week' | 'next-week'
  blockedReason?: string
  evidence?: FeedbackEvidence[]
}

export interface BuildAdjustmentInput {
  plan: Plan | null
  /** 下一周计划（如果有）；当前周没有目标时先在这里找同动作 */
  nextPlan?: Plan | null
  profile: UserProfile | null
  selectedDate: string
  resolutions: AdjustmentResolutions
  sessions?: TrainingSession[]
  now?: Date
}

function isoDate(iso: string): Date {
  return new Date(`${iso}T00:00:00`)
}

function nextIsoDate(iso: string): string {
  const next = isoDate(iso)
  next.setDate(next.getDate() + 1)
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`
}

function budgetMinutes(profile: UserProfile | null): number {
  return Math.max(0, ...(profile?.availableTimes ?? [])
    .map(t => parseInt(t, 10))
    .filter(n => Number.isFinite(n)))
}

/** 某天计划总时长超过档案最大可用时间块时，建议把第一个未锁定未完成项原样搬到次日 */
export function buildTimeConflictSuggestion(
  plan: Plan | null,
  profile: UserProfile | null,
  selectedDate: string
): AdjustmentSuggestion | null {
  if (!plan) return null
  const budget = budgetMinutes(profile)
  if (!budget) return null
  const items = plan.items.filter(i => i.date === selectedDate)
  const total = items.reduce((sum, i) => sum + (i.plannedDuration ?? 0), 0)
  if (total <= budget) return null
  const item = items.find(i => !i.completed)
  if (!item) return null
  const to = nextIsoDate(item.date)
  const fromLabel = shortDate(isoDate(item.date))
  const toLabel = shortDate(isoDate(to))
  const duration = item.plannedDuration ?? 0
  const reason = `${fromLabel} 共安排 ${total} 分钟，超过你档案里最大的可用时间 ${budget} 分钟`
  return {
    key: `time|${plan.id}|${item.id}|${item.date}|${to}`,
    source: 'time-conflict',
    planId: plan.id,
    itemId: item.id,
    date: item.date,
    exerciseName: item.exerciseName,
    title: `时间冲突：把「${item.exerciseName}」搬到次日`,
    from: fromLabel,
    to: toLabel,
    fromDetail: `${item.exerciseName} · ${duration} min`,
    toDetail: `${item.exerciseName} · ${duration} min（原样搬移）`,
    reason,
    changes: [{
      itemId: item.id,
      type: 'changed',
      oldValue: { date: item.date },
      newValue: { date: to }
    }],
    safetyOnly: false
  }
}

function evidenceOf(session: TrainingSession): FeedbackEvidence {
  return {
    sessionId: session.id,
    date: session.date,
    rpe: session.rpe,
    completionStatus: session.completionStatus,
    discomfort: session.discomfort,
    completionReason: session.completionReason
  }
}

function evidenceLine(evidence: FeedbackEvidence[]): string {
  return evidence
    .map(e => {
      const parts = [`${e.date.slice(5)} RPE ${e.rpe ?? '未记录'}`]
      if (e.completionStatus !== 'completed') parts.push(e.completionStatus === 'partial' ? '部分完成' : '跳过')
      if (e.discomfort) parts.push('有不适')
      if (e.completionReason?.trim()) parts.push(`原因：${e.completionReason.trim()}`)
      return parts.join(' · ')
    })
    .join('；')
}

/**
 * 训练反馈意图：同一动作最近两次“记了 RPE”的场次，跳过未记录 RPE 的场次；
 * 两次都需落在最近 21 天内。不适/未完成原因优先于高/低 RPE。
 */
export function buildFeedbackIntents(
  sessions: TrainingSession[],
  profile: UserProfile | null,
  now: Date = new Date()
): FeedbackIntent[] {
  const today = toISODate(now)
  const sinceDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - FEEDBACK_WINDOW_DAYS)
  const since = toISODate(sinceDate)
  const allowNumeric = !profile || (profile.age >= AUTO_RECOMMEND_MIN_AGE && !gateReason(profile))
  const byExercise = new Map<string, TrainingSession[]>()

  for (const session of sessions) {
    if (session.rpe === null || session.date > today || session.date < since) continue
    const list = byExercise.get(session.exerciseName) ?? []
    list.push(session)
    byExercise.set(session.exerciseName, list)
  }

  const intents: FeedbackIntent[] = []
  for (const [exerciseName, list] of byExercise) {
    const lastTwo = list
      .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt))
      .slice(-2)
    if (lastTwo.length < 2) continue
    const evidence = lastTwo.map(evidenceOf)
    const key = `feedback|${exerciseName}|${lastTwo[0].id}|${lastTwo[1].id}`
    const trigger = lastTwo.find(s => s.discomfort || !!(s.completionReason ?? '').trim())
    if (trigger) {
      const facts = [
        trigger.discomfort ? '不适' : '',
        trigger.completionReason?.trim() ? `未完成原因：${trigger.completionReason.trim()}` : ''
      ].filter(Boolean).join('；')
      intents.push({
        key, exerciseName, direction: 'safety', evidence, allowNumeric: false,
        reason: `最近两次反馈里出现${facts}。只提示事实，不自动改数字。`
      })
      continue
    }
    if (!allowNumeric) {
      intents.push({
        key, exerciseName, direction: 'safety', evidence, allowNumeric: false,
        reason: '档案条件关闭了自动调整：请手动检查这项安排，不生成数字建议。'
      })
      continue
    }
    const [a, b] = lastTwo
    if (a.rpe !== null && b.rpe !== null && a.rpe >= 8 && b.rpe >= 8) {
      intents.push({
        key, exerciseName, direction: 'down', evidence, allowNumeric: true,
        reason: `${evidenceLine(evidence)}；按你最近两次反馈降低训练量。`
      })
    } else if (
      a.rpe !== null && b.rpe !== null && a.rpe <= 3 && b.rpe <= 3
      && a.completionStatus === 'completed' && b.completionStatus === 'completed'
    ) {
      intents.push({
        key, exerciseName, direction: 'up', evidence, allowNumeric: true,
        reason: `${evidenceLine(evidence)}；两次都完成，按最近两次反馈增加训练量。`
      })
    }
  }
  return intents
}

function feedbackMode(item: PlanItem): 'reps' | 'time' | 'steps' {
  if (item.plannedHoldSeconds !== undefined) return 'time'
  if (item.plannedTargetMinutes !== undefined) return 'steps'
  const ex = findExercise(item.exerciseName)
  if (ex?.holdSeconds !== undefined) return 'time'
  if (ex?.type === '跑步') return 'steps'
  return 'reps'
}

interface FeedbackMagnitude {
  from: string
  to: string
  oldValue: Partial<PlanItem>
  newValue: Partial<PlanItem>
}

function feedbackMagnitude(item: PlanItem, direction: 'down' | 'up'): FeedbackMagnitude | null {
  const ex = findExercise(item.exerciseName)
  const mode = feedbackMode(item)
  const step = direction === 'up' ? 1 : -1

  if (mode === 'steps') {
    const current = item.plannedTargetMinutes ?? ex?.minutes ?? 20
    const next = current + step * STEPS_STEP_MINUTES
    if (next < MIN_STEPS_MINUTES || next > MAX_STEPS_MINUTES || next === current) return null
    return {
      from: `${current}分钟`, to: `${next}分钟`,
      oldValue: { plannedTargetMinutes: current, plannedDuration: item.plannedDuration ?? current },
      newValue: { plannedTargetMinutes: next, plannedDuration: next }
    }
  }

  const sets = item.plannedSets ?? ex?.sets ?? 1
  if (mode === 'time') {
    const hold = item.plannedHoldSeconds ?? ex?.holdSeconds ?? 30
    if (sets > 1) {
      const nextSets = sets + step
      if (nextSets < 1 || nextSets > MAX_SETS) return null
      const duration = item.plannedDuration ?? ex?.minutes ?? Math.max(1, Math.round(sets * hold / 60))
      const nextDuration = Math.max(1, Math.round(duration * nextSets / sets))
      return {
        from: `${sets}×${hold}秒`, to: `${nextSets}×${hold}秒`,
        oldValue: { plannedSets: sets, plannedDuration: duration },
        newValue: { plannedSets: nextSets, plannedDuration: nextDuration }
      }
    }
    const nextHold = hold + step * HOLD_STEP_SECONDS
    if (nextHold < MIN_HOLD_SECONDS || nextHold > MAX_HOLD_SECONDS) return null
    const duration = item.plannedDuration ?? ex?.minutes ?? 1
    const nextDuration = Math.max(1, Math.round(duration * nextHold / hold))
    return {
      from: `${sets}×${hold}秒`, to: `${sets}×${nextHold}秒`,
      oldValue: { plannedHoldSeconds: hold, plannedDuration: duration },
      newValue: { plannedHoldSeconds: nextHold, plannedDuration: nextDuration }
    }
  }

  const reps = item.plannedReps ?? ex?.reps ?? 8
  if (sets > 1) {
    const nextSets = sets + step
    if (nextSets < 1 || nextSets > MAX_SETS) return null
    const duration = item.plannedDuration ?? ex?.minutes ?? 1
    const nextDuration = Math.max(1, Math.round(duration * nextSets / sets))
    return {
      from: `${sets}×${reps}`, to: `${nextSets}×${reps}`,
      oldValue: { plannedSets: sets, plannedDuration: duration },
      newValue: { plannedSets: nextSets, plannedDuration: nextDuration }
    }
  }
  const nextReps = reps + step * REPS_STEP
  if (nextReps < MIN_REPS || nextReps > MAX_REPS) return null
  const duration = item.plannedDuration ?? ex?.minutes ?? 1
  const nextDuration = Math.max(1, Math.round(duration * nextReps / reps))
  return {
    from: `${sets}×${reps}`, to: `${sets}×${nextReps}`,
    oldValue: { plannedReps: reps, plannedDuration: duration },
    newValue: { plannedReps: nextReps, plannedDuration: nextDuration }
  }
}

/** 供反馈规则复用的计划项查找：同日或未来、未完成 */
export function findNextPlanItem(plan: Plan | null, exerciseName: string, today: string): PlanItem | null {
  if (!plan) return null
  return plan.items
    .filter(i => i.exerciseName === exerciseName && i.date >= today && !i.completed)
    .sort((a, b) => a.date.localeCompare(b.date))[0] ?? null
}

function feedbackSuggestion(
  plan: Plan,
  target: PlanItem,
  intent: FeedbackIntent
): AdjustmentSuggestion | null {
  const base = {
    source: 'feedback' as const,
    planId: plan.id,
    itemId: target.id,
    date: target.date,
    exerciseName: target.exerciseName,
    evidence: intent.evidence
  }
  if (intent.direction === 'safety') {
    return {
      ...base,
      key: `${intent.key}|${target.id}|safety`,
      title: `先检查「${target.exerciseName}」：最近反馈需要人工确认`,
      from: target.date.slice(5),
      to: target.date.slice(5),
      reason: `${intent.reason} 目标：${target.date} ${target.exerciseName}。`,
      changes: [],
      safetyOnly: true
    }
  }
  const magnitude = feedbackMagnitude(target, intent.direction)
  if (!magnitude || magnitude.from === magnitude.to) return null
  return {
    ...base,
    // 去重按证据 + 目标项：接受后目标值会变，不能因为 from/to 变了又弹一条
    key: `${intent.key}|${target.id}`,
    title: intent.direction === 'down'
      ? `按最近两次反馈：降低「${target.exerciseName}」的训练量`
      : `按最近两次反馈：增加「${target.exerciseName}」的训练量`,
    from: magnitude.from,
    to: magnitude.to,
    reason: `${intent.reason} 目标：${target.date} ${target.exerciseName}。`,
    changes: [{
      itemId: target.id,
      type: 'changed',
      oldValue: magnitude.oldValue,
      newValue: magnitude.newValue
    }],
    safetyOnly: false
  }
}

function feedbackPlaceholder(
  intent: FeedbackIntent,
  today: string,
  needsPlan?: 'current-week' | 'next-week',
  blockedReason?: string
): AdjustmentSuggestion {
  const label = needsPlan === 'next-week' ? '生成下周计划后调整' : '生成本周计划后调整'
  return {
    key: `${intent.key}|${needsPlan ? `needs-${needsPlan}` : 'blocked'}`,
    source: 'feedback',
    planId: '',
    itemId: '',
    date: today,
    exerciseName: intent.exerciseName,
    title: blockedReason
      ? `下周计划里没有「${intent.exerciseName}」`
      : `${label}「${intent.exerciseName}」`,
    from: '',
    to: '',
    reason: `${intent.reason}${blockedReason ? ` ${blockedReason}` : ''}`,
    changes: [],
    safetyOnly: !!blockedReason,
    needsPlan,
    blockedReason,
    evidence: intent.evidence
  }
}

/** 计划页的待确认列表：合并时间冲突与反馈调整，并过滤已处理证据 */
export function buildAdjustmentSuggestions(input: BuildAdjustmentInput): AdjustmentSuggestion[] {
  const timeConflict = buildTimeConflictSuggestion(input.plan, input.profile, input.selectedDate)
  const all: AdjustmentSuggestion[] = timeConflict ? [timeConflict] : []
  const today = toISODate(input.now ?? new Date())
  for (const intent of buildFeedbackIntents(input.sessions ?? [], input.profile, input.now)) {
    let targetPlan = input.plan
    let target = targetPlan ? findNextPlanItem(targetPlan, intent.exerciseName, today) : null
    if (!target && input.nextPlan) {
      targetPlan = input.nextPlan
      target = findNextPlanItem(input.nextPlan, intent.exerciseName, today)
    }
    if (target && targetPlan) {
      const suggestion = feedbackSuggestion(targetPlan, target, intent)
      if (suggestion) all.push(suggestion)
      continue
    }
    if (intent.direction === 'safety') {
      all.push({
        ...feedbackPlaceholder(intent, today),
        key: `${intent.key}|safety-no-target`,
        title: `最近反馈需要人工确认「${intent.exerciseName}」`,
        reason: `${intent.reason} 当前没有可定位的计划项，请手动检查。`,
        safetyOnly: true
      })
      continue
    }
    if (!input.plan) {
      all.push(feedbackPlaceholder(intent, today, 'current-week'))
      continue
    }
    if (!input.nextPlan) {
      all.push(feedbackPlaceholder(intent, today, 'next-week'))
      continue
    }
    all.push(feedbackPlaceholder(
      intent, today, undefined,
      '下周计划里没有这个动作；请手动安排，不伪造目标。'
    ))
  }
  return all
    .filter(s => !input.resolutions[s.key])
    .sort((a, b) => {
      const rank = (s: AdjustmentSuggestion) => s.needsPlan || s.blockedReason
        ? 3
        : s.safetyOnly ? 0 : s.source === 'time-conflict' ? 1 : 2
      return rank(a) - rank(b)
    })
}
