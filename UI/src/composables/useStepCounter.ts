// DeviceMotion 计步（F18 / plan.md §4.3）：垂直加速度过峰检测算步数与步频。
// 只读运动传感器，不读位置；iOS 的 requestPermission() 必须在用户手势里调且要求 HTTPS。
// 不支持 / 权限被拒 / 没有传感器时如实降级为手动计时，不假装在计步（文档 §7、§229）。
import { ref, onUnmounted } from 'vue'

export type StepCounterStatus = 'idle' | 'requesting' | 'active' | 'denied' | 'unsupported' | 'stale'

/** 两次认可峰的最小间隔 ms——约等于 230 步/分的封顶，过滤手抖与车身颠簸 */
const STEP_MIN_INTERVAL = 260
/** 高通信号超过该阈值（m/s²）算一次摆动；低于一半时重新待发 */
const PEAK_THRESHOLD = 1.6
/** 启动后这么久没收到任何 devicemotion 事件，判为本机无传感器 */
const SENSOR_LIVENESS_MS = 2500
/** 步频统计窗口 */
const CADENCE_WINDOW_MS = 60_000

export function useStepCounter() {
  const supported = typeof window !== 'undefined' && 'DeviceMotionEvent' in window
  const status = ref<StepCounterStatus>('idle')
  const steps = ref(0)
  /** 最近一分钟步数（步/分）；传感器可用但人没动时是 0，如实显示 */
  const cadence = ref(0)
  /** 降级说明（给界面如实展示）；空串 = 正常计步中 */
  const degradeNote = ref('')

  let handler: ((e: DeviceMotionEvent) => void) | null = null
  let avg = 0
  let armed = true
  let lastStepAt = 0
  let recent: number[] = []
  let livenessTimer = 0
  let gotEvent = false

  function onMotion(e: DeviceMotionEvent) {
    const a = e.accelerationIncludingGravity
    if (!a || (a.x === null && a.y === null && a.z === null)) return
    const mag = Math.sqrt((a.x ?? 0) ** 2 + (a.y ?? 0) ** 2 + (a.z ?? 0) ** 2)
    // 低通跟踪重力与缓变（起步、转向），高通留下脚步的快摆动
    avg = avg ? avg * 0.92 + mag * 0.08 : mag
    const hp = mag - avg
    const now = e.timeStamp || performance.now()
    if (!gotEvent) {
      gotEvent = true
      window.clearTimeout(livenessTimer)
      status.value = 'active'
    }
    if (armed && hp > PEAK_THRESHOLD && now - lastStepAt >= STEP_MIN_INTERVAL) {
      armed = false
      lastStepAt = now
      steps.value++
      recent.push(now)
      while (recent.length && now - recent[0] > CADENCE_WINDOW_MS) recent.shift()
      cadence.value = recent.length
    } else if (!armed && hp < PEAK_THRESHOLD * 0.5) {
      armed = true
    }
  }

  /** 必须由用户手势（按钮 click）直接调用：iOS 的权限申请要求手势上下文 */
  async function start(): Promise<boolean> {
    if (!supported) {
      status.value = 'unsupported'
      degradeNote.value = '当前浏览器不支持 DeviceMotion，计步不可用，已退回手动计时。'
      return false
    }
    const DME = window.DeviceMotionEvent as { requestPermission?: () => Promise<'granted' | 'denied'> }
    if (typeof DME.requestPermission === 'function') {
      try {
        status.value = 'requesting'
        const res = await DME.requestPermission()
        if (res !== 'granted') {
          status.value = 'denied'
          degradeNote.value = '运动传感器权限被拒，计步不可用，已退回手动计时；计时不受影响。'
          return false
        }
      } catch {
        status.value = 'denied'
        degradeNote.value = '运动传感器权限没有拿到（需在 HTTPS 下由你主动允许），已退回手动计时。'
        return false
      }
    }
    stop(false)
    steps.value = 0
    cadence.value = 0
    avg = 0
    armed = true
    lastStepAt = 0
    recent = []
    gotEvent = false
    degradeNote.value = ''
    handler = onMotion
    window.addEventListener('devicemotion', handler)
    status.value = 'active'
    // 手机放桌面上不动也可能没有事件；一段时间收不到任何数据就按无传感器处理
    window.clearTimeout(livenessTimer)
    livenessTimer = window.setTimeout(() => {
      if (status.value === 'active' && !gotEvent) {
        stop(false)
        status.value = 'stale'
        degradeNote.value = '本机没有可用的运动传感器（没有收到任何采样），已退回手动计时。'
      }
    }, SENSOR_LIVENESS_MS)
    return true
  }

  /** 停止监听；keepSteps 决定是否清零（完成记录后停表要保留已计的步数） */
  function stop(keepSteps = true) {
    window.clearTimeout(livenessTimer)
    if (handler) window.removeEventListener('devicemotion', handler)
    handler = null
    if (!keepSteps) {
      steps.value = 0
      cadence.value = 0
    }
    if (status.value === 'active' || status.value === 'requesting') status.value = 'idle'
  }

  onUnmounted(() => stop())

  return { supported, status, steps, cadence, degradeNote, start, stop }
}
