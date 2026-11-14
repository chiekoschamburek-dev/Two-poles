<template>
  <div class="shell">
    <TopBar :menu-open="mobileOpen" @toggle-menu="mobileOpen = !mobileOpen" />
    <SidebarNav :open="mobileOpen" @close="mobileOpen = false" />
    <Transition name="fade">
      <div v-if="mobileOpen" class="scrim" @click="mobileOpen = false"></div>
    </Transition>
    <main class="main-content" :class="{ 'main-workspace': isWorkspace }">
      <RouterView v-slot="{ Component }">
        <Transition name="page" mode="out-in">
          <component :is="Component" />
        </Transition>
      </RouterView>
    </main>
    <MobileNav />
    <WellnessDock />
    <PlanDraftDialog />
    <ToastRegion />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRoute } from 'vue-router'
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

const mobileOpen = ref(false)
const route = useRoute()
const store = useAppStore()
const { init: initWellnessDock, modalOpen: wellnessModalOpen } = useWellnessDock()
/** 双极工作台自己管理两栏的滚动，外壳不再让整页滚动 */
const isWorkspace = computed(() => route.meta.workspace === true)

watch(() => route.fullPath, () => {
  mobileOpen.value = false
  // 页面级弹层随路由卸载；兜底清掉可能残留的 body 锁，避免整页划不动。
  // 进站 Tips 弹窗是全局的，仍开着时不能替它解锁。
  if (!wellnessModalOpen.value) resetBodyScroll()
})

let stopSupplements: (() => void) | null = null

onMounted(() => {
  store.init()
  // 放在 store.init() 之后：弹窗里的卡片能读到持久化的内容
  initWellnessDock()
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
.shell { min-height: 100vh; }
/* 导航脊是 fixed 且贯穿整屏，主区只让出它的宽度；页头自己负责吸顶（含 PWA 刘海让位，见 TopBar） */
.main-content {
  min-height: calc(100vh - var(--topbar-height) - var(--safe-top));
  margin-left: var(--sidebar-width);
  padding: var(--space-2) var(--gutter) var(--space-10) var(--space-7);
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
.scrim { position: fixed; inset: 0; background: var(--overlay); z-index: calc(var(--z-sticky) + 1); }
.fade-enter-active, .fade-leave-active { transition: opacity var(--motion-base); }
.fade-enter-from, .fade-leave-to { opacity: 0; }
.page-enter-active, .page-leave-active { transition: opacity var(--motion-base) var(--easing-ease-out), transform var(--motion-base) var(--easing-ease-out); }
.page-enter-from { opacity: 0; transform: translateY(10px); }
.page-leave-to { opacity: 0; transform: translateY(-6px); }
@media (max-width: 1099px) {
  .main-content { margin-left: 0; padding: var(--space-3) var(--space-6) var(--space-8); }
  .main-content.main-workspace { padding: 8px 12px; }
}
@media (max-width: 767px) {
  /* 底栏胶囊会因 Home 指示条整体上移（见 MobileNav），内容底部同步让位 */
  .main-content { padding: var(--space-2) var(--space-4) calc(var(--mobile-nav-height) + var(--safe-bottom) + var(--space-8)); }
  /* 手机端底栏是浮起来的胶囊：工作台把这段高度让出来，卡片不会被压住 */
  .main-content.main-workspace { padding: 6px 10px calc(var(--mobile-nav-height) + var(--safe-bottom) + 8px); }
}
</style>
