<template>
  <header class="topbar">
    <button class="menu-btn" :aria-label="menuOpen ? '关闭菜单' : '打开菜单'" :aria-expanded="menuOpen" @click="$emit('toggle-menu')">
      <Menu :size="20" />
    </button>

    <RouterLink to="/dashboard" class="lockup" aria-label="返回今日概览">
      <svg class="mark" viewBox="0 0 64 64" role="img" aria-label="两仪·TwoPoles">
        <g fill="none" stroke-width="5.6">
          <circle cx="32" cy="32" r="21.5" stroke="var(--brand-pole-ring)" />
          <g stroke-linecap="round">
            <path d="M16.3 16.3A22.2 22.2 0 0 1 47.7 16.3" stroke="var(--brand-pole-a)" />
            <path d="M47.7 47.7A22.2 22.2 0 0 1 16.3 47.7" stroke="var(--brand-pole-b)" />
          </g>
        </g>
        <circle cx="10.5" cy="32" r="3.1" fill="var(--brand-pole-a)" />
        <circle cx="53.5" cy="32" r="3.1" fill="var(--brand-pole-b)" />
      </svg>
      <span class="micro">TwoPoles · 运动与饮食协同</span>
    </RouterLink>

    <div class="right">
      <!-- 模式是全局上下文，跟"今天在看哪一页"无关，所以放在页头而不是导航脊 -->
      <div class="mode-wrap">
        <button ref="modeBtn" class="mode" :class="{ open: modeOpen }" aria-haspopup="menu" :aria-expanded="modeOpen" @click="toggleMode">
          <i class="dot"></i>
          <span>{{ currentLabel }}</span>
          <b v-if="isAthlete && cycleWeek">W{{ cycleWeek }}</b>
          <ChevronDown :size="13" class="chev" :class="{ flip: modeOpen }" />
        </button>

        <Transition name="pop">
          <div v-if="modeOpen" class="popover" role="menu">
            <template v-if="!preview">
              <p class="pop-title">当前模式</p>
              <button
                v-for="m in modes"
                :key="m.id"
                role="menuitem"
                class="mode-option"
                :class="{ current: m.id === store.currentMode }"
                @click="request(m.id)"
              >
                <strong>{{ m.label }}</strong>
                <small>{{ m.note }}</small>
              </button>
              <p class="pop-hint">切换前会先列出差异与未完成计划，确认后才生效。</p>
            </template>

            <template v-else>
              <p class="pop-title">切换到{{ preview.toLabel }}？</p>
              <p class="pop-lead">{{ preview.openPlanNote }}</p>
              <div class="pop-cols">
                <div>
                  <span>变化</span>
                  <ul><li v-for="d in preview.differences" :key="d">{{ d }}</li></ul>
                </div>
                <div>
                  <span>保持不变</span>
                  <ul><li v-for="k in preview.keeps" :key="k">{{ k }}</li></ul>
                </div>
              </div>
              <div class="pop-actions">
                <button ref="confirmBtn" class="btn-primary" @click="confirm">确认切换</button>
                <button class="btn-ghost" @click="cancel">取消</button>
              </div>
            </template>
          </div>
        </Transition>
      </div>

      <span class="date">{{ dateLabel }}</span>
      <button class="avatar" aria-label="个人设置" @click="router.push('/settings')">{{ initial }}</button>
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import { Menu, ChevronDown } from 'lucide-vue-next'
import { useRouter } from 'vue-router'
import { useAppStore } from '@/stores/app'
import { shortDate } from '@/utils/time'
import type { Mode } from '@/types/domain'

withDefaults(defineProps<{ menuOpen?: boolean }>(), { menuOpen: false })
defineEmits<{ (e: 'toggle-menu'): void }>()

const router = useRouter()
const store = useAppStore()
const modeOpen = ref(false)
const modeBtn = ref<HTMLButtonElement | null>(null)
const confirmBtn = ref<HTMLButtonElement | null>(null)
const dateLabel = shortDate(new Date())
const initial = computed(() => store.userProfile?.nickname?.trim()?.charAt(0) || '我')

