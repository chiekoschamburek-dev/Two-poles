import { createApp } from 'vue'
import { createPinia } from 'pinia'
import router from './router'
import App from './App.vue'
import { useAppStore } from './stores/app'

import './styles/tokens.css'
import './styles/globals.css'
import './styles/animations.css'
import './styles/gradients.css'

const app = createApp(App)
const pinia = createPinia()
const pageRetryParam = '__page_retry'
const routeLoadFailures = new WeakSet<Error>()

window.addEventListener('vite:preloadError', (event) => {
  const cause = (event as Event & { payload: unknown }).payload
  if (cause instanceof Error) routeLoadFailures.add(cause)
})

router.onError((error, to) => {
  console.error(error)
  if (!(error instanceof Error) || !routeLoadFailures.delete(error)) return

  const destination = new URL(router.resolve(to.fullPath).href, window.location.href)
  if (navigator.onLine && !destination.searchParams.has(pageRetryParam)) {
    // 从目标地址重新获取当前部署的入口页面，避免旧会话重复请求已下线的页面代码。
    destination.searchParams.set(pageRetryParam, String(Date.now()))
    window.location.assign(destination.href)
    return
  }

  useAppStore(pinia).showToast({
    type: 'error',
    title: '页面暂时无法加载',
    message: navigator.onLine ? '请刷新页面后重试。' : '请联网后重试。'
  })
})

router.afterEach((to, _from, failure) => {
  if (failure || !(pageRetryParam in to.query)) return
  const query = { ...to.query }
  delete query[pageRetryParam]
  void router.replace({ path: to.path, query, hash: to.hash })
})

app.use(pinia)
app.use(router)

async function mount() {
  if (import.meta.env.DEV && import.meta.env.VITE_API_MOCK === 'true') {
    const { worker } = await import('./mocks/browser')
    await worker.start({ onUnhandledRequest: 'bypass' })
  }
  app.mount('#app')
  // PWA：生产环境注册 Service Worker（离线缓存 + 补剂提醒通知）；dev 不注册，避免缓存干扰 Vite
  if (import.meta.env.PROD && 'serviceWorker' in navigator && window.isSecureContext) {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`)
  }
}
void mount()
