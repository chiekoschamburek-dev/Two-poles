import { request } from './http'
import type { UserProfile } from '@/types/domain'

export async function getProfile(): Promise<UserProfile | null> {
  const body = await request<{ profile: UserProfile | null }>('/profile')
  return body.profile
}

export async function putProfile(profile: UserProfile): Promise<UserProfile> {
  const body = await request<{ profile: UserProfile }>('/profile', {
    method: 'PUT',
    // 服务端保留缺省字段，显式 null 才会清除用户留空的值。
    body: {
      ...profile,
      nickname: profile.nickname ?? null,
      avatarDataUrl: profile.avatarDataUrl ?? null,
      height: profile.height ?? null,
      weight: profile.weight ?? null,
      discipline: profile.discipline ?? null,
      goalType: profile.goalType ?? null,
      cyclePhase: profile.cyclePhase ?? null,
      cycleStartDate: profile.cycleStartDate ?? null,
      cycleEndDate: profile.cycleEndDate ?? null,
      cycleFocus: profile.cycleFocus ?? null,
      targetEvent: profile.targetEvent ?? null,
      targetEventDate: profile.targetEventDate ?? null,
      targetResult: profile.targetResult ?? null
    }
  })
  return body.profile
}
