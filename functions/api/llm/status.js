// EdgeOne Pages Function: GET /api/llm/status
// 只返回"服务端默认模型有没有、叫什么"，绝不返回 base_url 或密钥。
// 兼容两种 Pages 项目根目录；仓库根也有一份相同的 functions/api/llm/status.js。
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

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  })
}

export async function onRequest(context) {
  const { request } = context
  if (request.method !== 'GET') return json(405, { error: '只接受 GET' })

  const baseUrl = (readEnv(context, 'LLM_DEFAULT_BASE_URL') || readEnv(context, 'LLM_BASE_URL'))
    .trim()
    .replace(/\/+$/, '')
  const model = (readEnv(context, 'LLM_DEFAULT_MODEL') || readEnv(context, 'LLM_MODEL')).trim()

  return json(200, { available: !!baseUrl && !!model, model: model || null })
}
