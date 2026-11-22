<template>
  <div class="shell">
    <TopBar :menu-open="mobileOpen" @toggle-menu="mobileOpen = !mobileOpen" />
    <SidebarNav :open="mobileOpen" @close="mobileOpen = false" />
    <Transition name="fade">
      <div v-if="mobileOpen" class="scrim" @click="mobileOpen = false"></div>
    </Transition>
    <main ref="mainRef" class="main-content" :class="{ 'main-workspace': isWorkspace }" tabindex="-1">
      <RouterView v-slot="{ Component }">
        <Transition name="page" mode="out-in">
          <component :is="Component" />
        </Transition>
      </RouterView>
    </main>
    <!-- 路由切换后用读屏播报页面名：SPA 换页不会触发浏览器默认的"已加载"提示 -->
    <p class="visually-hidden" aria-live="polite" aria-atomic="true">{{ pageAnnouncement }}</p>
    <MobileNav />
    <!-- 同步出问题（失败/冲突/登录过期）时全站可见，不用用户自己翻设置页 -->
    <button v-if="syncProblem" type="button" class="sync-flag" @click="router.push('/settings')">
      <CloudOff :size="15" aria-hidden="true" />
      <span>{{ syncProblem }} · 去处理</span>
    </button>
    <WellnessDock />
    <PlanDraftDialog />
    <ToastRegion />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { CloudOff } from 'lucide-vue-next'
import TopBar from './TopBar.vue'
import SidebarNav from './SidebarNav.vue'
import MobileNav from './MobileNav.vue'
import ToastRegion from '../common/ToastRegion.vue'
import PlanDraftDialog from '../common/PlanDraftDialog.vue'
import WellnessDock from '@/components/wellness/WellnessDock.vue'
import { useAppStore } from '@/stores/app'
import { useWellnessDock } from '@/composables/useWellnessDock'
import { startSupplementScheduler } from '@/composables/useSupplementReminders'
import { initDietFeedback, stopDietFeedback } from '@/composables/useDietFeedback'
import { resetBodyScroll } from '@/services/scrollLock'
import { checkAppUpdate, markUpdateNotified, shouldNotifyUpdate } from '@/services/appUpdate'
import { syncState } from '@/services/sync'

const mobileOpen = ref(false)
const route = useRoute()
const router = useRouter()
const store = useAppStore()

/** 冲突优先于状态：冲突不会自己消失，必须去设置页处理 */
const syncProblem = computed(() => {
  if (route.path.startsWith('/settings')) return ''
  if (syncState.conflicts.length) return `${syncState.conflicts.length} 条同步冲突`
  if (syncState.status === 'unauthorized') return '登录已过期'
  if (syncState.status === 'error') return '同步已中断'
  return ''
})
const mainRef = ref<HTMLElement | null>(null)
const pageAnnouncement = ref('')
const { init: initWellnessDock, modalOpen: wellnessModalOpen } = useWellnessDock()
/** 双极工作台自己管理两栏的滚动，外壳不再让整页滚动 */
const isWorkspace = computed(() => route.meta.workspace === true)

watch(() => route.fullPath, () => {
  mobileOpen.value = false
  // 页面级弹层随路由卸载；兜底清掉可能残留的 body 锁，避免整页划不动。
  // 进站 Tips 弹窗是全局的，仍开着时不能替它解锁。
  if (!wellnessModalOpen.value) resetBodyScroll()
})

/**
 * 路由切换后把焦点交给主区：键盘用户的焦点原本停在侧栏链接上，
 * 新页面内容却已换掉，继续 Tab 会从旧位置开始。焦点落到 main（tabindex="-1"）
 * 既能立刻接上阅读顺序，也不会抢走表单的焦点。
 */
watch(() => route.path, async () => {
  const title = (route.meta.title as string | undefined) ?? ''
  pageAnnouncement.value = title ? `已进入${title}` : ''
  await nextTick()
  mainRef.value?.focus({ preventScroll: true })
})

let stopSupplements: (() => void) | null = null

/** 网页随服务器自动更新，只有原生壳要换包；让 App 自己发现新版，不必靠用户问 */
async function noticeAppUpdate() {
  const status = await checkAppUpdate()
  if (!status?.hasUpdate) return
  // 同一个版本每天最多提醒一次：错过 9 秒 Toast 不会让这个版本从此再也不提示
  if (!shouldNotifyUpdate(status.latest.versionCode)) return
  markUpdateNotified(status.latest.versionCode)
  store.showToast({
    type: 'info',
    title: `发现新版本 ${status.latest.versionName}`,
    message: '网页内容已自动更新；只有 App 壳（通知等原生能力）需要换包。到「设置 → 安装 App」可一键更新，也可以在那里关掉这个版本的提醒。',
    duration: 9000
  })
}

