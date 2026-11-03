import { request } from './http'
import type { Meal, Mode, Plan, PrivacySettings, TrainingSession, UserProfile } from '@/types/domain'

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
  modeLog: { from: Mode; to: Mode; at: string; openPlanCount: number }[]
  deleted: {
    sessions: DeletedRecord[]
    meals: DeletedRecord[]
    plans: DeletedRecord[]
  }
}

export async function pull(since?: string): Promise<RemoteSyncSnapshot> {
  const suffix = since ? `?since=${encodeURIComponent(since)}` : ''
  return request<RemoteSyncSnapshot>(`/sync${suffix}`, { timeoutMs: 30_000 })
}
