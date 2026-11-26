<template>
  <svg
    class="pole-mark"
    :width="size"
    :height="size"
    viewBox="0 0 64 64"
    aria-hidden="true"
    focusable="false"
  >
    <circle class="ring" cx="32" cy="32" r="21.5" />
    <path v-if="pole !== 'nutrition'" class="arc movement" d="M16.3 16.3A22.2 22.2 0 0 1 47.7 16.3" />
    <path v-if="pole !== 'movement'" class="arc nutrition" d="M47.7 47.7A22.2 22.2 0 0 1 16.3 47.7" />
    <circle v-if="pole !== 'nutrition'" class="dot movement" cx="10.5" cy="32" r="3.1" />
    <circle v-if="pole !== 'movement'" class="dot nutrition" cx="53.5" cy="32" r="3.1" />
  </svg>
</template>

<script setup lang="ts">
/**
 * 两仪标记：上半弧 = 运动（左极），下半弧 = 饮食（右极），
 * both 时两弧合成一个完整的圆——桥接区与双极预览都用它。
 */
withDefaults(
  defineProps<{
    pole?: 'movement' | 'nutrition' | 'both'
    size?: number
  }>(),
  { pole: 'both', size: 28 }
)
</script>

<style scoped>
.pole-mark {
  display: block;
  flex: none;
  overflow: visible;
}
.ring {
  fill: none;
  stroke: var(--color-border);
  stroke-width: 4.6;
}
.arc {
  fill: none;
  stroke-width: 5.2;
  stroke-linecap: round;
}
.dot {
  stroke: none;
}
.arc.movement,
.dot.movement {
  stroke: var(--pole-movement);
}
.arc.nutrition,
.dot.nutrition {
  stroke: var(--pole-nutrition);
}
.arc.movement,
.arc.nutrition {
  fill: none;
}
.dot.movement,
.dot.nutrition {
  fill: currentColor;
}
.dot.movement { color: var(--pole-movement); }
.dot.nutrition { color: var(--pole-nutrition); }
</style>