onMounted(() => {
  store.init()
  // 放在 store.init() 之后：弹窗里的卡片能读到持久化的内容
  initWellnessDock()
  void noticeAppUpdate()
  stopSupplements = startSupplementScheduler(({ title, message }) => {
    // 页面在前台时用站内 Toast；切到后台时由 Service Worker 补一条系统通知
    store.showToast({ type: 'info', title, message, duration: 10000 })
  })
  // 饮食反馈自己 watch 餐食变更并弹 Toast，只需要在数据就绪后启动一次
  initDietFeedback()
})

onBeforeUnmount(() => {
  stopSupplements?.()
  stopDietFeedback()
})
</script>

<style scoped>
/* 背景由 body 的固定纸面 + 颗粒层承担：这里若再画一遍会盖掉噪点并让渐变随滚动重复 */
/* 整页最小高度用 dvh：手机地址栏收放时 vh 会按最大视口算，页面底部会多出一段空白。
   先写一行 vh 兜底，不认识 dvh 的浏览器会忽略后一条。 */
.shell { min-height: 100vh; min-height: 100dvh; }
/* 导航脊是 fixed 且贯穿整屏，主区只让出它的宽度；页头自己负责吸顶（含 PWA 刘海让位，见 TopBar） */
.main-content {
  min-height: calc(100vh - var(--topbar-height) - var(--safe-top));
  min-height: calc(100dvh - var(--topbar-height) - var(--safe-top));
  margin-left: var(--sidebar-width);
  padding: var(--space-2) var(--gutter) var(--space-6) var(--space-7);
}
/* 工作台：主区固定为视口高度减去页头，内部两栏各自滚动 */
.main-content.main-workspace {
  height: calc(100dvh - var(--topbar-height) - var(--safe-top));
  min-height: 0;
  display: flex;
  overflow: hidden;
  padding: 10px var(--gutter) 12px var(--space-7);
}
.main-content.main-workspace > * {
  flex: 1;
  min-height: 0;
  min-width: 0;
}
.main-content > * { min-width: 0; }
/* 同步问题常驻角标：放在底栏之上，不动主区布局（工作台两栏是固定高度） */
.sync-flag {
  position: fixed;
  right: var(--space-4);
  bottom: calc(var(--mobile-nav-height) + var(--safe-bottom) + var(--space-3));
  z-index: calc(var(--z-sticky) + 2);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-radius: 999px;
  border: 1px solid var(--color-caution);
  background: var(--color-caution-soft);
  color: var(--color-caution);
  font: inherit;
  font-size: 12px;
  line-height: 1.2;
  cursor: pointer;
  box-shadow: var(--shadow-card-lg);
}
.sync-flag:hover { filter: brightness(0.97); }
.sync-flag:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }
@media (min-width: 768px) {
  .sync-flag { bottom: var(--space-5); right: var(--space-5); }
}
/* 程序化聚焦（路由切换）不该画出一圈焦点环，只有键盘 Tab 过来时才显示 */
.main-content:focus { outline: none; }
.main-content:focus-visible { outline: 2px solid var(--color-accent); outline-offset: -2px; }
.scrim { position: fixed; inset: 0; background: var(--overlay); z-index: calc(var(--z-sticky) + 1); }
.fade-enter-active, .fade-leave-active { transition: opacity var(--motion-base); }
.fade-enter-from, .fade-leave-to { opacity: 0; }
/* out-in 的总时长 = 离场 + 入场。离场只做淡化，缩到 120ms：
   新页面挂载早 130ms，察觉不到"离场被缩短"，但切页整体快四分之一。 */
.page-enter-active { transition: opacity var(--motion-base) var(--easing-ease-out), transform var(--motion-base) var(--easing-ease-out); }
.page-leave-active { transition: opacity 120ms var(--easing-ease-out); }
.page-enter-from { opacity: 0; transform: translateY(10px); }
.page-leave-to { opacity: 0; }
@media (max-width: 1099px) {
  .main-content { margin-left: 0; padding: var(--space-3) var(--space-6) var(--space-8); }
  .main-content.main-workspace { padding: 8px 12px; }
}
@media (max-width: 767px) {
  /* 底栏胶囊浮在视口底部：主区自己让出高度，页面内容不会被压住 */
  .main-content {
    padding: var(--space-2) var(--space-4)
      calc(var(--mobile-nav-height) + var(--safe-bottom) + var(--space-3));
  }
  .main-content.main-workspace {
    height: calc(100dvh - var(--topbar-height) - var(--safe-top) - var(--mobile-nav-height) - var(--safe-bottom));
    padding: 6px 10px 8px;
  }
}
</style>
