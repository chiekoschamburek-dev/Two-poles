<template><article class="card" :class="{interactive, glass}"><slot/></article></template>
<script setup lang="ts">withDefaults(defineProps<{interactive?:boolean;glass?:boolean}>(),{interactive:false,glass:false})
</script>
<style scoped>.card{background:var(--color-card);border:1px solid var(--color-border);border-radius:var(--radius-lg);padding:var(--space-6);box-shadow:var(--shadow-sm);transition:transform var(--motion-base) var(--easing-ease-out),box-shadow var(--motion-base),border-color var(--motion-base)}.card.interactive:hover{transform:translateY(-4px);box-shadow:var(--shadow-lg);border-color:#9bd6d0}.card.glass{background:var(--color-card-glass);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)}</style>
