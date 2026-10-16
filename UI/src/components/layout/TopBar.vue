<template>
  <header class="topbar">
    <button class="mobile-menu" :aria-label="menuOpen ? '关闭菜单' : '打开菜单'" :aria-expanded="menuOpen" @click="$emit('toggle-menu')">
      <Menu :size="22" />
    </button>
    <div class="brand">
      <svg class="brand-mark" viewBox="0 0 64 64" role="img" aria-label="两仪·TwoPoles">
        <defs>
          <linearGradient id="poleUp" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stop-color="#0a9b9d" />
            <stop offset="1" stop-color="#5fe3cd" />
          </linearGradient>
          <linearGradient id="poleDown" x1="1" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#4d94cc" />
            <stop offset="1" stop-color="#a9ddf2" />
          </linearGradient>
        </defs>
        <g fill="none" stroke-width="8" stroke-linecap="round">
          <path d="M13.21 25.16A20 20 0 0 1 50.79 25.16" stroke="url(#poleUp)" />
          <path d="M50.79 38.84A20 20 0 0 1 13.21 38.84" stroke="url(#poleDown)" />
        </g>
        <circle cx="12" cy="32" r="3.6" fill="#5fe3cd" />
        <circle cx="52" cy="32" r="3.6" fill="#a9ddf2" />
      </svg>
      <div><strong>两仪·TwoPoles</strong><span>运动与饮食协同助手</span></div>
    </div>
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
.topbar{height:var(--topbar-height);background:linear-gradient(112deg,#12303f 0%,#16334b 46%,#1f4b64 100%);color:#fff;display:flex;align-items:center;padding:0 var(--space-8);justify-content:space-between;position:sticky;top:0;z-index:var(--z-sticky);box-shadow:inset 0 1px 0 rgba(255,255,255,.07),0 12px 30px -16px rgba(11,34,50,.6)}
.topbar::after{content:'';position:absolute;left:0;right:0;bottom:0;height:2px;background:linear-gradient(90deg,transparent,rgba(95,227,205,.55),rgba(169,221,242,.45),transparent);pointer-events:none}
.brand{display:flex;align-items:center;gap:12px}.brand-mark{width:42px;height:42px;flex:none;filter:drop-shadow(0 4px 12px rgba(10,38,56,.5))}.brand strong{display:block;font-family:var(--font-display);font-size:20px;letter-spacing:-.01em}.brand span{display:block;font-size:12px;color:#c8d9e3;margin-top:2px}.top-actions{display:flex;align-items:center;gap:16px}.date{font-size:13px;color:#dceaf2;padding:7px 14px;border-radius:999px;background:rgba(255,255,255,.09);box-shadow:inset 0 1px 0 rgba(255,255,255,.12);font-variant-numeric:tabular-nums}.avatar{width:40px;height:40px;border-radius:50%;background:linear-gradient(140deg,#f2fbf8,#dceaf6);color:var(--color-teal);font-weight:700;font-size:16px;box-shadow:0 0 0 2px rgba(255,255,255,.16);transition:transform var(--motion-fast) var(--easing-spring),box-shadow var(--motion-fast)}.avatar:hover{transform:scale(1.06);box-shadow:0 0 0 3px rgba(95,227,205,.5)}.mobile-menu{display:none;color:white}
@media(max-width:767px){.topbar{height:72px;padding:0 var(--space-4)}.mobile-menu{display:grid;place-items:center;margin-right:10px}.brand{margin-right:auto}.brand strong{font-size:16px}.brand span,.date{display:none}.brand-mark{width:32px;height:32px}}
</style>
