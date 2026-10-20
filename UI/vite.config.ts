import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
import type { IncomingMessage, ServerResponse } from 'node:http'

/**
 * 本地模型代理：浏览器直连第三方 OpenAI 兼容接口基本都会被 CORS 拦掉，
 * 所以前端统一请求同源的 /api/llm/chat，由这里转发。
 * 密钥只在这一次请求里经过本机进程，不落盘、不写日志。
 */
function llmProxy(): Plugin {
  const readJson = (req: IncomingMessage): Promise<Record<string, unknown>> =>
    new Promise((resolve, reject) => {
      let raw = ''
      req.on('data', (chunk) => {
        raw += chunk
        if (raw.length > 2_000_000) reject(new Error('请求体过大'))
      })
      req.on('end', () => {
        try {
          resolve(raw ? JSON.parse(raw) : {})
        } catch {
          reject(new Error('请求体不是合法 JSON'))
        }
      })
      req.on('error', reject)
    })

  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    const send = (code: number, body: unknown) => {
      res.statusCode = code
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify(body))
    }
    if (req.method !== 'POST') return send(405, { error: '只接受 POST' })

    let body: Record<string, unknown>
    try {
      body = await readJson(req)
    } catch (e) {
      return send(400, { error: e instanceof Error ? e.message : '请求体解析失败' })
    }

    const baseUrl = typeof body.baseUrl === 'string' ? body.baseUrl.trim().replace(/\/+$/, '') : ''
    const apiKey = typeof body.apiKey === 'string' ? body.apiKey : ''
    const model = typeof body.model === 'string' ? body.model : ''
    const messages = Array.isArray(body.messages) ? body.messages : []
    if (!baseUrl || !model) return send(400, { error: '缺少 base_url 或模型名' })
    if (!/^https?:\/\//i.test(baseUrl)) return send(400, { error: 'base_url 必须以 http:// 或 https:// 开头' })
    if (!messages.length) return send(400, { error: '缺少 messages' })

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 90_000)
    try {
      const upstream = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
        },
        body: JSON.stringify({ model, messages, temperature: body.temperature ?? 0.4, stream: false }),
        signal: controller.signal
      })
      const text = await upstream.text()
      if (!upstream.ok) {
        // 把上游的错误原文带回前端，方便判断是 key 错了还是模型名不对
        let detail = text.slice(0, 400)
        try {
          const parsed = JSON.parse(text)
          detail = parsed?.error?.message || parsed?.message || detail
        } catch {
          /* 上游返回的不是 JSON，就直接给原文 */
        }
        return send(upstream.status, { error: `上游 ${upstream.status}：${detail}` })
      }
      let data: { choices?: { message?: { content?: string } }[]; model?: string }
      try {
        data = JSON.parse(text)
      } catch {
        return send(502, { error: '上游返回的不是 JSON' })
      }
      const content = data?.choices?.[0]?.message?.content
      if (typeof content !== 'string' || !content.trim()) return send(502, { error: '上游没有返回 content' })
      return send(200, { text: content, model: data?.model ?? model })
    } catch (e) {
      const msg = e instanceof Error ? (e.name === 'AbortError' ? '请求超时（90 秒）' : e.message) : String(e)
      return send(502, { error: `转发失败：${msg}` })
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    name: 'twopoles-llm-proxy',
    configureServer(server) {
      server.middlewares.use('/api/llm/chat', handler)
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api/llm/chat', handler)
    }
  }
}

export default defineConfig({
  plugins: [vue(), llmProxy()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  server: {
    port: 5173,
    host: true
  }
})
