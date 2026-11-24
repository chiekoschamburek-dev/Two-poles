// 档案表单的唯一草稿↔存档映射。
// 档案页和首次使用引导都从这里取初始值、生成 store.updateProfile 的载荷，
// 避免两边各写一套字段名/trim/undefined 规则。
import type { GoalType, GymRecord, PersonalBest, UserProfile } from '@/types/domain'
import { PROFILE_EVENT_OPTIONS } from '@/config/profileOptions'

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
  discipline: string
  /** 主项选了「其他」：保存时保留自由输入的 discipline */
  otherPicked: boolean
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
    availableTimes: [...(profile?.availableTimes ?? [])],
    equipment: [...(profile?.equipment ?? [])],
    availableVenues: [...(profile?.availableVenues ?? [])],
    restrictions: [...(profile?.restrictions ?? [])],
    discipline: profile?.discipline ?? '',
    otherPicked: !!profile?.discipline && !PROFILE_EVENT_OPTIONS.includes(profile.discipline),
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
    availableTimes: [...draft.availableTimes],
    equipment: [...draft.equipment],
    availableVenues: [...draft.availableVenues],
    restrictions: [...draft.restrictions],
    // 身体数据：留空时存 undefined，不覆盖成 0
    height: draft.height === '' ? undefined : Number(draft.height),
    weight: draft.weight === '' ? undefined : Number(draft.weight),
    // 专项字段：保存时原样带回，不丢
    discipline: draft.discipline.trim() || undefined,
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