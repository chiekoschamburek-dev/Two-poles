import { request, requestBlob } from './http'
import type { PrivacySettings } from '@/types/domain'

export interface ExportJob {
  jobId: string
  format: 'json' | 'csv'
  status: 'pending' | 'completed' | 'failed'
  downloadUrl?: string | null
  error?: string
}

export interface Confirmation {
  confirmToken: string
  expiresIn: number
}

export async function putPrivacy(privacy: Partial<PrivacySettings>): Promise<PrivacySettings> {
  const body = await request<{ privacy: PrivacySettings }>('/settings/privacy', {
    method: 'PUT',
    body: privacy
  })
  return body.privacy
}

export async function createExport(format: 'json' | 'csv'): Promise<ExportJob> {
  return request<ExportJob>('/export', {
    method: 'POST',
    body: { format },
    timeoutMs: 60_000
  })
}

export async function getExport(jobId: string): Promise<ExportJob> {
  return request<ExportJob>(`/export/${encodeURIComponent(jobId)}`)
}

export async function downloadExport(jobId: string): Promise<Blob> {
  return requestBlob(`/export/${encodeURIComponent(jobId)}/download`)
}

export async function requestWipe(): Promise<Confirmation> {
  const response = await request<Confirmation | undefined>('/data/wipe', {
    method: 'POST',
    body: {}
  })
  if (!response?.confirmToken) throw new Error('服务端没有返回确认令牌')
  return response
}

export async function confirmWipe(confirmToken: string): Promise<void> {
  await request<void>('/data/wipe', { method: 'POST', body: { confirmToken } })
}

export async function requestDeleteAccount(): Promise<Confirmation> {
  const response = await request<Confirmation | undefined>('/auth/delete-account', {
    method: 'POST',
    body: {}
  })
  if (!response?.confirmToken) throw new Error('服务端没有返回确认令牌')
  return response
}

export async function confirmDeleteAccount(confirmToken: string): Promise<void> {
  await request<void>('/auth/delete-account', {
    method: 'POST',
    body: { confirmToken }
  })
}
