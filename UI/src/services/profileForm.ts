// 档案表单的唯一草稿↔存档映射。
// 档案页和首次使用引导都从这里取初始值、生成 store.updateProfile 的载荷，
// 避免两边各写一套字段名/trim/undefined 规则。
import type { GoalType, GymRecord, PersonalBest, UserProfile } from '@/types/domain'
import { disciplinesOf, sortTimeLabels } from './profileRules'

export interface ProfileDraft {
  nickname: string
  avatarDataUrl: string
  age: number | ''
  height: number | ''
  weight: number | ''
  goal: string
  experience: string
  availableTimes: string[]
  equipment: string[]
  availableVenues: string[]
  restrictions: string[]
  /** 专项，可多选；预设与自定义都放在这一个数组里 */
  disciplines: string[]
  /** 「其他专项」输入框的临时内容，点「加上」才进 disciplines，不落库 */
  customDiscipline: string
  goalType: GoalType
  cyclePhase: string
  cycleStartDate: string
  cycleEndDate: string
  cycleFocus: string
  targetEvent: string
  targetEventDate: string
  targetResult: string
  personalBests: PersonalBest[]
  gymRecords: GymRecord[]
}

/** 从已保存档案生成可编辑草稿；没有档案时是空值，不塞默认身高体重/年龄 */
export function createProfileDraft(profile: UserProfile | null | undefined): ProfileDraft {
  const goalType: GoalType = profile?.goalType ?? (profile?.targetEvent ? 'competition' : 'cycle')
  return {
    nickname: profile?.nickname ?? '',
    avatarDataUrl: profile?.avatarDataUrl ?? '',
    age: profile?.age ?? '',
    height: profile?.height ?? '',
    weight: profile?.weight ?? '',
    goal: profile?.goal ?? '',
    experience: profile?.experience ?? '',
    availableTimes: sortTimeLabels(profile?.availableTimes ?? []),
    equipment: [...(profile?.equipment ?? [])],
    availableVenues: [...(profile?.availableVenues ?? [])],
    restrictions: [...(profile?.restrictions ?? [])],
    disciplines: disciplinesOf(profile),
    customDiscipline: '',
    goalType,
    cyclePhase: profile?.cyclePhase ?? '',
    cycleStartDate: profile?.cycleStartDate ?? '',
    cycleEndDate: profile?.cycleEndDate ?? '',
    cycleFocus: profile?.cycleFocus ?? '',
    targetEvent: profile?.targetEvent ?? '',
    targetEventDate: profile?.targetEventDate ?? '',
    targetResult: profile?.targetResult ?? '',
    personalBests: (profile?.personalBests ?? []).map(record => ({ ...record })),
    gymRecords: (profile?.gymRecords ?? []).map(record => ({ ...record }))
  }
}

/**
 * 生成 store.updateProfile 的载荷。
 * age 由调用方先通过 isValidAge 校验，保证必填项不会是空字符串。
 */
export function toProfilePayload(draft: ProfileDraft, age: number): Partial<UserProfile> {
  return {
    nickname: draft.nickname.trim() || undefined,
    avatarDataUrl: draft.avatarDataUrl || undefined,
    age,
    goal: draft.goal.trim(),
    experience: draft.experience.trim(),
    availableTimes: sortTimeLabels(draft.availableTimes),
    equipment: [...draft.equipment],
    availableVenues: [...draft.availableVenues],
    restrictions: [...draft.restrictions],
    // 身体数据：留空时存 undefined，不覆盖成 0
    height: draft.height === '' ? undefined : Number(draft.height),
    weight: draft.weight === '' ? undefined : Number(draft.weight),
    // 专项改多选：只写 disciplines；旧的单选字段显式清空，避免两套口径并存
    disciplines: draft.disciplines.map(item => item.trim()).filter(Boolean),
    discipline: undefined,
    cyclePhase: draft.cyclePhase || undefined,
    cycleStartDate: draft.cycleStartDate || undefined,
    cycleEndDate: draft.cycleEndDate || undefined,
    cycleFocus: draft.cycleFocus.trim() || undefined,
    goalType: draft.goalType,
    targetEvent: draft.targetEvent.trim() || undefined,
    targetEventDate: draft.targetEventDate || undefined,
    targetResult: draft.targetResult.trim() || undefined,
    personalBests: [...draft.personalBests],
    gymRecords: [...draft.gymRecords]
  }
}