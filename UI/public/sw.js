// TwoPoles Service Worker，两件事：
// 1) 补剂提醒的通知展示与点击回跳（原有职责，保持不变）
// 2) 运行时缓存：让访问过的页面与静态资源离线可用——本应用纯本机模式（localStorage）即可工作，
//    断网时至少能打开看过的页面、跑动作分析（mediapipe wasm/模型都在 public/ 下）。
// 缓存策略：
//   - 页面导航：网络优先，失败回退缓存——在线时永远拿新版本，断网兜底旧版本
//   - 同源静态资源：缓存优先——构建产物文件名带哈希、public 资源基本不变，缓存命中即离线可用
//   - /api/*（LLM 代理与账号同步）与带 Range 的请求（视频拖动分段取流）一律不拦截
const VERSION = 'v1'
const RUNTIME_CACHE = `twopoles-runtime-${VERSION}`
/** 缓存条目上限：换版后旧哈希产物会累积，超过就按放入时间淘汰最旧的 */
const RUNTIME_CACHE_LIMIT = 200

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys()
    await Promise.all(
      names
        .filter(name => name.startsWith('twopoles-runtime-') && name !== RUNTIME_CACHE)
        .map(name => caches.delete(name))
    )
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/')) return
  // 视频拖动走 Range 分段请求，Cache API 兜不住完整响应，直接放行给浏览器 HTTP 缓存
  if (request.headers.has('range')) return

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request))
    return
  }
  event.respondWith(cacheFirst(request))
})

async function networkFirst(request) {
  try {
    const response = await fetch(request)
    if (response.ok) await putInCache(request, response.clone())
    return response
  } catch {
    const cached = await caches.match(request)
    if (cached) return cached
    // 深链离线兜底：没访问过的路径回退到已缓存的根页面（SPA 单页即全部）
    const shell = await caches.match('/')
    if (shell) return shell
    throw new Error('离线且页面未缓存')
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request)
  if (cached) return cached
  const response = await fetch(request)
  // 只缓存完整成功响应；失败/部分内容不入缓存，且不打断正常返回
  if (response.ok) await putInCache(request, response.clone())
  return response
}

async function putInCache(request, response) {
  const cache = await caches.open(RUNTIME_CACHE)
  await cache.put(request, response)
  const keys = await cache.keys()
  if (keys.length > RUNTIME_CACHE_LIMIT) {
    // keys 顺序即放入顺序：把最旧的一批淘汰出上限
    const stale = keys.slice(0, keys.length - RUNTIME_CACHE_LIMIT)
    await Promise.all(stale.map(entry => cache.delete(entry)))
  }
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = new URL('supplements', self.registration.scope).href
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of clients) {
      if ('focus' in client) {
        await client.focus()
        if ('navigate' in client) await client.navigate(target)
        return
      }
    }
    await self.clients.openWindow(target)
  })())
})
