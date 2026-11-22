// 餐食缩略图不随 /sync 下发（一张最大 120KB，首屏同步会被它撑爆）。
// 列表要展示时按需取一次，取到就写回本机记录并落盘，之后不再请求。
import type { Meal } from '@/types/domain'
import * as mealsApi from './api/meals'

const inflight = new Set<string>()
/** 服务端没有图或本次失败：同一会话内不反复重试，刷新页面会重新尝试 */
const skipped = new Set<string>()

export async function hydrateMealThumbs(meals: Meal[], onChange: () => void): Promise<void> {
  const targets = meals.filter((meal) =>
    meal.photoId && !meal.photoThumb && !inflight.has(meal.id) && !skipped.has(meal.id))
  if (!targets.length) return
  let changed = false
  for (const meal of targets) {
    inflight.add(meal.id)
    try {
      const thumb = await mealsApi.thumb(meal)
      if (thumb) {
        meal.photoThumb = thumb
        changed = true
      } else {
        skipped.add(meal.id)
      }
    } catch {
      skipped.add(meal.id)
    } finally {
      inflight.delete(meal.id)
    }
  }
  if (changed) onChange()
}

/** 测试/换账号时清掉「不再重试」的缓存 */
export function resetMealThumbCache(): void {
  inflight.clear()
  skipped.clear()
}