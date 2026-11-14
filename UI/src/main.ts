import { createApp } from 'vue'
import { createPinia } from 'pinia'
import router from './router'
import App from './App.vue'

import './styles/tokens.css'
import './styles/globals.css'
import './styles/animations.css'
import './styles/gradients.css'

const app = createApp(App)
const pinia = createPinia()

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
