<template><button class="base-button" :class="[variant, size]" :disabled="disabled" @click="$emit('click', $event)"><component v-if="icon" :is="icon" :size="size==='sm'?15:17"/><span><slot/></span></button></template>
<script setup lang="ts">import type { Component } from 'vue'; withDefaults(defineProps<{variant?:'primary'|'secondary'|'ghost'|'danger';size?:'sm'|'md'|'lg';disabled?:boolean;icon?:Component}>(),{variant:'primary',size:'md',disabled:false}); defineEmits<{(e:'click',event:MouseEvent):void}>()
</script>
<style scoped>.base-button{position:relative;overflow:hidden;display:inline-flex;align-items:center;justify-content:center;gap:8px;white-space:nowrap;border-radius:var(--radius-md);font-weight:600;letter-spacing:.01em;transition:background var(--motion-fast),border-color var(--motion-fast),box-shadow var(--motion-fast);min-height:44px;padding:0 18px}
.base-button>span,.base-button>:first-child{position:relative;z-index:1}
.base-button:active:not(:disabled){transform:translateY(1px)}
.base-button:focus-visible{outline:none;box-shadow:0 0 0 3px rgba(15,118,110,.32)}
/* 主操作走深墨：全站的青色只留给"记录 / 进度 / 已达成"，按钮不再抢语义 */
.primary{color:var(--color-card);background:var(--color-ink)}
.primary:hover:not(:disabled){background:#000}
.secondary{color:var(--color-ink);background:var(--color-card);border:1px solid var(--hair-strong)}
.secondary:hover:not(:disabled){border-color:var(--color-ink)}
.ghost{color:var(--color-text-secondary);background:var(--color-neutral-soft);border:1px solid transparent}
.ghost:hover:not(:disabled){background:var(--color-border);color:var(--color-ink)}
.danger{color:var(--color-on-danger);background:var(--color-danger)}
.danger:hover:not(:disabled){background:var(--color-danger-strong)}
.danger:focus-visible{box-shadow:0 0 0 3px rgba(165,38,26,.3)}
.sm{min-height:36px;padding:0 13px;font-size:13px;border-radius:var(--radius-base)}.lg{min-height:50px;padding:0 24px;font-size:16px}</style>
