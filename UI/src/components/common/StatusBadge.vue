<template><span class="badge animate-bounce-in" :class="variant"><span class="dot"></span><slot/></span></template>
<script setup lang="ts">withDefaults(defineProps<{variant?:'success'|'warning'|'danger'|'info'|'neutral'}>(),{variant:'neutral'})
</script>
<style scoped>/* 语义色只描述状态；圆点形状做非颜色冗余：实心=已达成/需注意/错误，空心=进行中或未开始 */
.badge{display:inline-flex;align-items:center;gap:6px;padding:5px 10px;border-radius:999px;font-size:12px;font-weight:600;white-space:nowrap;box-shadow:inset 0 0 0 1px rgba(21,24,27,.06)}
.dot{width:6px;height:6px;border-radius:50%;background:currentColor;flex:none}
.success{color:var(--color-success);background:var(--color-success-soft)}
.warning{color:var(--color-caution);background:var(--color-caution-soft)}
.danger{color:var(--color-danger);background:var(--color-danger-soft)}
.neutral{color:var(--color-neutral);background:var(--color-neutral-soft)}
.info{color:var(--color-accent);background:var(--color-card);box-shadow:inset 0 0 0 1px var(--color-accent-line)}
.info .dot{background:transparent;box-shadow:inset 0 0 0 1.5px currentColor}</style>
