import { request } from './http'
import type { UserProfile } from '@/types/domain'

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
      // 专项是多选数组：清空时发空数组而不是 null，服务端按数组复校
      disciplines: profile.disciplines ?? [],
      // 旧的单选字段只用于兼容旧服务端，新数据一律以 disciplines 为准
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
