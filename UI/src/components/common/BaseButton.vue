<template><button class="base-button" :class="[variant, size]" :disabled="disabled" @click="$emit('click', $event)"><component v-if="icon" :is="icon" :size="size==='sm'?15:17"/><span><slot/></span></button></template>
<script setup lang="ts">import type { Component } from 'vue'; withDefaults(defineProps<{variant?:'primary'|'secondary'|'ghost'|'danger';size?:'sm'|'md'|'lg';disabled?:boolean;icon?:Component}>(),{variant:'primary',size:'md',disabled:false}); defineEmits<{(e:'click',event:MouseEvent):void}>()
</script>
<style scoped>.base-button{position:relative;overflow:hidden;display:inline-flex;align-items:center;justify-content:center;gap:8px;border-radius:12px;font-weight:600;letter-spacing:.01em;transition:transform var(--motion-fast) var(--easing-ease-out),box-shadow var(--motion-fast),background var(--motion-fast),border-color var(--motion-fast);min-height:44px;padding:0 18px}
.base-button>span,.base-button>:first-child{position:relative;z-index:1}
.base-button:hover:not(:disabled){transform:translateY(-1px)}
.base-button:active:not(:disabled){transform:translateY(0);filter:brightness(.96)}
.base-button:focus-visible{outline:none;box-shadow:0 0 0 3px rgba(15,118,110,.32)}
.primary{color:var(--color-on-accent);background:var(--color-accent);box-shadow:0 1px 2px rgba(15,118,110,.3)}
.primary:hover:not(:disabled){background:var(--color-accent-strong);box-shadow:0 6px 16px -6px rgba(15,118,110,.55)}
.primary::after{content:'';position:absolute;inset:0;background:linear-gradient(115deg,rgba(255,255,255,0) 32%,rgba(255,255,255,.3) 50%,rgba(255,255,255,0) 68%);transform:translateX(-100%);transition:transform var(--motion-slow) var(--easing-ease-out);pointer-events:none}
.primary:hover:not(:disabled)::after{transform:translateX(100%)}
.secondary{color:var(--color-accent);background:var(--color-card);border:1px solid var(--color-accent-line)}
.secondary:hover:not(:disabled){border-color:var(--color-accent);background:var(--color-accent-soft)}
.ghost{color:var(--color-accent);background:var(--color-accent-soft);border:1px solid transparent}
.ghost:hover:not(:disabled){background:var(--color-accent-line)}
.danger{color:var(--color-on-accent);background:var(--color-danger)}
.danger:hover:not(:disabled){background:var(--color-danger-strong)}
.danger:focus-visible{box-shadow:0 0 0 3px rgba(180,35,24,.3)}
.sm{min-height:36px;padding:0 13px;font-size:13px;border-radius:10px}.lg{min-height:50px;padding:0 24px;font-size:16px}</style>
