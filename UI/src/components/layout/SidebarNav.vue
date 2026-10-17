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
          @click="request(m.id)"
        >
          <strong>{{ m.label }}</strong><small>{{ m.note }}</small>
        </button>
        <p class="mode-hint">切换前会先列出差异与未完成计划，确认后才生效。</p>
      </div>

      <div v-if="preview" class="switch-confirm animate-scale-in" role="dialog" aria-modal="false" aria-labelledby="switch-title">
        <strong id="switch-title">切换到{{ preview.toLabel }}？</strong>
        <p class="sc-lead">{{ preview.openPlanNote }}</p>
        <div class="sc-cols">
          <div>
            <span>变化</span>
            <ul><li v-for="d in preview.differences" :key="d">{{ d }}</li></ul>
          </div>
          <div>
            <span>保持不变</span>
            <ul><li v-for="k in preview.keeps" :key="k">{{ k }}</li></ul>
          </div>
        </div>
        <div class="sc-actions">
          <button class="sc-go" @click="confirm">确认切换</button>
          <button class="sc-cancel" @click="cancel">取消</button>
        </div>
      </div>
    </div>
    <nav>
      <RouterLink v-for="item in items" :key="item.to" :to="item.to" class="nav-item animate-slide-in-up" @click="emit('close')">
        <component :is="item.icon" :size="19" /><span>{{ item.label }}</span>
      </RouterLink>
    </nav>
    <div class="sidebar-foot">
      <div class="mini-progress">
        <span>本周进度</span><b>{{ weekValue }}</b>
        <div><i :style="{ width: weekWidth }"></i></div>
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
import { buildWeeklyReport } from '@/services/weekRules'
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
const preview = computed(() => store.switchPreview)
const week = computed(() => buildWeeklyReport(store.sessions, store.meals, new Date(), { profile: store.userProfile, mode: store.currentMode }))
const weekValue = computed(() => (week.value.completionRate === null ? '本周未安排' : `${week.value.completedSessions} / ${week.value.plannedSessions}`))
const weekWidth = computed(() => `${Math.min(100, (week.value.completionRate ?? 0) * 100)}%`)

function request(id: Mode) {
  menuOpen.value = false
  store.requestModeSwitch(id)
}

function confirm() {
  store.confirmModeSwitch()
}

function cancel() {
  store.cancelModeSwitch()
}
</script>

