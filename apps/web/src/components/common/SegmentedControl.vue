<template>
  <!-- 分段切换条：一个轨道里的互斥选项。比并排的实心按钮安静，也不抢同段主按钮的焦点 -->
  <div class="seg" role="group" :aria-label="label || undefined">
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      class="seg-btn"
      :class="{ on: option.value === modelValue }"
      :aria-pressed="option.value === modelValue"
      :disabled="option.disabled"
      @click="select(option)"
    >{{ option.label }}</button>
  </div>
</template>

<script setup lang="ts">
const props = withDefaults(defineProps<{
  modelValue: string
  options: { value: string; label: string; disabled?: boolean }[]
  label?: string
}>(), {
  label: ''
})
const emit = defineEmits<{ (e: 'update:modelValue', value: string): void }>()

function select(option: { value: string; disabled?: boolean }) {
  if (option.disabled || option.value === props.modelValue) return
  emit('update:modelValue', option.value)
}
</script>

<style scoped>
.seg {
  display: inline-flex;
  gap: 3px;
  max-width: 100%;
  padding: 3px;
  border-radius: var(--radius-md);
  background: var(--color-neutral-soft);
  box-shadow: inset 0 0 0 1px var(--color-border);
  overflow-x: auto;
  scrollbar-width: none;
}
.seg::-webkit-scrollbar { display: none; }
.seg-btn {
  min-height: 36px;
  padding: 0 14px;
  border-radius: 7px;
  font-family: inherit;
  font-size: 12.5px;
  font-weight: 600;
  line-height: 1.2;
  color: var(--color-text-secondary);
  background: transparent;
  white-space: nowrap;
  transition: background var(--motion-fast), color var(--motion-fast), box-shadow var(--motion-fast);
}
.seg-btn:hover:enabled { color: var(--color-ink); }
.seg-btn.on {
  color: var(--color-ink);
  background: var(--color-card);
  box-shadow: 0 1px 4px rgba(21, 24, 27, 0.12), inset 0 0 0 1px var(--color-border);
}
.seg-btn:disabled { opacity: 0.45; cursor: not-allowed; }
@media (pointer: coarse) {
  .seg-btn { min-height: var(--target-size); }
}
</style>