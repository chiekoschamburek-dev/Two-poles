import { request } from './http'
import type { WeeklyReport } from '@/types/domain'

export async function weekly(start: string): Promise<WeeklyReport> {
  const query = new URLSearchParams({ start })
  const body = await request<{ report: WeeklyReport }>(`/reports/weekly?${query.toString()}`)
  return body.report
}