<style scoped>
.sidebar{position:fixed;left:0;top:var(--topbar-height);bottom:0;width:var(--sidebar-width);background:var(--surface-glass);backdrop-filter:blur(18px) saturate(1.5);-webkit-backdrop-filter:blur(18px) saturate(1.5);border-right:1px solid var(--color-border);box-shadow:10px 0 30px -22px rgba(21,24,27,.3);padding:var(--space-6) var(--space-4);display:flex;flex-direction:column;z-index:var(--z-sticky)}
.mode-block{margin-bottom:24px;position:relative}
.mode-card{width:100%;display:flex;align-items:center;gap:10px;padding:12px;border-radius:14px;background:linear-gradient(135deg,var(--color-accent-soft),var(--color-neutral-soft));box-shadow:inset 0 1px 0 var(--hairline),0 0 0 1px rgba(15,118,110,.1);color:var(--color-ink);transition:box-shadow var(--motion-fast),transform var(--motion-fast) var(--easing-ease-out)}
.mode-card:hover{box-shadow:inset 0 1px 0 var(--hairline),0 0 0 1px rgba(15,118,110,.24),var(--shadow-sm);transform:translateY(-1px)}
.mode-text{flex:1;text-align:left}
.mode-card small,.mode-card strong{display:block}
.mode-card small{font-size:11px;color:var(--color-text-muted)}
.mode-card strong{font-size:13px;margin-top:2px}
.mode-dot{width:9px;height:9px;border-radius:50%;background:var(--color-accent);box-shadow:0 0 0 4px var(--color-accent)22;flex:none}
.flip{transform:rotate(180deg);transition:transform var(--motion-fast)}
.mode-menu{margin-top:10px;padding:8px;border-radius:14px;background:var(--color-card);border:1px solid var(--color-border);box-shadow:var(--shadow-lg);display:grid;gap:6px}
.mode-option{padding:10px 12px;border-radius:11px;text-align:left;transition:background var(--motion-fast)}
.mode-option strong,.mode-option small{display:block}
.mode-option strong{font-size:13px;color:var(--color-ink)}
.mode-option small{font-size:11px;color:var(--color-text-muted);margin-top:3px;line-height:1.5}
.mode-option:hover{background:var(--color-accent-soft)}
.mode-option.current{background:var(--color-accent)}
.mode-option.current strong,.mode-option.current small{color:var(--color-on-accent)}
.mode-hint{font-size:11px;color:var(--color-text-muted);line-height:1.6;padding:4px 6px;margin:0}
.switch-confirm{margin-top:10px;padding:12px;border-radius:14px;background:var(--color-card);border:1px solid var(--color-accent-line);box-shadow:var(--shadow-lg);display:grid;gap:10px}
.switch-confirm>strong{font-size:13px;color:var(--color-ink)}
.sc-lead{font-size:11.5px;color:var(--color-caution);line-height:1.6;margin:0;background:var(--color-caution-soft);border-radius:10px;padding:8px 10px}
.sc-cols{display:grid;gap:10px;font-size:11.5px}
.sc-cols span{display:block;font-weight:700;color:var(--color-text-muted);margin-bottom:4px}
.sc-cols ul{margin:0;padding-left:16px;line-height:1.65;color:var(--color-text-secondary)}
.sc-actions{display:flex;gap:8px}
.sc-go,.sc-cancel{flex:1;min-height:44px;border-radius:11px;font-size:12px;font-weight:700;transition:all var(--motion-fast)}
.sc-go{background:var(--color-accent);color:#fff}
.sc-go:hover{filter:brightness(1.06)}
.sc-cancel{background:var(--color-neutral-soft);color:var(--color-text-secondary)}
nav{display:grid;gap:7px}
.nav-item,.settings{position:relative;display:flex;align-items:center;gap:12px;color:var(--color-text-secondary);padding:13px 14px;border-radius:13px;font-size:14px;transition:all var(--motion-base) var(--easing-ease-out)}
/* 左侧渐变指示条：高度由 0 弹起，激活项一眼可辨且不带重量感边框 */
.nav-item::before{content:'';position:absolute;left:4px;top:50%;width:3px;height:0;border-radius:3px;background:linear-gradient(180deg,var(--color-accent),var(--color-accent-strong));transform:translateY(-50%);transition:height var(--motion-base) var(--easing-spring)}
.nav-item:hover::before{height:12px}
.nav-item.router-link-active::before{height:22px}
.nav-item:hover,.nav-item.router-link-active{color:var(--color-accent);background:var(--color-accent-soft);transform:translateX(3px);box-shadow:inset 0 1px 0 var(--hairline)}
.nav-item.router-link-active{font-weight:600}
.sidebar-foot{margin-top:auto}
.mini-progress{position:relative;overflow:hidden;padding:14px;border-radius:14px;background:var(--gradient-brand);color:white;margin-bottom:14px;box-shadow:var(--shadow-card),var(--inner-light)}
.mini-progress span{font-size:12px;opacity:.78}
.mini-progress b{float:right;font-size:14px;font-variant-numeric:tabular-nums}
.mini-progress div{height:5px;background:#ffffff38;border-radius:10px;clear:both;margin-top:12px;overflow:hidden}
.mini-progress i{display:block;height:100%;background:var(--color-accent);border-radius:10px;transition:width var(--motion-slow) var(--easing-ease-out)}
.settings{font-size:13px}
@media(max-width:1099px){.sidebar{transform:translateX(-100%);transition:transform var(--motion-base) var(--easing-ease-out);box-shadow:var(--shadow-lg);z-index:calc(var(--z-sticky) + 2);background:var(--surface-glass-strong)}.sidebar.open{transform:translateX(0)}}
/* 降低透明度偏好：玻璃面退成实底，去掉模糊 */
@media (prefers-reduced-transparency: reduce) {
  .sidebar{background:var(--color-card);backdrop-filter:none;-webkit-backdrop-filter:none}
}
</style>
