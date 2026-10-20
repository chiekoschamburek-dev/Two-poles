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
      body = await readJson(req, 2_000_000)
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
      server.middlewares.use('/api/llm/status', statusHandler)
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api/llm/chat', handler)
      server.middlewares.use('/api/llm/status', statusHandler)
    }
  }
}

/**
 * 食物照片识别代理：密钥与模型名只在服务端环境变量里。
 * 浏览器只提交这一张照片的 data URL；服务端不保存图片，也不写请求日志。
 * 未配置时返回明确的 503，前端据此回落到本机识别或手动补录。
 */
function foodVisionProxy(vision: DefaultLlm): Plugin {
  const hasVision = (): boolean => !!vision.baseUrl && !!vision.model
  const rate = new Map<string, number[]>()
  const WINDOW_MS = 60_000
  const LIMIT = 12

  const statusHandler = (_req: IncomingMessage, res: ServerResponse) => {
    res.statusCode = 200
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    res.end(JSON.stringify({ available: hasVision(), model: hasVision() ? vision.model : null }))
  }

  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    const send = (code: number, body: unknown) => {
      res.statusCode = code
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.setHeader('Cache-Control', 'no-store')
      res.end(JSON.stringify(body))
    }
    if (req.method !== 'POST') return send(405, { error: '只接受 POST' })

    const ip = req.socket.remoteAddress || 'unknown'
    const now = Date.now()
    const recent = (rate.get(ip) ?? []).filter(t => now - t < WINDOW_MS)
    if (recent.length >= LIMIT) return send(429, { error: '识别请求过于频繁，请稍后再试。' })
    recent.push(now)
    rate.set(ip, recent)

    let body: Record<string, unknown>
    try {
      body = await readJson(req, 9_000_000)
    } catch (e) {
      return send(400, { error: e instanceof Error ? e.message : '请求体解析失败' })
    }

    const image = typeof body.image === 'string' ? body.image : ''
    if (!/^data:image\/(jpeg|png|webp);base64,/i.test(image)) {
      return send(400, { error: '图片格式应为 JPEG / PNG / WebP 的 data URL。' })
    }
    if (image.length > 8_000_000) return send(413, { error: '图片过大，请压缩后再试。' })
    if (!hasVision()) {
      return send(503, {
        error: '云端食物识别未配置。请在服务端设置 FOOD_VISION_BASE_URL / FOOD_VISION_API_KEY / FOOD_VISION_MODEL；当前可改用本机识别或手动补录。'
      })
    }

    const system = [
      '你是食物照片识别助手。只输出一个 JSON 对象，不要 Markdown 代码块，不要任何解释文字。',
      'JSON 结构：{"items":[{"foodName":"苹果","category":"水果类","portionSize":1,"portionUnit":"个","confidence":0.86,"uncertain":false,"energy":{"low":45,"high":70,"note":"按一个中等大小苹果粗估"}}]}',
      '要求：',
      '1. 只列照片里可见的食物，不编造没出现的食物；照片里没有食物就返回 {"items":[]}。',
      `2. 每项必须给出 foodName、category、confidence（0–1）与 uncertain。category 只能是：${['谷薯类', '蔬菜类', '水果类', '蛋类', '奶类', '肉类', '豆类', '坚果类', '油脂类', '其他'].join('、')}。`,
      `3. 份量只在能合理判断时给出；portionUnit 只能是：${['碗', '盘', '份', '个', '杯', '片', '克', '把'].join('、')}。看不清就省略这两个字段。`,
      '4. energy 是可选的粗略热量区间（kcal），不确定就省略；不要为看不清的食物编造营养数值。',
      '5. 餐次由客户端按拍摄时间判断，你不要推测早餐/午餐/晚餐。',
      '6. 不给医疗、治疗、减重或竞技营养建议，不评价吃得多不多。'
    ].join('\n')

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 90_000)
    try {
      const upstream = await fetch(`${vision.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(vision.apiKey ? { Authorization: `Bearer ${vision.apiKey}` } : {})
        },
        body: JSON.stringify({
          model: vision.model,
          messages: [
            { role: 'system', content: system },
            {
              role: 'user',
              content: [
                { type: 'text', text: '识别这张照片里的食物，只输出 JSON。' },
                { type: 'image_url', image_url: { url: image } }
              ]
            }
          ],
          temperature: 0.1,
          max_tokens: 1200,
          stream: false
        }),
        signal: controller.signal
      })
      const text = await upstream.text()
      if (!upstream.ok) {
        let detail = text.slice(0, 400)
        try {
          const parsed = JSON.parse(text)
          detail = parsed?.error?.message || parsed?.message || detail
        } catch {
          /* 上游返回的不是 JSON，给原文 */
        }
        return send(upstream.status, { error: `视觉模型 ${upstream.status}：${detail}` })
      }
      let data: { choices?: { message?: { content?: string } }[]; model?: string }
      try {
        data = JSON.parse(text)
      } catch {
        return send(502, { error: '视觉模型返回的不是 JSON。' })
      }
      const content = data?.choices?.[0]?.message?.content
      if (typeof content !== 'string' || !content.trim()) return send(502, { error: '视觉模型没有返回内容。' })
      return send(200, { text: content, model: data?.model ?? vision.model })
    } catch (e) {
      const msg = e instanceof Error ? (e.name === 'AbortError' ? '请求超时（90 秒）' : e.message) : String(e)
      return send(502, { error: `识别转发失败：${msg}` })
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    name: 'twopoles-food-vision-proxy',
    configureServer(server) {
      server.middlewares.use('/api/food/recognize', handler)
      server.middlewares.use('/api/food/status', statusHandler)
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api/food/recognize', handler)
      server.middlewares.use('/api/food/status', statusHandler)
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
  const vision = {
    baseUrl: pick('FOOD_VISION_BASE_URL').trim().replace(/\/+$/, ''),
    apiKey: pick('FOOD_VISION_API_KEY'),
    model: pick('FOOD_VISION_MODEL').trim()
  }
  return {
  plugins: [vue(), llmProxy(defaults), foodVisionProxy(vision)],
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
