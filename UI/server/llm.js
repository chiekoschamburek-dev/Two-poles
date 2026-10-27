// 阿里云 ESA「函数和 Pages」的边缘函数入口。
// 控制台/esa.jsonc 的 entry 指向本文件，运行时签名：
//   export default { async fetch(request, context, env) { ... } }
// 默认模型变量从函数变量 env 读取（不是 Pages 的构建环境变量）：
//   LLM_DEFAULT_BASE_URL / LLM_DEFAULT_API_KEY / LLM_DEFAULT_MODEL
const MAX_BODY = 6_000_000
const TIMEOUT_MS = 110_000

function readEnv(env, key) {
  if (env && typeof env[key] === 'string' && env[key]) return env[key]
  if (typeof process !== 'undefined' && process.env && typeof process.env[key] === 'string') {
    return process.env[key]
  }
  return ''
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  })
}

function defaultConfig(env) {
  return {
    baseUrl: (readEnv(env, 'LLM_DEFAULT_BASE_URL') || readEnv(env, 'LLM_BASE_URL'))
      .trim()
      .replace(/\/+$/, ''),
    apiKey: readEnv(env, 'LLM_DEFAULT_API_KEY') || readEnv(env, 'LLM_API_KEY'),
    model: (readEnv(env, 'LLM_DEFAULT_MODEL') || readEnv(env, 'LLM_MODEL')).trim()
  }
}

function isPrivateHost(hostname) {
  const host = hostname.toLowerCase()
  if (host === 'localhost' || host === '0.0.0.0' || host === '[::1]' || host === '::1') return true
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) return true
  const m = /^172\.(\d{1,2})\./.exec(host)
  return !!m && Number(m[1]) >= 16 && Number(m[1]) <= 31
}

function spaFallback(request) {
  const url = new URL(request.url)
  const accept = request.headers.get('accept') || ''
  const isNavigation = request.method === 'GET' && accept.includes('text/html')
  if (!isNavigation) return new Response('Not Found', { status: 404 })
  if (url.pathname === '/index.html' && request.headers.get('x-esa-spa') === '1') {
    return new Response('Not Found', { status: 404 })
  }
  return fetch(new URL('/index.html', url.origin), {
    headers: { 'x-esa-spa': '1' }
  })
}

async function handleChat(request, env) {
  const declaredLength = Number(request.headers.get('content-length') || 0)
  if (declaredLength > MAX_BODY) {
    return json(413, { error: '请求体过大；照片识别请先压缩到 1024px 内' })
  }

  let raw
  try {
    raw = await request.text()
  } catch {
    return json(400, { error: '读取请求体失败' })
  }
  if (raw.length > MAX_BODY) {
    return json(413, { error: '请求体过大；照片识别请先压缩到 1024px 内' })
  }

  let body
  try {
    body = JSON.parse(raw || '{}')
  } catch {
    return json(400, { error: '请求体不是合法 JSON' })
  }

  const messages = Array.isArray(body.messages) ? body.messages : []
  if (!messages.length) return json(400, { error: '缺少 messages' })

  const defaults = defaultConfig(env)
  const wantDefault = body.useDefault === true || !body.baseUrl || !body.model
  let chosen

  if (wantDefault) {
    chosen = defaults
  } else {
    if (readEnv(env, 'ALLOW_CUSTOM_LLM_PROXY') !== 'true') {
      return json(403, {
        error: '生产环境未开启自定义模型代理；请在函数变量配置 LLM_DEFAULT_*，或在设置页切到内置模型。'
      })
    }
    chosen = {
      baseUrl: String(body.baseUrl || '').trim().replace(/\/+$/, ''),
      apiKey: String(body.apiKey || ''),
      model: String(body.model || '').trim()
    }
    if (!/^https:\/\//i.test(chosen.baseUrl)) {
      return json(400, { error: '自定义 base_url 必须使用 https' })
    }
    try {
      if (isPrivateHost(new URL(chosen.baseUrl).hostname)) {
        return json(400, { error: '自定义 base_url 不能指向本机或内网地址' })
      }
    } catch {
      return json(400, { error: '自定义 base_url 不是合法 URL' })
    }
  }

  if (!chosen.baseUrl || !chosen.model) {
    return json(503, {
      error: '没有可用的默认模型：请在 ESA 函数变量配置 LLM_DEFAULT_BASE_URL / LLM_DEFAULT_MODEL / LLM_DEFAULT_API_KEY'
    })
  }
  if (!/^https?:\/\//i.test(chosen.baseUrl)) {
    return json(400, { error: 'base_url 必须以 http:// 或 https:// 开头' })
  }

  const encoder = new TextEncoder()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  // 先发一个空格，避免 ESA 网关 10 秒内看不到任何数据就 504；
  // 前端 res.json() 允许 JSON 前有空白，模型结果随后写入同一个流。
  const stream = new ReadableStream({
    async start(ctrl) {
      ctrl.enqueue(encoder.encode(' '))
      try {
        const upstream = await fetch(`${chosen.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(chosen.apiKey ? { Authorization: `Bearer ${chosen.apiKey}` } : {})
          },
          body: JSON.stringify({
            model: chosen.model,
            messages,
            temperature: typeof body.temperature === 'number' ? body.temperature : 0.4,
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
          } catch { /* 上游不是 JSON */ }
          ctrl.enqueue(encoder.encode(JSON.stringify({ error: `上游 ${upstream.status}：${detail}` })))
          return
        }

        let data
        try {
          data = JSON.parse(text)
        } catch {
          ctrl.enqueue(encoder.encode(JSON.stringify({ error: '上游返回的不是 JSON' })))
          return
        }
        const content = data?.choices?.[0]?.message?.content
        if (typeof content !== 'string' || !content.trim()) {
          ctrl.enqueue(encoder.encode(JSON.stringify({ error: '上游没有返回 content' })))
          return
        }
        ctrl.enqueue(encoder.encode(JSON.stringify({ text: content, model: data?.model ?? chosen.model })))
      } catch (e) {
        const aborted = e instanceof Error && e.name === 'AbortError'
        const msg = e instanceof Error ? e.message : String(e)
        ctrl.enqueue(encoder.encode(JSON.stringify({
          error: aborted ? '模型请求超时' : `转发失败：${msg}`
        })))
      } finally {
        clearTimeout(timer)
        ctrl.close()
      }
    }
  })

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  })
}

export default {
  async fetch(request, context, env) {
    const effectiveEnv = env || (context && context.env) || (typeof process !== 'undefined' ? process.env : {}) || {}
    const url = new URL(request.url)
    const path = url.pathname.replace(/\/+$/, '') || '/'

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type'
        }
      })
    }

    if (path === '/api/llm/ping') {
      if (request.method !== 'GET') return json(405, { error: '只接受 GET' })
      const cfg = defaultConfig(effectiveEnv)
      return json(200, {
        ok: true,
        runtime: 'aliyun-esa-pages-function',
        hasBaseUrl: !!cfg.baseUrl,
        hasModel: !!cfg.model,
        hasApiKey: !!cfg.apiKey
      })
    }

    if (path === '/api/llm/status') {
      if (request.method !== 'GET') return json(405, { error: '只接受 GET' })
      const cfg = defaultConfig(effectiveEnv)
      return json(200, { available: !!cfg.baseUrl && !!cfg.model, model: cfg.model || null })
    }

    if (path === '/api/llm/chat') {
      if (request.method !== 'POST') return json(405, { error: '只接受 POST' })
      return handleChat(request, effectiveEnv)
    }

    if (path.startsWith('/api/')) return json(404, { error: '接口不存在' })

    return spaFallback(request)
  }
}
