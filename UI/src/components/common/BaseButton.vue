<template><button class="base-button" :class="[variant, size]" :disabled="disabled" @click="$emit('click', $event)"><component v-if="icon" :is="icon" :size="size==='sm'?15:17"/><span><slot/></span></button></template>
<script setup lang="ts">import type { Component } from 'vue'; withDefaults(defineProps<{variant?:'primary'|'secondary'|'ghost'|'danger';size?:'sm'|'md'|'lg';disabled?:boolean;icon?:Component}>(),{variant:'primary',size:'md',disabled:false}); defineEmits<{(e:'click',event:MouseEvent):void}>()
</script>
<style scoped>.base-button{position:relative;overflow:hidden;display:inline-flex;align-items:center;justify-content:center;gap:8px;border-radius:14px;font-weight:600;letter-spacing:.01em;transition:transform var(--motion-fast) var(--easing-ease-out),box-shadow var(--motion-fast),filter var(--motion-fast),border-color var(--motion-fast);min-height:44px;padding:0 18px;box-shadow:var(--inner-light)}
.base-button>span,.base-button>:first-child{position:relative;z-index:1}
.base-button:hover:not(:disabled){transform:translateY(-2px)}
.base-button:active:not(:disabled){transform:translateY(1px) scale(.99);filter:brightness(.94)}
.base-button:focus-visible{outline:none;box-shadow:var(--inner-light),0 0 0 3px rgba(8,126,128,.28)}
.primary{color:white;background:linear-gradient(135deg,#06706f 0%,#0a9b9d 100%);box-shadow:var(--inner-light),0 8px 20px -10px rgba(8,126,128,.6)}
.primary:hover:not(:disabled){box-shadow:var(--inner-light),0 14px 30px -12px rgba(8,126,128,.72)}
.primary::after{content:'';position:absolute;inset:0;background:linear-gradient(115deg,rgba(255,255,255,0) 32%,rgba(255,255,255,.36) 50%,rgba(255,255,255,0) 68%);transform:translateX(-100%);transition:transform var(--motion-slow) var(--easing-ease-out);pointer-events:none}
.primary:hover:not(:disabled)::after{transform:translateX(100%)}
.secondary{color:var(--color-teal);background:rgba(255,255,255,.86);border:1px solid #b6ded8;box-shadow:var(--inner-light),0 2px 8px -4px rgba(18,44,68,.16)}
.secondary:hover:not(:disabled){border-color:#7fc9bf;box-shadow:var(--inner-light),var(--ring-teal)}
.ghost{color:var(--color-teal);background:#eaf8f5;border:1px solid transparent}
.ghost:hover:not(:disabled){background:#dff5f0;border-color:#bfe6df}
.danger{color:white;background:var(--gradient-danger);box-shadow:var(--inner-light),0 8px 20px -10px rgba(201,75,75,.6)}
.danger:hover:not(:disabled){box-shadow:var(--inner-light),0 14px 30px -12px rgba(201,75,75,.7)}
.sm{min-height:36px;padding:0 13px;font-size:13px;border-radius:11px}.lg{min-height:50px;padding:0 24px;font-size:16px}</style>
