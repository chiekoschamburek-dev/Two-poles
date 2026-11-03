import { request } from './http'
import type { WeeklyReport } from '@/types/domain'

export async function weekly(start: string, mode: 'public' | 'athlete'): Promise<WeeklyReport> {
  const query = new URLSearchParams({ start, mode })
  const body = await request<{ report: WeeklyReport }>(`/reports/weekly?${query.toString()}`)
  return body.report
}
