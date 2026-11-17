<template>
  <Teleport to="body">
    <div v-if="open" class="scrim" @click.self="close">
      <div class="dlg" role="dialog" aria-modal="true" aria-labelledby="install-title">
        <header class="dlg-head">
          <div>
            <span class="micro">INSTALL · 安装到设备</span>
            <h2 id="install-title">安装 App</h2>
          </div>
          <button class="x" type="button" aria-label="关闭" @click="close">✕</button>
        </header>

        <div class="dlg-body">
          <div v-if="isNative" class="native-note">
            <Smartphone :size="20" />
            <p>你已经在两仪 App 里运行，不需要再装一次。</p>
          </div>

          <template v-else>
            <p class="intro">
              装到手机上后，系统后台提醒和摄像头跟练更稳。网页版本地数据不会自动搬到 App；登录同一账号后才会补传。
            </p>

            <!-- 安卓：APK 直链由浏览器直接下载，安装确认由系统弹出 -->
            <section v-if="platform === 'android'" class="plat">
              <div class="plat-head"><Smartphone :size="16" /> 安卓</div>
              <p>
                点下面的按钮，浏览器会把安装包<strong>直接下载</strong>到下载目录（约 5 MB），不会弹网页弹窗；
                下载完打开它，按提示允许"安装未知来源"即可。安装确认框是手机系统弹的，网页控制不了样式。
              </p>
              <a class="dl-btn" href="/apk/twopoles-debug.apk" download="twopoles-debug.apk">
                <Download :size="16" /> 下载 APK 安装包
              </a>
              <p class="fine">不想装包也可以：用浏览器把本站"添加到主屏幕"，功能一样，只是没有系统后台提醒。</p>
            </section>

            <!-- iOS：不能装 APK，只能添加到主屏幕 -->
            <section v-else-if="platform === 'ios'" class="plat">
              <div class="plat-head"><Smartphone :size="16" /> iPhone / iPad</div>
              <p>iOS 不能安装 APK。用 <strong>Safari</strong> 打开本站，点底部"分享"→"添加到主屏幕"，就会生成一个像 App 的图标，点开是全屏运行。</p>
              <ol class="steps">
                <li>在 Safari 里打开本站</li>
                <li>点底部中间的「分享」按钮</li>
                <li>选「添加到主屏幕」→「添加」</li>
              </ol>
              <p class="fine">数据仍在浏览器本地；装好后如需在别的设备接着用，登录同一账号即可同步。</p>
            </section>

            <!-- 桌面：提示可用浏览器安装 -->
            <section v-else class="plat">
              <div class="plat-head"><Monitor :size="16" /> 电脑</div>
              <p>电脑上可以用浏览器的"安装应用"把本站装成独立窗口。Chrome / Edge 在地址栏点安装图标，或在菜单里选「安装应用」。</p>
              <p class="fine">要用安卓 App，请在手机上打开本站后从这个弹窗下载安装包。</p>
            </section>

            <!-- 浏览器给了安装事件时，才出现这个系统安装弹窗入口 -->
            <section v-if="deferredPrompt" class="plat pwa">
              <div class="plat-head"><Download :size="16" /> 浏览器一键安装</div>
              <p>你的浏览器支持把本站安装成独立应用。点下面的按钮会弹出<strong>浏览器/系统的安装确认框</strong>——那是浏览器弹的，不是网页页面弹窗。</p>
              <div class="actions">
                <BaseButton size="sm" @click="installPwa">一键安装到设备</BaseButton>
              </div>
            </section>
          </template>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { Capacitor } from '@capacitor/core'
import { Download, Monitor, Smartphone } from 'lucide-vue-next'
import BaseButton from './BaseButton.vue'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const isNative = Capacitor.isNativePlatform()
const platform = computed<'android' | 'ios' | 'desktop'>(() => {
  const ua = navigator.userAgent
  if (/Android/i.test(ua)) return 'android'
  // iPadOS 13+ 伪装成桌面 UA，用触点数识别
  if (/iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios'
  return 'desktop'
})

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}
const deferredPrompt = ref<BeforeInstallPromptEvent | null>(null)

