import { request } from './http'
import type { Meal, MotionAnalysis, Plan, PrivacySettings, TrainingSession, UserProfile } from '@/types/domain'

export interface DeletedRecord {
  id: string
  clientId?: string
}

export interface RemoteSyncSnapshot {
  serverTime: string
  profile: UserProfile | null
  privacy: PrivacySettings | null
  sessions: TrainingSession[]
  meals: Meal[]
  plans: Plan[]
  analyses: MotionAnalysis[]
  deleted: {
    sessions: DeletedRecord[]
    meals: DeletedRecord[]
    plans: DeletedRecord[]
    analyses: DeletedRecord[]
  }
}

export async function pull(since?: string): Promise<RemoteSyncSnapshot> {
  const suffix = since ? `?since=${encodeURIComponent(since)}` : ''
  return request<RemoteSyncSnapshot>(`/sync${suffix}`, { timeoutMs: 30_000 })
}
