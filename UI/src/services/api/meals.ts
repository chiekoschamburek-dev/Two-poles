import { request } from './http'
import type { Meal } from '@/types/domain'

export async function list(date?: string): Promise<Meal[]> {
  const suffix = date ? `?date=${encodeURIComponent(date)}` : ''
  const body = await request<{ meals: Meal[] }>(`/meals${suffix}`)
  return body.meals
}

export async function create(meal: Meal): Promise<Meal> {
  const body = await request<{ meal: Meal }>('/meals', {
    method: 'POST',
    body: meal,
    idempotencyKey: meal.clientId ?? meal.id
  })
  return body.meal
}

export async function update(meal: Meal): Promise<Meal> {
  const id = meal.serverId ?? meal.clientId ?? meal.id
  const body = await request<{ meal: Meal }>(`/meals/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: {
      time: meal.time,
      mealType: meal.mealType,
      completeness: meal.completeness,
      analyzed: meal.analyzed,
      items: meal.items
    }
  })
  return body.meal
}

export async function remove(meal: Meal): Promise<void> {
  const id = meal.serverId ?? meal.clientId ?? meal.id
  await request<void>(`/meals/${encodeURIComponent(id)}`, { method: 'DELETE' })
}
