<template>
  <div ref="tablist" class="pole-tabs" role="tablist" :aria-label="label" @keydown="onKeydown">
    <button
      v-for="tab in tabs"
      :id="`${base}-tab-${tab.id}`"
      :key="tab.id"
      type="button"
      role="tab"
      class="tab"
      :class="{ on: modelValue === tab.id }"
      :aria-selected="modelValue === tab.id"
      :aria-controls="`${base}-panel-${tab.id}`"
      :tabindex="modelValue === tab.id ? 0 : -1"
      @click="select(tab.id)"
    >
      {{ tab.label }}
      <span v-if="tab.count" class="count">{{ tab.count }}</span>
    </button>
  </div>
</template>

<script lang="ts">
export interface PoleTab {
  id: string
  label: string
  count?: string | number
}
</script>

<script setup lang="ts">
import { ref } from 'vue'

const props = withDefaults(
  defineProps<{
    tabs: PoleTab[]
    modelValue: string
    label: string
    /** 用于 tab / panel 的 id 前缀，保证页面上两组 tab 不撞 id */
    base: string
  }>(),
  {}
)
const emit = defineEmits<{ (e: 'update:modelValue', value: string): void }>()

const tablist = ref<HTMLElement | null>(null)

function select(id: string) {
  if (id !== props.modelValue) emit('update:modelValue', id)
}

/** 左右方向键在三个视图之间移动，Home / End 跳到首尾；这是 tablist 的标准键盘路径 */
function onKeydown(event: KeyboardEvent) {
  const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End']
  if (!keys.includes(event.key)) return
  const index = props.tabs.findIndex(t => t.id === props.modelValue)
  if (index < 0) return
  event.preventDefault()
  let next = index
  if (event.key === 'ArrowLeft') next = (index - 1 + props.tabs.length) % props.tabs.length
  if (event.key === 'ArrowRight') next = (index + 1) % props.tabs.length
  if (event.key === 'Home') next = 0
  if (event.key === 'End') next = props.tabs.length - 1
  const id = props.tabs[next].id
  emit('update:modelValue', id)
  // 焦点跟到新 tab，读屏才会播报选中的视图
  requestAnimationFrame(() => {
    const buttons = tablist.value?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
    buttons?.[next]?.focus()
  })
}
</script>

<style scoped>
.pole-tabs {
  display: flex;
  gap: 2px;
  padding: 3px;
  margin: 0 18px 2px;
  border-radius: var(--radius-sm);
  background: var(--color-neutral-soft);
  flex: none;
}
.tab {
  flex: 1;
  min-height: 32px;
  padding: 6px 10px;
  border-radius: 5px;
  color: var(--color-text-muted);
  font-size: 12.5px;
  font-weight: 500;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  transition: background var(--motion-fast), color var(--motion-fast), box-shadow var(--motion-fast);
}
.tab:hover {
  color: var(--color-text-secondary);
}
.tab.on {
  background: var(--color-card);
  color: var(--pole-strong, var(--color-ink));
  font-weight: 600;
  box-shadow: var(--shadow-sm);
}
.count {
  font-family: var(--font-num);
  font-size: 10.5px;
  font-weight: 600;
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
}
.tab.on .count {
  color: var(--pole-color, var(--color-accent));
}
</style>
