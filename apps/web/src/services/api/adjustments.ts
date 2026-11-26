import { request } from './http'
import type { AdjustmentResolutionEntry, AdjustmentResolutionStatus } from '@/types/domain'

export interface RemoteAdjustmentResolution extends AdjustmentResolutionEntry {
  key: string
}

/**
 * 上报一条「已处理」记录。服务端按 updatedAt 做 last-write-wins：
 * 传更旧的记录不会覆盖别的设备上更新的选择。
 */
export async function resolve(input: {
  key: string
  status: AdjustmentResolutionStatus
  updatedAt: string
}): Promise<RemoteAdjustmentResolution> {
  const body = await request<{ resolution: RemoteAdjustmentResolution }>('/adjustment-resolutions', {
    method: 'PUT',
    body: input
  })
  return body.resolution
}