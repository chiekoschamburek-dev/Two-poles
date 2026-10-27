<template>
  <Teleport to="body">
    <!-- 进站弹窗：只在当天还没选过「今日不再出现」时自动出现 -->
    <Transition name="wk-scrim">
      <div v-if="modalOpen" class="wk-scrim" @click.self="closeModal">
        <section
          id="wellness-modal"
          ref="modalPanel"
          class="wk-modal"
          role="dialog"
          aria-modal="true"
          aria-label="今日养生"
          tabindex="-1"
        >
          <div class="wk-modal-bar">
            <span class="micro">Daily wellness</span>
            <div class="wk-controls">
              <button type="button" class="wk-no-more" data-wellness-dismiss @click="dismiss">
                今日不再出现
              </button>
              <button type="button" class="wk-x" aria-label="关闭今日养生" @click="closeModal">
                <X :size="17" />
              </button>
            </div>
          </div>
          <div class="wk-modal-body">
            <DailyWellnessCard :date="today" />
          </div>
        </section>
      </div>
    </Transition>

    <!-- 点导航栏小卡片后，贴在它旁边浮在主页上的小卡；没有遮罩，不拦页面 -->
    <Transition name="wk-pop">
      <aside
        v-if="cardOpen && !modalOpen"
        id="wellness-float"
        ref="floatPanel"
        class="wk-float"
        role="dialog"
        aria-modal="false"
        aria-label="今日养生小卡片"
        tabindex="-1"
      >
        <div class="wk-float-bar">
          <span class="micro">Daily wellness</span>
          <button type="button" class="wk-x" aria-label="关闭今日养生小卡片" @click="closeCard">
            <X :size="16" />
          </button>
        </div>
        <div class="wk-float-body">
          <DailyWellnessCard :date="today" compact />
        </div>
      </aside>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { X } from 'lucide-vue-next'
import DailyWellnessCard from './DailyWellnessCard.vue'
import { useAppStore } from '@/stores/app'
import { useWellnessDock } from '@/composables/useWellnessDock'

const store = useAppStore()
const { modalOpen, cardOpen, closeModal, dismissToday, closeCard } = useWellnessDock()

/** 与弹窗同日：页面开着过零点不换卡，刷新后才换——和原来的每日卡片口径一致 */
const today = new Date()
const modalPanel = ref<HTMLElement | null>(null)
const floatPanel = ref<HTMLElement | null>(null)

let previousOverflow = ''
let previousActive: HTMLElement | null = null
let modalListening = false
let floatListening = false

function dismiss() {
  const persisted = dismissToday()
  store.showToast({
    type: persisted ? 'info' : 'warning',
    title: persisted ? '今天不再自动弹出' : '本次已关闭，但没能记住',
    message: persisted
      ? '导航栏里的「养生」小卡片仍然可以随时打开'
      : '浏览器存储不可用，刷新后还会弹出；小卡片仍可随时打开',
    duration: 4000
  })
}

function onModalKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    closeModal()
    return
  }
  if (event.key !== 'Tab' || !modalPanel.value) return
  const nodes = modalPanel.value.querySelectorAll<HTMLElement>(
    'button:not([disabled]), a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  )
  if (!nodes.length) return
  const first = nodes[0]
  const last = nodes[nodes.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

function onFloatKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  event.preventDefault()
  closeCard()
}

function cleanupModal() {
  if (modalListening) {
    window.removeEventListener('keydown', onModalKeydown)
    modalListening = false
  }
  document.body.style.overflow = previousOverflow
}

function cleanupFloat() {
  if (floatListening) {
    window.removeEventListener('keydown', onFloatKeydown)
    floatListening = false
  }
}

watch(modalOpen, async (open) => {
  if (open) {
    previousActive = document.activeElement instanceof HTMLElement ? document.activeElement : null
    previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onModalKeydown)
    modalListening = true
    await nextTick()
    modalPanel.value?.focus()
  } else {
    cleanupModal()
    previousActive?.focus?.()
  }
}, { immediate: true })

watch(cardOpen, async (open) => {
  if (open) {
    window.addEventListener('keydown', onFloatKeydown)
    floatListening = true
    await nextTick()
    floatPanel.value?.focus()
  } else {
    cleanupFloat()
    // 回到触发它的地方：桌面是图标脊上的小卡片，手机是能重新打开抽屉的菜单按钮
    const wide = window.matchMedia('(min-width: 1100px)').matches
    const target = wide
      ? document.getElementById('wellness-rail-trigger')
      : document.querySelector<HTMLElement>('.menu-btn')
    target?.focus?.()
  }
})

