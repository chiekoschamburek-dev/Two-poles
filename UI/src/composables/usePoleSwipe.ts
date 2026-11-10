import { onBeforeUnmount, onMounted } from 'vue'

export type SwipeDirection = 'left' | 'right'

interface Options {
  /** 只在手机单极页等场景启用 */
  enabled?: () => boolean
  /** 方向 = 手指移动方向；左右由调用方决定切到哪一极 */
  onSwipe: (dir: SwipeDirection) => void
  threshold?: number
  velocity?: number
}

const IGNORE = 'a,button,input,textarea,select,[role="slider"],[data-no-swipe]'

/**
 * 单指横滑识别：只负责方向与阈值，不接管页面状态。
 * 不 preventDefault，纵向滚动始终交给浏览器。
 */
export function usePoleSwipe({
  enabled = () => true,
  onSwipe,
  threshold = 64,
  velocity = 0.35
}: Options) {
  let startX = 0
  let startY = 0
  let startTime = 0
  let mode: 'idle' | 'tracking' | 'aborted' = 'idle'

  function onStart(e: TouchEvent) {
    if (e.touches.length !== 1 || !enabled()) return
    const target = e.target instanceof Element ? e.target : null
    if (!target?.closest('[data-pole-swipe]')) return
    if (target.closest(IGNORE)) { mode = 'aborted'; return }
    if (window.getSelection()?.toString()) { mode = 'aborted'; return }

    const t = e.touches[0]
    // 让开 iOS / Android 的屏幕边缘返回手势
    if (t.clientX < 24 || t.clientX > window.innerWidth - 24) {
      mode = 'aborted'
      return
    }

    startX = t.clientX
    startY = t.clientY
    startTime = performance.now()
    mode = 'tracking'
  }

  function onMove(e: TouchEvent) {
    if (mode !== 'tracking') return
    const t = e.touches[0]
    const dx = t.clientX - startX
    const dy = t.clientY - startY
    // 纵向优先：一旦判定为滚动就彻底放弃这次手势
    if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx) * 1.2) {
      mode = 'aborted'
    }
  }

  function onEnd(e: TouchEvent) {
    if (mode !== 'tracking') { mode = 'idle'; return }
    mode = 'idle'

    const t = e.changedTouches[0]
    const dx = t.clientX - startX
    const dy = t.clientY - startY
    const dt = Math.max(performance.now() - startTime, 1)

    if (Math.abs(dy) > 60) return
    const byDistance = Math.abs(dx) >= threshold
    const byVelocity = Math.abs(dx) >= 24 && Math.abs(dx) / dt >= velocity
    if (!byDistance && !byVelocity) return

    onSwipe(dx < 0 ? 'left' : 'right')
  }

  const cancel = () => { mode = 'idle' }

  onMounted(() => {
    window.addEventListener('touchstart', onStart, { passive: true })
    window.addEventListener('touchmove', onMove, { passive: true })
    window.addEventListener('touchend', onEnd, { passive: true })
    window.addEventListener('touchcancel', cancel, { passive: true })
  })

  onBeforeUnmount(() => {
    window.removeEventListener('touchstart', onStart)
    window.removeEventListener('touchmove', onMove)
    window.removeEventListener('touchend', onEnd)
    window.removeEventListener('touchcancel', cancel)
  })
}
