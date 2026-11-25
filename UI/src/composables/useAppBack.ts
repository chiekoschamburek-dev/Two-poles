// 统一「返回」行为：先回上一页，没有站内上一页时才回退到固定页面。
//
// 为什么不用 router.back() 直接当默认：直接用 URL 打开、或从站外点进来时，
// 历史里没有站内上一页，back() 要么没反应、要么把人带出应用。
// Vue Router 4 会把上一页写进 history.state.back，拿它判断"有没有来路"最省事：
// - 有 back → 走浏览器历史（保留来路的筛选、滚动位置与状态）
// - 没有 back → push(fallback)，至少不会原地不动
import { useRouter } from 'vue-router'

/** 站内上一页的完整路径；直接打开/新标签时为 null */
export function previousRoutePath(): string | null {
  if (typeof window === 'undefined') return null
  const state = window.history.state as { back?: unknown } | null
  return typeof state?.back === 'string' && state.back ? state.back : null
}

/**
 * 返回上一页；fallback 是该页面的"自然上一层"（例如动作库 → 跟练开始页）。
 * 用法：const goBack = useAppBack('/execution')，然后在按钮上 @click="goBack"。
 */
export function useAppBack(fallback = '/'): () => void {
  const router = useRouter()
  return () => {
    if (previousRoutePath()) {
      router.back()
      return
    }
    void router.push(fallback)
  }
}