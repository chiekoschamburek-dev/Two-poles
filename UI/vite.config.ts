import { defineConfig, loadEnv, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
import type { IncomingMessage, ServerResponse } from 'node:http'

/**
 * 本地模型代理：浏览器直连第三方 OpenAI 兼容接口基本都会被 CORS 拦掉，
 * 所以前端统一请求同源的 /api/llm/chat，由这里转发。
 * 密钥只在这一次请求里经过本机进程，不落盘、不写日志。
 */
/**
 * 服务端默认模型（保底）：从环境变量读，绝不进前端包。
 * 客户端没有自己的配置时，代理自动回退到它；客户端也可以通过 /api/llm/status 知道它有没有配。
 */
interface DefaultLlm {
  baseUrl: string
  apiKey: string
  model: string
}

const readJson = (req: IncomingMessage, limit: number): Promise<Record<string, unknown>> =>
  new Promise((resolve, reject) => {
    let raw = ''
    let tooLarge = false
    req.on('data', (chunk) => {
      raw += chunk
      if (raw.length > limit && !tooLarge) {
        tooLarge = true
        reject(new Error('请求体过大'))
      }
    })
    req.on('end', () => {
      if (tooLarge) return
      try {
        resolve(raw ? JSON.parse(raw) : {})
      } catch {
        reject(new Error('请求体不是合法 JSON'))
      }
    })
    req.on('error', reject)
  })

function llmProxy(defaults: DefaultLlm): Plugin {

  const hasDefault = (): boolean => !!defaults.baseUrl && !!defaults.model

  /** 不带头部的状态查询：只告诉前端"有没有默认模型、叫什么"，不泄露任何密钥 */
  const statusHandler = (_req: IncomingMessage, res: ServerResponse) => {
    res.statusCode = 200
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    res.end(JSON.stringify({ available: hasDefault(), model: hasDefault() ? defaults.model : null }))
  }

  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    const send = (code: number, body: unknown) => {
      res.statusCode = code
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify(body))
    }
    if (req.method !== 'POST') return send(405, { error: '只接受 POST' })

    let body: Record<string, unknown>
    try {
      // 食物照片以 data URL 走同一条模型调用；1024px JPEG 需要比纯文本更宽的上限
      body = await readJson(req, 6_000_000)
    } catch (e) {
      return send(400, { error: e instanceof Error ? e.message : '请求体解析失败' })
    }

    // 客户端没配置（或显式要求用默认）时回退到服务端默认模型
    const wantDefault = body.useDefault === true || !body.baseUrl || !body.model
    const custom = {
      baseUrl: typeof body.baseUrl === 'string' ? body.baseUrl.trim().replace(/\/+$/, '') : '',
      apiKey: typeof body.apiKey === 'string' ? body.apiKey : '',
      model: typeof body.model === 'string' ? body.model : ''
    }
    const chosen = wantDefault ? defaults : custom
    const baseUrl = chosen.baseUrl
    const apiKey = chosen.apiKey
    const model = chosen.model
    const messages = Array.isArray(body.messages) ? body.messages : []
    if (!baseUrl || !model) {
      return send(503, { error: wantDefault ? '服务端没有配置默认模型（LLM_DEFAULT_*），也没有填自己的接口。' : '缺少 base_url 或模型名' })
    }
    if (!/^https?:\/\//i.test(baseUrl)) return send(400, { error: 'base_url 必须以 http:// 或 https:// 开头' })
    if (!messages.length) return send(400, { error: '缺少 messages' })

    const controller = new AbortController()
    // 识图客户端最多等 2 分钟；代理多留 30 秒，避免代理先于客户端截断
    const timer = setTimeout(() => controller.abort(), 150_000)
    // 前端取消/关闭时中止上游请求，避免模型继续算一张没人要的照片
    res.on('close', () => {
      if (!res.writableEnded) controller.abort()
    })
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
      const msg = e instanceof Error ? (e.name === 'AbortError' ? '请求超时（150 秒）' : e.message) : String(e)
      return send(502, { error: `转发失败：${msg}` })
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    name: 'twopoles-llm-proxy',
    configureServer(server) {
      server.middlewares.use('/api/llm/chat', handler)
      server.middlewares.use('/api/llm/status', statusHandler)
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api/llm/chat', handler)
      server.middlewares.use('/api/llm/status', statusHandler)
    }
  }
}

export default defineConfig(({ mode }) => {
  // 优先读真实环境变量（部署时用），其次读 .env.local（本机开发用）
  const fileEnv = loadEnv(mode, process.cwd(), '')
  const pick = (key: string): string => process.env[key] ?? fileEnv[key] ?? ''
  const defaults = {
    baseUrl: pick('LLM_DEFAULT_BASE_URL').trim().replace(/\/+$/, ''),
    apiKey: pick('LLM_DEFAULT_API_KEY'),
    model: pick('LLM_DEFAULT_MODEL').trim()
  }
  return {
  plugins: [vue(), llmProxy(defaults)],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  server: {
    port: 5173,
    host: true
  }
  }
})
