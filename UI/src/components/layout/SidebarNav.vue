<template>
  <aside class="sidebar" :class="{ open }" aria-label="主导航">
    <div class="mode-block">
      <button class="mode-card" aria-haspopup="menu" :aria-expanded="menuOpen" @click="menuOpen = !menuOpen">
        <span class="mode-dot"></span>
        <div class="mode-text"><small>当前模式</small><strong>{{ currentLabel }}</strong></div>
        <ChevronDown :size="16" :class="{ flip: menuOpen }" />
      </button>
      <div v-if="menuOpen" class="mode-menu animate-scale-in" role="menu">
        <button
          v-for="m in modes"
          :key="m.id"
          role="menuitem"
          class="mode-option"
          :class="{ current: m.id === store.currentMode }"
          @click="choose(m.id)"
        >
          <strong>{{ m.label }}</strong><small>{{ m.note }}</small>
        </button>
        <p class="mode-hint">切换只影响概览与计划的展示分支；周期负荷与 RPE 记录尚未实现。</p>
      </div>
    </div>
    <nav>
      <RouterLink v-for="(item, i) in items" :key="item.to" :to="item.to" class="nav-item animate-slide-in-up" :style="{ animationDelay: 60 + i * 55 + 'ms' }" @click="emit('close')">
        <component :is="item.icon" :size="19" /><span>{{ item.label }}</span>
      </RouterLink>
    </nav>
    <div class="sidebar-foot">
      <div class="mini-progress">
        <span>本周进度</span><b>2 / 3</b>
        <div><i style="width:66%"></i></div>
      </div>
      <RouterLink to="/onboarding" class="settings" @click="emit('close')"><User :size="18" />个人档案</RouterLink>
      <RouterLink to="/settings" class="settings" @click="emit('close')"><Settings :size="18" />个人设置</RouterLink>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { CalendarDays, ClipboardList, Dumbbell, Utensils, BarChart3, Settings, ChevronDown, User } from 'lucide-vue-next'
import { useAppStore } from '@/stores/app'
import type { Mode } from '@/types/domain'

defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const store = useAppStore()
const menuOpen = ref(false)

const items = [
  { to: '/dashboard', label: '今日概览', icon: BarChart3 },
  { to: '/plan', label: '训练计划', icon: CalendarDays },
  { to: '/execution', label: '摄像头跟练', icon: Dumbbell },
  { to: '/meals', label: '饮食记录', icon: Utensils },
  { to: '/report', label: '我的周报', icon: ClipboardList }
]

const modes: { id: Mode; label: string; note: string }[] = [
  { id: 'public', label: '大众模式', note: '轻量推荐 · 自动计数 · 简单餐次确认' },
  { id: 'athlete', label: '运动员模式', note: '周期训练台 · 计划锁定 · 负荷视图' }
]

const currentLabel = computed(() => (store.isAthleteMode ? '运动员模式' : '大众模式'))

function choose(id: Mode) {
  menuOpen.value = false
  if (id !== store.currentMode) store.switchMode(id)
}
</script>

<style scoped>
.sidebar{position:fixed;left:0;top:var(--topbar-height);bottom:0;width:var(--sidebar-width);background:rgba(255,255,255,.86);backdrop-filter:blur(16px);border-right:1px solid var(--color-border);padding:var(--space-6) var(--space-4);display:flex;flex-direction:column;z-index:var(--z-sticky)}
.mode-block{margin-bottom:24px;position:relative}
.mode-card{width:100%;display:flex;align-items:center;gap:10px;padding:12px;border-radius:14px;background:linear-gradient(135deg,#edfafa,#f1f7fc);color:var(--color-navy);transition:box-shadow var(--motion-fast)}
.mode-card:hover{box-shadow:var(--shadow-sm)}
.mode-text{flex:1;text-align:left}
.mode-card small,.mode-card strong{display:block}
.mode-card small{font-size:11px;color:var(--color-text-muted)}
.mode-card strong{font-size:13px;margin-top:2px}
.mode-dot{width:9px;height:9px;border-radius:50%;background:#28b58b;box-shadow:0 0 0 4px #28b58b22;flex:none}
.flip{transform:rotate(180deg);transition:transform var(--motion-fast)}
.mode-menu{margin-top:10px;padding:8px;border-radius:14px;background:white;border:1px solid var(--color-border);box-shadow:var(--shadow-lg);display:grid;gap:6px}
.mode-option{padding:10px 12px;border-radius:11px;text-align:left;transition:background var(--motion-fast)}
.mode-option strong,.mode-option small{display:block}
.mode-option strong{font-size:13px;color:var(--color-navy)}
.mode-option small{font-size:11px;color:var(--color-text-muted);margin-top:3px;line-height:1.5}
.mode-option:hover{background:#eef8f5}
.mode-option.current{background:var(--gradient-teal)}
.mode-option.current strong,.mode-option.current small{color:white}
.mode-hint{font-size:11px;color:var(--color-text-muted);line-height:1.6;padding:4px 6px;margin:0}
nav{display:grid;gap:7px}
.nav-item,.settings{display:flex;align-items:center;gap:12px;color:var(--color-text-secondary);padding:13px 14px;border-radius:13px;font-size:14px;transition:all var(--motion-base)}
.nav-item:hover,.nav-item.router-link-active{color:var(--color-teal);background:linear-gradient(135deg,#e5f8f4,#edf5fc);transform:translateX(3px)}
.nav-item.router-link-active{font-weight:600}
.sidebar-foot{margin-top:auto}
.mini-progress{padding:14px;border-radius:14px;background:var(--gradient-navy);color:white;margin-bottom:14px}
.mini-progress span{font-size:12px;opacity:.75}
.mini-progress b{float:right;font-size:14px}
.mini-progress div{height:5px;background:#ffffff38;border-radius:10px;clear:both;margin-top:12px;overflow:hidden}
.mini-progress i{display:block;height:100%;background:#62ddc2;border-radius:10px;transition:width var(--motion-slow) var(--easing-ease-out)}
.settings{font-size:13px}
@media(max-width:1099px){.sidebar{transform:translateX(-100%);transition:transform var(--motion-base) var(--easing-ease-out);box-shadow:var(--shadow-lg);z-index:calc(var(--z-sticky) + 2);background:rgba(255,255,255,.97)}.sidebar.open{transform:translateX(0)}}
</style>
