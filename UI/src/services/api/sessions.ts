import { request } from './http'
import type { SessionFeedback, TrainingSession } from '@/types/domain'

export async function create(session: TrainingSession): Promise<TrainingSession> {
  const body = await request<{ session: TrainingSession }>('/sessions', {
    method: 'POST',
    body: session,
    idempotencyKey: session.clientId ?? session.id
  })
  return body.session
}

export async function feedback(session: TrainingSession, value: SessionFeedback): Promise<TrainingSession> {
  const id = session.serverId ?? session.clientId ?? session.id
  const body = await request<{ session: TrainingSession }>(`/sessions/${encodeURIComponent(id)}/feedback`, {
    method: 'PATCH',
    body: {
      duration: value.duration,
      distance: value.distance,
      rpe: value.rpe,
      discomfort: value.discomfort,
      reason: value.reason,
      notes: value.notes
    }
  })
  return body.session
}

export async function remove(session: TrainingSession): Promise<void> {
  const id = session.serverId ?? session.clientId ?? session.id
  await request<void>(`/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' })
}
