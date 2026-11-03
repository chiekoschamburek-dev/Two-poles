import { request } from './http'
import type { UserProfile } from '@/types/domain'

export async function getProfile(): Promise<UserProfile | null> {
  const body = await request<{ profile: UserProfile | null }>('/profile')
  return body.profile
}

export async function putProfile(profile: UserProfile): Promise<UserProfile> {
  const body = await request<{ profile: UserProfile }>('/profile', {
    method: 'PUT',
    body: profile
  })
  return body.profile
}
