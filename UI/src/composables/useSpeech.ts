// 语音节奏播报（F19 / plan.md §4.4 第一档）：只播组数、次数与休息计时，不做动作纠错。
// 用 Web Speech API 的 speechSynthesis，枚举到本机中文音色才真正发声；
// 接口不存在或没有中文音色时静默回落到页面文字与 aria-live（文档 §7：不报错也不显示"已播报"）。
import { ref, computed, onUnmounted } from 'vue'
import { useAppStore } from '@/stores/app'

const supported = typeof window !== 'undefined' && 'speechSynthesis' in window

// 音色列表是模块级共享状态：voiceschanged 只挂一次，多个消费者看到同一份
const chineseVoices = ref<SpeechSynthesisVoice[]>([])
let voicesHooked = false

function refreshVoices() {
  if (!supported) return
  // Chrome 首次 getVoices() 常返回空数组，等 voiceschanged 再补
  const all = window.speechSynthesis.getVoices()
  chineseVoices.value = all.filter(v => v.lang && v.lang.toLowerCase().startsWith('zh'))
}

function hookVoices() {
  if (!supported || voicesHooked) return
  voicesHooked = true
  refreshVoices()
  window.speechSynthesis.addEventListener?.('voiceschanged', refreshVoices)
}

function findVoice(uri: string): SpeechSynthesisVoice | null {
  const list = chineseVoices.value
  if (!list.length) return null
  return list.find(v => v.voiceURI === uri) ?? list[0]
}

/** 降级原因（给设置页说明用）；空串 = 可以正常发声 */
const degradeReason = computed(() => {
  if (!supported) return '当前浏览器没有语音合成接口，播报保持关闭，页面文字提示不受影响。'
  if (!chineseVoices.value.length) return '本机没有枚举到中文音色，播报会静默跳过并回落到页面文字与 aria-live 提示。'
  return ''
})

export function useSpeech() {
  hookVoices()
  // 组件挂载后立刻查一次；有些浏览器不触发 voiceschanged，只能轮询兜底一帧
  refreshVoices()

  /**
   * 播一句节奏提示。开关关闭、接口缺失或没有中文音色时什么都不做；
   * 设备静音浏览器层就听不见，同样不报错（文档 §7 降级口径）。
   */
  function speak(text: string) {
    const store = useAppStore()
    if (!store.speech.enabled || !supported) return
    const voice = findVoice(store.speech.voiceURI)
    if (!voice) return
    // 上一句没播完就来了下一句（比如最后一次数完紧跟"本组完成"）时，取消旧的再播新的
    window.speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(text)
    u.lang = voice.lang
    u.voice = voice
    // 数字报数要跟上动作节奏，语速略快于默认
    u.rate = /^\d+$/.test(text) ? 1.2 : 1
    // Chrome 的 cancel() 后紧接 speak() 偶发不发声，推迟一帧绕开
    window.setTimeout(() => window.speechSynthesis.speak(u), 40)
  }

  /** 只把当前这句排进队列，不清掉之前的（试听用） */
  function preview(text: string) {
    const store = useAppStore()
    if (!supported) return
    const voice = findVoice(store.speech.voiceURI)
    if (!voice) return
    const u = new SpeechSynthesisUtterance(text)
    u.lang = voice.lang
    u.voice = voice
    window.speechSynthesis.speak(u)
  }

  function stop() {
    if (supported) window.speechSynthesis.cancel()
  }

  // 跟练页卸载时把没播完的截掉，避免离开页面后还在报数
  onUnmounted(stop)

  return { supported, chineseVoices, hasChineseVoice: computed(() => chineseVoices.value.length > 0), degradeReason, speak, preview, stop }
}
