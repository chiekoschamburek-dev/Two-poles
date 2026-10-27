// EdgeOne Pages Function: GET /api/llm/ping
// 只用于确认 Pages Function 是否真的被部署；不暴露 key，只返回布尔值。
// 一个从未被请求过的新路径，可以排除 /api/llm/status 的旧缓存干扰。
function readEnv(context, key) {
  if (context && context.env && typeof context.env[key] === 'string' && context.env[key]) {
    return context.env[key]
  }
  if (typeof globalThis !== 'undefined' && typeof globalThis[key] === 'string' && globalThis[key]) {
    return globalThis[key]
  }
  if (typeof process !== 'undefined' && process.env && typeof process.env[key] === 'string') {
    return process.env[key]
  }
  return ''
}

export async function onRequest(context) {
  const baseUrl = readEnv(context, 'LLM_DEFAULT_BASE_URL') || readEnv(context, 'LLM_BASE_URL')
  const model = readEnv(context, 'LLM_DEFAULT_MODEL') || readEnv(context, 'LLM_MODEL')
  const apiKey = readEnv(context, 'LLM_DEFAULT_API_KEY') || readEnv(context, 'LLM_API_KEY')
  return new Response(JSON.stringify({
    ok: true,
    runtime: 'edgeone-pages-function',
    hasBaseUrl: !!baseUrl,
    hasModel: !!model,
    hasApiKey: !!apiKey
  }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  })
}
