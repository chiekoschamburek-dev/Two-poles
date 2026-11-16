<template>
  <footer class="site-footer" aria-label="站点备案信息">
    <span class="copy">© {{ year }} {{ SITE_INFO.name }}</span>
    <template v-if="SITE_INFO.icp.number">
      <span class="sep" aria-hidden="true">·</span>
      <a
        class="beian"
        :href="SITE_INFO.icp.href"
        target="_blank"
        rel="noopener noreferrer"
      >{{ SITE_INFO.icp.number }}</a>
    </template>
    <template v-if="SITE_INFO.police.number">
      <span class="sep" aria-hidden="true">·</span>
      <a
        class="beian"
        :href="SITE_INFO.police.href"
        target="_blank"
        rel="noopener noreferrer"
      >{{ SITE_INFO.police.number }}</a>
    </template>
  </footer>
</template>

<script setup lang="ts">
import { SITE_INFO } from '@/config/site'

/** 年份跟着系统时间走，不用每年回来改代码 */
const year = new Date().getFullYear()
</script>

<style scoped>
/* 页脚在 main 之外，自己让出导航脊的宽度；主区的底部留白相应收窄（见 AppShell） */
.site-footer {
  box-sizing: border-box;
  min-height: var(--site-footer-height);
  margin-left: var(--sidebar-width);
  padding: var(--space-2) var(--gutter) var(--space-3) var(--space-7);
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 0 var(--space-2);
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  line-height: 1.6;
  letter-spacing: 0.02em;
  text-align: center;
}
.site-footer .sep {
  opacity: 0.45;
}
.site-footer .beian {
  color: inherit;
  text-decoration: none;
  border-bottom: 1px solid transparent;
  transition: color var(--motion-fast) var(--easing-ease-out),
    border-color var(--motion-fast) var(--easing-ease-out);
}
.site-footer .beian:hover,
.site-footer .beian:focus-visible {
  color: var(--color-accent);
  border-bottom-color: var(--color-accent-line);
  outline: none;
}
@media (max-width: 1099px) {
  .site-footer {
    margin-left: 0;
    padding-left: var(--space-6);
    padding-right: var(--space-6);
  }
}
@media (max-width: 767px) {
  /* 底栏是浮起来的胶囊，页脚要整段让位，否则备案号会被压在胶囊下面 */
  .site-footer {
    min-height: var(--site-footer-height-mobile);
    padding: var(--space-2) var(--space-4)
      calc(var(--mobile-nav-height) + var(--safe-bottom) + var(--space-3));
  }
}
</style>