const modes: { id: Mode; label: string; note: string }[] = [
  { id: 'public', label: '大众模式', note: '轻量推荐 · 自动计数 · 简单餐次确认' },
  { id: 'athlete', label: '运动员模式', note: '周期训练台 · 计划锁定 · 负荷视图' }
]

const currentLabel = computed(() => (store.isAthleteMode ? '运动员模式' : '大众模式'))
const isAthlete = computed(() => store.isAthleteMode)
const preview = computed(() => store.switchPreview)

/** 运动员模式下把"周期第几周"标出来，否则这个模式看不出周期感 */
const cycleWeek = computed(() => {
  const start = store.userProfile?.cycleStartDate
  if (!start) return null
  const t = new Date(`${start}T00:00:00`).getTime()
  if (Number.isNaN(t)) return null
  const days = Math.floor((Date.now() - t) / 86400000)
  if (days < 0) return null
  return Math.floor(days / 7) + 1
})

function toggleMode() {
  modeOpen.value = !modeOpen.value
  if (!modeOpen.value) store.cancelModeSwitch()
}

function request(id: Mode) {
  store.requestModeSwitch(id)
}

function confirm() {
  store.confirmModeSwitch()
  modeOpen.value = false
  // 确认后弹出的分支已被移除，焦点还给触发它的模式按钮，而不是掉到页面开头
  nextTick(() => modeBtn.value?.focus())
}

function cancel() {
  store.cancelModeSwitch()
  nextTick(() => modeBtn.value?.focus())
}

// 选完模式后选项按钮会被确认分支替换；把焦点交给「确认切换」，键盘可以直接继续
watch(preview, async (p) => {
  if (!p) return
  await nextTick()
  confirmBtn.value?.focus()
})

/** 点外面收起：一个全局上下文菜单不该要求用户再点一次按钮才能关 */
function onDocClick(e: MouseEvent) {
  if (!modeOpen.value) return
  // 选中某个模式后，Vue 会在同一个 click 冒泡到 document 之前把列表换成"确认"分支，
  // 被点的按钮已经脱离 DOM，closest('.mode-wrap') 会误判成"点了外面"。
  // composedPath() 在事件派发时固定，不受重渲染影响。
  const inside = e.composedPath().some(
    node => node instanceof Element && node.classList.contains('mode-wrap')
  )
  if (!inside) toggleMode()
}
function onEsc(e: KeyboardEvent) {
  if (e.key === 'Escape' && modeOpen.value) toggleMode()
}
onMounted(() => {
  document.addEventListener('click', onDocClick)
  document.addEventListener('keydown', onEsc)
})
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick)
  document.removeEventListener('keydown', onEsc)
})
</script>

<style scoped>
.topbar {
  position: sticky;
  top: 0;
  z-index: var(--z-sticky);
  height: var(--topbar-height);
  margin-left: var(--sidebar-width);
  padding: 0 var(--gutter) 0 var(--space-7);
  display: flex;
  align-items: center;
  gap: 14px;
  background: linear-gradient(180deg, var(--color-bg) 62%, color-mix(in srgb, var(--color-bg) 72%, transparent));
  backdrop-filter: blur(10px) saturate(1.2);
  -webkit-backdrop-filter: blur(10px) saturate(1.2);
  border-bottom: 1px solid var(--color-divider);
}

.lockup { display: flex; align-items: center; gap: 9px; color: inherit; text-decoration: none; }
/* 导航脊上已经有标志了，桌面端页头不再重复一次；窄屏脊收进抽屉，这里才把标志露出来 */
.mark { display: none; width: 20px; height: 20px; flex: none; }
.lockup .micro { color: var(--color-text-muted); }
.lockup:hover .micro { color: var(--color-text-secondary); }

.right { margin-left: auto; display: flex; align-items: center; gap: 10px; }

.date {
  font-family: var(--font-num);
  font-size: 11px;
  letter-spacing: 0.1em;
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

/* 模式芯片：白底细边，强调色只出现在那个点与数字上 */
.mode-wrap { position: relative; }
.mode {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 28px;
  padding: 0 10px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-border);
  background: var(--color-card);
  color: var(--color-text-secondary);
  font-size: 11.5px;
  font-weight: 500;
  transition: border-color var(--motion-fast), background var(--motion-fast);
}
.mode:hover, .mode.open { border-color: var(--color-accent-line); background: var(--color-card); }
.mode .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--color-accent); flex: none; }
.mode b { font-family: var(--font-num); font-size: 10.5px; font-weight: 600; color: var(--color-accent); letter-spacing: 0.04em; }
.chev { color: var(--color-text-muted); transition: transform var(--motion-fast); }
.chev.flip { transform: rotate(180deg); }

