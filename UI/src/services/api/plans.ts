import { request } from './http'
import type { Plan, PlanChange } from '@/types/domain'

export interface RemoteAdjustment {
  id: string
  planId: string
  baseVersion: number
  status: 'pending' | 'accepted' | 'rejected'
  changes: PlanChange[]
}

export interface AcceptedAdjustment {
  adjustmentId: string
  newVersion: number
  lockedPreserved: boolean
  plan: Plan
}

export async function current(week: string, mode: 'public' | 'athlete'): Promise<Plan | null> {
  const query = new URLSearchParams({ week, mode })
  const body = await request<{ plan: Plan | null }>(`/plans/current?${query.toString()}`)
  return body.plan
}

export async function create(plan: Plan): Promise<Plan> {
  const body = await request<{ plan: Plan }>('/plans', {
    method: 'POST',
    headers: { 'If-Match': `"${plan.version - 1}"` },
    body: { plan },
    idempotencyKey: `plan:${plan.clientId ?? plan.id}:v${plan.version}`
  })
  return body.plan
}

export async function createAdjustment(plan: Plan, baseVersion: number, changes: PlanChange[], reason: string, idempotencyKey?: string): Promise<RemoteAdjustment> {
  const id = plan.serverId ?? plan.clientId ?? plan.id
  const body = await request<{ adjustment: RemoteAdjustment }>(`/plans/${encodeURIComponent(id)}/adjustments`, {
    method: 'POST',
    headers: { 'If-Match': `"${baseVersion}"` },
    body: { baseVersion, changes, reason },
    idempotencyKey
  })
  return body.adjustment
}

export async function acceptAdjustment(adjustmentId: string, baseVersion: number): Promise<AcceptedAdjustment> {
  return request<AcceptedAdjustment>(`/plans/adjustments/${encodeURIComponent(adjustmentId)}/accept`, {
    method: 'POST',
    headers: { 'If-Match': `"${baseVersion}"` },
    body: { baseVersion }
  })
}
