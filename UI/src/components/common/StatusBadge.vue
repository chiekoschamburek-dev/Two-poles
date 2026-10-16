<template><span class="badge animate-bounce-in" :class="variant"><span class="dot"></span><slot/></span></template>
<script setup lang="ts">withDefaults(defineProps<{variant?:'success'|'warning'|'danger'|'info'|'neutral'}>(),{variant:'neutral'})
</script>
<style scoped>.badge{display:inline-flex;align-items:center;gap:6px;padding:5px 10px;border-radius:999px;font-size:12px;font-weight:600;white-space:nowrap;box-shadow:inset 0 0 0 1px rgba(18,44,68,.06)}.dot{width:6px;height:6px;border-radius:50%;background:currentColor;box-shadow:0 0 8px -1px currentColor}.success{color:#398453;background:#e6f5ea}.warning{color:#9a6a12;background:#fff5db}.danger{color:#a53d3d;background:#fde8e8}.info{color:#266991;background:#e5f1fb}.neutral{color:#627585;background:#eef2f5}</style>
