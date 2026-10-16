<template>
  <header class="topbar">
    <button class="mobile-menu" :aria-label="menuOpen ? '关闭菜单' : '打开菜单'" :aria-expanded="menuOpen" @click="$emit('toggle-menu')">
      <Menu :size="22" />
    </button>
    <div class="brand"><div class="brand-mark">二</div><div><strong>两仪·TwoPoles</strong><span>运动与饮食协同助手</span></div></div>
    <div class="top-actions">
      <span class="date">{{ dateLabel }}</span>
      <button class="avatar" aria-label="个人设置" @click="router.push('/settings')">{{ initial }}</button>
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Menu } from 'lucide-vue-next'
import { useRouter } from 'vue-router'
import { useAppStore } from '@/stores/app'
import { shortDate } from '@/utils/time'

withDefaults(defineProps<{ menuOpen?: boolean }>(), { menuOpen: false })
defineEmits<{ (e: 'toggle-menu'): void }>()

const router = useRouter()
const store = useAppStore()
const dateLabel = shortDate(new Date())
const initial = computed(() => store.userProfile?.nickname?.trim()?.charAt(0) || '我')
</script>

<style scoped>
.topbar{height:var(--topbar-height);background:var(--gradient-navy);color:#fff;display:flex;align-items:center;padding:0 var(--space-8);justify-content:space-between;position:sticky;top:0;z-index:var(--z-sticky);box-shadow:var(--shadow-md)}
.brand{display:flex;align-items:center;gap:12px}.brand-mark{width:42px;height:42px;border-radius:14px;background:linear-gradient(135deg,#49d3bd,#147d98);display:grid;place-items:center;font-size:24px;font-weight:700;box-shadow:0 4px 16px #0a263855}.brand strong{display:block;font-size:20px}.brand span{display:block;font-size:12px;color:#c8d9e3;margin-top:2px}.top-actions{display:flex;align-items:center;gap:20px}.date{font-size:13px;color:#c8d9e3}.avatar{width:40px;height:40px;border-radius:50%;background:#e5f5f1;color:var(--color-teal);font-weight:700;font-size:16px}.mobile-menu{display:none;color:white}
@media(max-width:767px){.topbar{height:72px;padding:0 var(--space-4)}.mobile-menu{display:grid;place-items:center;margin-right:10px}.brand{margin-right:auto}.brand strong{font-size:16px}.brand span,.date{display:none}.brand-mark{width:36px;height:36px;font-size:20px}}
</style>
