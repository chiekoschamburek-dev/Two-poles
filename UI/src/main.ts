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
}
void mount()