function captureInstallPrompt(e: Event) {
  e.preventDefault() // 拦下浏览器的默认安装提示，等用户点我们自己的按钮再触发
  deferredPrompt.value = e as BeforeInstallPromptEvent
}

async function installPwa() {
  if (!deferredPrompt.value) return
  await deferredPrompt.value.prompt()
  await deferredPrompt.value.userChoice
  deferredPrompt.value = null
  close()
}

function onKeydown(e: KeyboardEvent) {
  if (props.open && e.key === 'Escape') close()
}

function close() {
  emit('close')
}

onMounted(() => {
  window.addEventListener('beforeinstallprompt', captureInstallPrompt)
  window.addEventListener('keydown', onKeydown)
})
onUnmounted(() => {
  window.removeEventListener('beforeinstallprompt', captureInstallPrompt)
  window.removeEventListener('keydown', onKeydown)
})
</script>

<style scoped>
.micro { font-size: 10.5px; letter-spacing: var(--tracking-eyebrow); color: var(--color-accent); font-weight: 700; }
.scrim {
  position: fixed; inset: 0; z-index: var(--z-modal-backdrop); background: rgba(17, 22, 26, 0.46);
  backdrop-filter: blur(3px); display: grid; place-items: center; padding: 24px;
}
.dlg {
  width: min(480px, 100%); max-height: min(90vh, 760px); display: flex; flex-direction: column;
  background: var(--color-card); border-radius: var(--radius-xl); border: 1px solid var(--color-border);
  box-shadow: 0 30px 80px -40px rgba(11, 16, 20, 0.65); overflow: hidden;
}
.dlg-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 20px 22px 14px; border-bottom: 1px solid var(--color-divider); }
.dlg-head h2 { font-size: 19px; margin: 6px 0 0; letter-spacing: -0.01em; }
.x { width: 32px; height: 32px; border-radius: 9px; color: var(--color-text-muted); font-size: 14px; flex: none; }
.x:hover { background: var(--color-neutral-soft); color: var(--color-ink); }
.dlg-body { padding: 18px 22px 22px; overflow-y: auto; }
.intro { font-size: 13px; color: var(--color-text-secondary); line-height: 1.7; margin: 0 0 16px; }
.native-note { display: flex; align-items: center; gap: 10px; padding: 14px; border-radius: var(--radius-sm); background: var(--color-neutral-soft); color: var(--color-accent); }
.native-note p { margin: 0; font-size: 13px; color: var(--color-text-secondary); }
.plat { padding: 14px 0; border-top: 1px solid var(--color-divider); }
.plat-head { display: flex; align-items: center; gap: 7px; font-size: 13px; font-weight: 700; color: var(--color-ink); margin-bottom: 8px; }
.plat p { font-size: 12.5px; line-height: 1.75; color: var(--color-text-secondary); margin: 0 0 10px; }
.plat p strong { color: var(--color-ink); }
.plat .fine { font-size: 11px; color: var(--color-text-muted); margin: 10px 0 0; }
.steps { margin: 0 0 10px; padding-left: 20px; font-size: 12px; color: var(--color-text-secondary); line-height: 1.9; }
.dl-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  min-height: 42px; padding: 0 18px; border-radius: 12px;
  background: var(--color-accent); color: var(--color-on-accent);
  font-size: 13px; font-weight: 600; text-decoration: none;
}
.dl-btn:hover { filter: brightness(1.06); }
.actions { display: flex; gap: 10px; flex-wrap: wrap; }
.actions :deep(button) { width: auto; padding: 0 20px; }
.pwa { background: var(--color-neutral-soft); border-radius: var(--radius-sm); padding: 14px; border-top: 0; }
@media(max-width:767px){.actions :deep(button){width:100%}}
</style>