onBeforeUnmount(() => {
  cleanupModal()
  cleanupFloat()
})
</script>

<style scoped>
/* ——— 进站弹窗 ——— */
.wk-scrim {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal-backdrop);
  background: var(--overlay);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  display: grid;
  place-items: center;
  padding: 22px;
}
.wk-modal {
  width: min(760px, 100%);
  max-height: min(88vh, 940px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xl);
  box-shadow: 0 30px 80px -40px rgba(11, 16, 20, 0.65);
  outline: none;
}
.wk-modal-bar {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px 10px 16px;
  border-bottom: 1px solid var(--color-divider);
  background: var(--color-card);
}
.wk-controls {
  display: flex;
  align-items: center;
  gap: 6px;
}
.wk-no-more {
  min-height: 32px;
  padding: 0 10px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-border);
  background: var(--color-card);
  font-size: 11.5px;
  font-weight: 600;
  color: var(--color-text-secondary);
  white-space: nowrap;
  transition: border-color var(--motion-fast), color var(--motion-fast);
}
.wk-no-more:hover {
  border-color: var(--color-caution);
  color: var(--color-caution);
}
.wk-x {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-border);
  background: var(--color-card);
  color: var(--color-text-secondary);
  flex: none;
  transition: border-color var(--motion-fast), color var(--motion-fast);
}
.wk-x:hover {
  border-color: var(--color-ink);
  color: var(--color-ink);
}
.wk-modal-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 14px 16px;
}
.wk-modal-body :deep(.wellness) {
  margin-top: 14px;
}

/* ——— 悬浮小卡片 ——— */
.wk-float {
  position: fixed;
  left: calc(var(--sidebar-width) + 14px);
  bottom: 110px;
  z-index: calc(var(--z-sticky) + 2);
  width: min(380px, calc(100vw - var(--sidebar-width) - 28px));
  max-height: min(calc(100dvh - 140px), 680px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--color-card);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xl);
  box-shadow: 0 24px 60px -34px rgba(11, 16, 20, 0.55), var(--inner-light);
  outline: none;
  transform-origin: bottom left;
}
.wk-float-bar {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 8px 6px 14px;
  border-bottom: 1px solid var(--hair-soft);
}
.wk-float-bar .micro {
  color: var(--color-text-muted);
}
.wk-float-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.wk-scrim-enter-active,
.wk-scrim-leave-active {
  transition: opacity var(--motion-base) var(--easing-ease-out);
}
.wk-scrim-enter-active .wk-modal,
.wk-scrim-leave-active .wk-modal {
  transition: transform var(--motion-base) var(--easing-ease-out), opacity var(--motion-base) var(--easing-ease-out);
}
.wk-scrim-enter-from,
.wk-scrim-leave-to {
  opacity: 0;
}
.wk-scrim-enter-from .wk-modal,
.wk-scrim-leave-to .wk-modal {
  transform: translateY(12px) scale(0.985);
  opacity: 0;
}

.wk-pop-enter-active,
.wk-pop-leave-active {
  transition: opacity var(--motion-base) var(--easing-ease-out), transform var(--motion-base) var(--easing-ease-out);
}
.wk-pop-enter-from,
.wk-pop-leave-to {
  opacity: 0;
  transform: translateY(8px) scale(0.98);
}

@media (max-width: 1099px) {
  .wk-float {
    left: 12px;
    bottom: 16px;
    width: min(380px, calc(100vw - 24px));
  }
}
@media (max-width: 767px) {
  .wk-scrim {
    padding: 10px;
  }
  .wk-modal {
    width: 100%;
    max-height: calc(100dvh - 20px);
  }
  .wk-float {
    left: 10px;
    bottom: calc(var(--mobile-nav-height) + 18px);
    width: calc(100vw - 20px);
  }
  .wk-float-bar {
    padding-left: 12px;
  }
}
@media (max-height: 700px) and (min-width: 1100px) {
  .wk-float {
    bottom: 86px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .wk-scrim-enter-active,
  .wk-scrim-leave-active,
  .wk-scrim-enter-active .wk-modal,
  .wk-scrim-leave-active .wk-modal,
  .wk-pop-enter-active,
  .wk-pop-leave-active {
    transition: none;
  }
}
</style>