.popover {
  position: absolute;
  right: 0;
  top: calc(100% + 8px);
  width: 344px;
  padding: 12px;
  border-radius: var(--radius-lg);
  background: var(--color-card);
  border: 1px solid var(--color-border);
  box-shadow: var(--shadow-lg);
  display: grid;
  gap: 6px;
  z-index: var(--z-dropdown);
}
.pop-title { font-size: 11px; font-weight: 700; letter-spacing: 0.1em; color: var(--color-text-muted); margin: 0 0 2px; text-transform: uppercase; font-family: var(--font-num); }
.mode-option { padding: 9px 10px; border-radius: var(--radius-base); text-align: left; transition: background var(--motion-fast); }
.mode-option strong, .mode-option small { display: block; }
.mode-option strong { font-size: 13px; color: var(--color-ink); font-weight: 600; }
.mode-option small { font-size: 11px; color: var(--color-text-muted); margin-top: 3px; line-height: 1.5; }
.mode-option:hover { background: var(--color-neutral-soft); }
.mode-option.current { background: var(--color-accent-soft); box-shadow: inset 2px 0 0 var(--color-accent); }
.mode-option.current strong { color: var(--color-accent-strong); }
.pop-hint { font-size: 10.5px; color: var(--color-text-muted); line-height: 1.6; padding: 4px 4px 0; margin: 0; }

.pop-lead { font-size: 11.5px; color: var(--color-caution); line-height: 1.6; margin: 0; background: var(--color-caution-soft); border-radius: var(--radius-base); padding: 8px 10px; }
.pop-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; font-size: 11.5px; margin-top: 4px; }
.pop-cols span { display: block; font-weight: 700; color: var(--color-text-muted); margin-bottom: 4px; font-size: 10.5px; letter-spacing: 0.06em; }
.pop-cols ul { margin: 0; padding-left: 14px; line-height: 1.6; color: var(--color-text-secondary); }
.pop-actions { display: flex; gap: 8px; margin-top: 8px; }
.btn-primary, .btn-ghost { flex: 1; min-height: 38px; border-radius: var(--radius-base); font-size: 12.5px; font-weight: 600; font-family: inherit; }
.btn-primary { background: var(--color-ink); color: var(--color-card); }
.btn-ghost { background: var(--color-neutral-soft); color: var(--color-text-secondary); }

.avatar {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: var(--color-ink);
  color: var(--color-card);
  font-family: var(--font-num);
  font-weight: 600;
  font-size: 12.5px;
  display: grid;
  place-items: center;
  transition: transform var(--motion-fast) var(--easing-spring);
  flex: none;
}
.avatar:hover { transform: scale(1.06); }

.menu-btn { display: none; color: var(--color-ink); }

.pop-enter-active, .pop-leave-active { transition: opacity var(--motion-fast) var(--easing-ease-out), transform var(--motion-fast) var(--easing-ease-out); }
.pop-enter-from, .pop-leave-to { opacity: 0; transform: translateY(-4px); }

@media (max-width: 1099px) {
  .topbar { margin-left: 0; padding: 0 var(--space-6); }
  /* 抽屉在 1099px 就出现了，汉堡按钮必须同一档出现，否则 768–1099 之间没有任何导航入口 */
  .menu-btn { display: grid; place-items: center; width: 32px; height: 32px; margin-left: -8px; }
  .mark { display: block; }
}
@media (max-width: 767px) {
  .topbar { padding: 0 var(--space-4); gap: 10px; }
  .menu-btn { display: grid; place-items: center; width: 32px; height: 32px; margin-left: -6px; }
  .mark { width: 18px; height: 18px; }
  .lockup .micro { display: none; }
  .date { display: none; }
  .popover { width: min(92vw, 344px); right: -40px; }
}
</style>
