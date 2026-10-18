<template>
  <div class="shell">
    <TopBar :menu-open="mobileOpen" @toggle-menu="mobileOpen = !mobileOpen" />
    <SidebarNav :open="mobileOpen" @close="mobileOpen = false" />
    <Transition name="fade">
      <div v-if="mobileOpen" class="scrim" @click="mobileOpen = false"></div>
    </Transition>
    <main class="main-content">
      <RouterView v-slot="{ Component }">
        <Transition name="page" mode="out-in">
          <component :is="Component" />
        </Transition>
      </RouterView>
    </main>
    <MobileNav />
    <ToastRegion />
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import TopBar from './TopBar.vue'
import SidebarNav from './SidebarNav.vue'
import MobileNav from './MobileNav.vue'
import ToastRegion from '../common/ToastRegion.vue'
import { useAppStore } from '@/stores/app'

const mobileOpen = ref(false)
const route = useRoute()
const store = useAppStore()

watch(() => route.fullPath, () => {
  mobileOpen.value = false
})

onMounted(() => store.init())
</script>

<style scoped>
/* 背景由 body 的固定纸面 + 颗粒层承担：这里若再画一遍会盖掉噪点并让渐变随滚动重复 */
.shell { min-height: 100vh; }
/* 导航脊是 fixed 且贯穿整屏，主区只让出它的宽度；页头自己负责吸顶 */
.main-content {
  min-height: calc(100vh - var(--topbar-height));
  margin-left: var(--sidebar-width);
  padding: var(--space-2) var(--gutter) var(--space-10) var(--space-7);
}
.scrim { position: fixed; inset: 0; background: var(--overlay); z-index: calc(var(--z-sticky) + 1); }
.fade-enter-active, .fade-leave-active { transition: opacity var(--motion-base); }
.fade-enter-from, .fade-leave-to { opacity: 0; }
.page-enter-active, .page-leave-active { transition: opacity var(--motion-base) var(--easing-ease-out), transform var(--motion-base) var(--easing-ease-out); }
.page-enter-from { opacity: 0; transform: translateY(10px); }
.page-leave-to { opacity: 0; transform: translateY(-6px); }
@media (max-width: 1099px) { .main-content { margin-left: 0; padding: var(--space-3) var(--space-6) var(--space-8); } }
@media (max-width: 767px) { .main-content { padding: var(--space-2) var(--space-4) calc(var(--mobile-nav-height) + var(--space-8)); } }
</style>
