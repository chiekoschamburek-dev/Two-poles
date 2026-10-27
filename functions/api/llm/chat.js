// EdgeOne Pages Function: POST /api/llm/chat
//
// 作用：把浏览器发来的模型请求在同源边缘节点转发给 OpenAI 兼容接口。
// 默认模型密钥只从边缘函数环境变量读取：
//   LLM_DEFAULT_BASE_URL / LLM_DEFAULT_API_KEY / LLM_DEFAULT_MODEL
// 浏览器只会收到模型输出，永远不会收到密钥。
//
// 兼容两种 Pages 项目根目录：本文件在 UI/functions 下，另有一份相同的
// functions/api/llm/chat.js 在仓库根；实际生效的是 Pages 根目录下那一份。
const MAX_BODY = 6_000_000
const TIMEOUT_MS = 120_000

function readEnv(context, key) {
  if (context && context.env && typeof context.env[key] === 'string' && context.env[key]) {
    return context.env[key]
  }
  // 部分 EdgeOne 运行时把变量注入全局；再兜底一次 process.env（本地 edgeone pages dev）
  if (typeof globalThis !== 'undefined' && typeof globalThis[key] === 'string' && globalThis[key]) {
    return globalThis[key]
  }
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

function defaultConfig(context) {
  return {
    baseUrl: (readEnv(context, 'LLM_DEFAULT_BASE_URL') || readEnv(context, 'LLM_BASE_URL'))
      .trim()
      .replace(/\/+$/, ''),
    apiKey: readEnv(context, 'LLM_DEFAULT_API_KEY') || readEnv(context, 'LLM_API_KEY'),
    model: (readEnv(context, 'LLM_DEFAULT_MODEL') || readEnv(context, 'LLM_MODEL')).trim()
  }
}

function isPrivateHost(hostname) {
  const host = hostname.toLowerCase()
  if (host === 'localhost' || host === '0.0.0.0' || host === '[::1]' || host === '::1') return true
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) return true
  const m = /^172\.(\d{1,2})\./.exec(host)
  return !!m && Number(m[1]) >= 16 && Number(m[1]) <= 31
}

export async function onRequest(context) {
  const { request } = context
  if (request.method !== 'POST') return json(405, { error: '只接受 POST' })

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

  const defaults = defaultConfig(context)
  const wantDefault = body.useDefault === true || !body.baseUrl || !body.model

  let chosen
  if (wantDefault) {
    chosen = defaults
  } else {
    // 默认不把边缘节点当作任意 URL 的开放代理；确实需要用户自带 key 时，
    // 在 ESA 环境变量里显式设置 ALLOW_CUSTOM_LLM_PROXY=true。
    if (readEnv(context, 'ALLOW_CUSTOM_LLM_PROXY') !== 'true') {
      return json(403, {
        error: '生产环境未开启自定义模型代理；请在 ESA 配置 LLM_DEFAULT_* 环境变量，或在设置页切到内置模型。'
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
      error: '没有可用的默认模型：请在 ESA 配置 LLM_DEFAULT_BASE_URL / LLM_DEFAULT_MODEL / LLM_DEFAULT_API_KEY'
    })
  }
  if (!/^https?:\/\//i.test(chosen.baseUrl)) {
    return json(400, { error: 'base_url 必须以 http:// 或 https:// 开头' })
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

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
      } catch { /* 上游不是 JSON，直接给原文 */ }
      return json(upstream.status, { error: `上游 ${upstream.status}：${detail}` })
    }

    let data
    try {
      data = JSON.parse(text)
    } catch {
      return json(502, { error: '上游返回的不是 JSON' })
    }
    const content = data?.choices?.[0]?.message?.content
    if (typeof content !== 'string' || !content.trim()) {
      return json(502, { error: '上游没有返回 content' })
    }
    return json(200, { text: content, model: data?.model ?? chosen.model })
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError'
    const msg = e instanceof Error ? e.message : String(e)
    return json(aborted ? 504 : 502, {
      error: aborted ? '模型请求超时（EdgeOne 函数执行时间可能低于 120 秒）' : `转发失败：${msg}`
    })
  } finally {
    clearTimeout(timer)
  }
}
