import { request } from './http'
import type { MotionAnalysis } from '@/types/domain'

export async function list(from?: string, to?: string): Promise<MotionAnalysis[]> {
  const query = new URLSearchParams()
  if (from) query.set('from', from)
  if (to) query.set('to', to)
  const suffix = query.toString() ? `?${query.toString()}` : ''
  const body = await request<{ analyses: MotionAnalysis[] }>(`/analyses${suffix}`)
  return body.analyses
}

export async function create(analysis: MotionAnalysis): Promise<MotionAnalysis> {
  const body = await request<{ analysis: MotionAnalysis }>('/analyses', {
    method: 'POST',
    body: analysis,
    idempotencyKey: analysis.clientId ?? analysis.id
  })
  return body.analysis
}

export async function updateLink(analysis: MotionAnalysis): Promise<MotionAnalysis> {
  const id = analysis.serverId ?? analysis.clientId ?? analysis.id
  const body = await request<{ analysis: MotionAnalysis }>(`/analyses/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: { sessionId: analysis.sessionId ?? null }
  })
  return body.analysis
}

export async function remove(analysis: MotionAnalysis): Promise<void> {
  const id = analysis.serverId ?? analysis.clientId ?? analysis.id
  await request<void>(`/analyses/${encodeURIComponent(id)}`, { method: 'DELETE' })
}
