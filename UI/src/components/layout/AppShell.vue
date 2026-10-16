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
/* 背景由 body 的固定光晕层承担：这里若再画一遍会盖掉噪点层，并让渐变随滚动重复 */
.shell { min-height: 100vh; }
.main-content { min-height: calc(100vh - var(--topbar-height)); margin-left: var(--sidebar-width); padding: var(--space-8); }
.scrim { position: fixed; inset: var(--topbar-height) 0 0; background: rgba(21, 24, 27, .42); z-index: calc(var(--z-sticky) + 1); }
.fade-enter-active, .fade-leave-active { transition: opacity var(--motion-base); }
.fade-enter-from, .fade-leave-to { opacity: 0; }
.page-enter-active, .page-leave-active { transition: opacity var(--motion-base) var(--easing-ease-out), transform var(--motion-base) var(--easing-ease-out); }
.page-enter-from { opacity: 0; transform: translateY(12px); }
.page-leave-to { opacity: 0; transform: translateY(-8px); }
@media (max-width: 1099px) { .main-content { margin-left: 0; padding: var(--space-6); } }
@media (max-width: 767px) { .main-content { padding: var(--space-4); padding-bottom: calc(var(--mobile-nav-height) + var(--space-6)); } }
</style>
