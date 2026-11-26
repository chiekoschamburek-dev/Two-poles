// 运动中不熄屏：实时跟练会持续几十秒到几分钟，系统自动锁屏会同时打断
// 摄像头预览、计数与语音播报（iOS 默认 30s，安卓依厂商设置）。
//
// 只在真机支持时启用；不支持（旧 WebView、非安全上下文、低电量模式拒绝）时
// 静默跳过——调用方不需要知道成功与否，业务逻辑不受影响。
// 注意：页面切到后台时浏览器会自动释放锁，回到前台必须重新申请，否则用户
// 从微信切回来就再也不会保持常亮。

interface WakeLockSentinelLike {
  released: boolean
  release: () => Promise<void>
  addEventListener: (type: 'release', listener: () => void) => void
}

type WakeLockNavigator = Navigator & {
  wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> }
}

export function useWakeLock() {
  let sentinel: WakeLockSentinelLike | null = null
  /** 调用方是否仍希望保持常亮；控制「回前台要不要重新申请」 */
  let wanted = false
  let listening = false

  const supported = typeof navigator !== 'undefined' && 'wakeLock' in navigator

  function handleVisibility() {
    if (document.visibilityState === 'visible') void acquire()
  }

  async function acquire(): Promise<void> {
    if (!supported || sentinel || !wanted) return
    if (document.visibilityState !== 'visible') return
    try {
      const lock = await (navigator as WakeLockNavigator).wakeLock!.request('screen')
      // await 期间可能已经被 release()，避免把迟到的锁挂上去
      if (!wanted) {
        void lock.release()
        return
      }
      sentinel = lock
      lock.addEventListener('release', () => {
        if (sentinel === lock) sentinel = null
      })
    } catch {
      // 低电量模式 / 策略拒绝：保持常亮失败不影响任何业务行为
      sentinel = null
    }
  }

  /** 进入跟练时调用；可重复调用，已持有时不再申请 */
  function request(): void {
    wanted = true
    if (!supported) return
    if (!listening) {
      document.addEventListener('visibilitychange', handleVisibility)
      listening = true
    }
    void acquire()
  }

  /** 离开跟练 / 组件卸载时调用 */
  function release(): void {
    wanted = false
    if (listening) {
      document.removeEventListener('visibilitychange', handleVisibility)
      listening = false
    }
    const lock = sentinel
    sentinel = null
    if (lock) void lock.release().catch(() => {})
  }

  return { supported, request, release }
}