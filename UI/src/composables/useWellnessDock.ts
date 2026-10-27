// 「每日养生」的进站弹窗 + 导航栏小卡片。
//
// 两条时间口径：
// 1) 每次整页进入（刷新/新开标签）都弹一次；仅仅在 SPA 内切路由不重弹。
// 2) 点 X 只关这一次；点「今日不再出现」才把日期写进 localStorage，当天不再自动弹。
//    小卡片本身始终可打开，不受这两条影响。
import { computed, ref } from 'vue'
import { pickDailyWellnessCard, WELLNESS_DISMISS_KEY } from '@/services/wellnessCards'
import { toISODate } from '@/utils/time'

const DISMISS_KEY = WELLNESS_DISMISS_KEY

const ready = ref(false)
const modalOpen = ref(false)
const cardOpen = ref(false)
const today = ref(new Date())
const card = computed(() => pickDailyWellnessCard(today.value))
let initialized = false

function readDismissed(date: Date): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === toISODate(date)
  } catch {
    return false
  }
}

/** 由 AppShell 在 store.init() 之后调用；只初始化一次 */
function init() {
  if (initialized) return
  initialized = true
  today.value = new Date()
  ready.value = true
  modalOpen.value = !readDismissed(today.value)
  cardOpen.value = false
}

function closeModal() {
  modalOpen.value = false
}

/** @returns 是否真的写进了 localStorage；写不进去时调用方要如实说明只关本次 */
function dismissToday(): boolean {
  let persisted = false
  try {
    localStorage.setItem(DISMISS_KEY, toISODate(new Date()))
    persisted = true
  } catch {
    // 写不进去就只在本次会话里生效，不假装已经记住
  }
  modalOpen.value = false
  cardOpen.value = false
  return persisted
}

function toggleCard() {
  if (modalOpen.value) return
  cardOpen.value = !cardOpen.value
}

function closeCard() {
  cardOpen.value = false
}

export function useWellnessDock() {
  return {
    ready,
    modalOpen,
    cardOpen,
    card,
    init,
    closeModal,
    dismissToday,
    toggleCard,
    closeCard
  }
}
