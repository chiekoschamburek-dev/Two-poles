<template><article class="card" :class="{interactive, glass}"><slot/></article></template>
<script setup lang="ts">withDefaults(defineProps<{interactive?:boolean;glass?:boolean}>(),{interactive:false,glass:false})
</script>
<style scoped>.card{background:linear-gradient(178deg,#fff 0%,#fafcfd 100%);border:1px solid rgba(220,229,237,.85);border-radius:var(--radius-lg);padding:var(--space-6);box-shadow:var(--shadow-card),var(--inner-light);transition:transform var(--motion-base) var(--easing-ease-out),box-shadow var(--motion-base),border-color var(--motion-base)}
.card.interactive:hover{transform:translateY(-4px);box-shadow:var(--shadow-card-lg),var(--ring-teal);border-color:transparent}
.card.glass{background:rgba(255,255,255,.7);backdrop-filter:blur(14px) saturate(1.4);-webkit-backdrop-filter:blur(14px) saturate(1.4)}</style>
