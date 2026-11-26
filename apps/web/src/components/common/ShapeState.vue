<template>
  <i
    class="shape"
    :class="state"
    :style="{ width: width + 'px', height: height + 'px' }"
    role="img"
    :aria-label="aria"
    :title="aria"
  ></i>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    /** 形状即语义：实心=记录完整，半填=部分记录，空心=未记录 */
    state: 'complete' | 'partial' | 'none'
    width?: number
    height?: number
    /** 读屏用的文字；不给就按状态生成 */
    label?: string
  }>(),
  { width: 26, height: 7, label: '' }
)

const TEXT = { complete: '记录完整', partial: '部分记录', none: '未记录' } as const
const aria = computed(() => props.label || TEXT[props.state])
</script>

<style scoped>
/* 形状本身承载状态，颜色只是冗余；色觉障碍下同样可读 —— 调研的硬要求 */
.shape {
  display: block;
  flex: none;
  border-radius: 2px;
  box-shadow: inset 0 0 0 1.2px var(--hair-strong);
}

.shape.complete {
  background: var(--color-accent);
  box-shadow: none;
}

.shape.partial {
  background: linear-gradient(90deg, var(--color-caution) 0 54%, transparent 54%);
  box-shadow: inset 0 0 0 1.2px var(--color-caution);
}

.shape.none {
  background: transparent;
}
</style>
