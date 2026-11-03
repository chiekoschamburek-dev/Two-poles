export class ApiError extends Error {
  code: string
  status: number
  detail?: unknown

  constructor(code: string, status: number, message: string, detail?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
    this.detail = detail
  }
}

const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env
const rawBase = (env?.VITE_API_BASE_URL ?? '').trim() || ((env?.DEV && env?.VITE_API_MOCK === 'true') ? 'same-origin' : '')
export const apiEnabled = rawBase.length > 0

function normalizeBase(value: string): string {
  if (!value || value === '/' || value === 'same-origin') return ''
  const trimmed = value.replace(/\/+$/, '')
  return trimmed.endsWith('/api/v1') ? trimmed.slice(0, -'/api/v1'.length) : trimmed
}

const base = normalizeBase(rawBase)
export const apiBase = `${base}/api/v1`

let accessToken = ''

export function setAccessToken(token: string) {
  accessToken = token
}

export function clearAccessToken() {
  accessToken = ''
}

export function getAccessToken(): string {
  return accessToken
}

function timeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms)
  }
  const controller = new AbortController()
  setTimeout(() => controller.abort(), ms)
  return controller.signal
}

async function parseError(response: Response): Promise<ApiError> {
  const text = await response.text().catch(() => '')
  let body: { code?: unknown; message?: unknown; detail?: unknown } = {}
  if (text) {
    try {
      body = JSON.parse(text) as typeof body
    } catch {
      body = { message: text.slice(0, 200) }
    }
  }
  const code = typeof body.code === 'string' ? body.code : response.status === 401 ? 'unauthorized' : 'unknown'
  const message = typeof body.message === 'string' && body.message ? body.message : `请求失败（${response.status}）`
  return new ApiError(code, response.status, message, body.detail)
}

export interface ApiRequestInit extends Omit<RequestInit, 'body'> {
  body?: unknown
  idempotencyKey?: string
  timeoutMs?: number
  noRefresh?: boolean
}

let refreshPromise: Promise<boolean> | null = null

async function refreshAccessToken(): Promise<boolean> {
  if (!apiEnabled) return false
  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        const response = await fetch(`${apiBase}/auth/refresh`, {
          method: 'POST',
          credentials: 'include',
          signal: timeoutSignal(15_000)
        })
        if (!response.ok) return false
        const body = await response.json() as { accessToken?: unknown }
        if (typeof body.accessToken !== 'string' || !body.accessToken) return false
        accessToken = body.accessToken
        return true
      } catch {
        return false
      } finally {
        refreshPromise = null
      }
    })()
  }
  return refreshPromise
}

async function doFetch(path: string, init: ApiRequestInit): Promise<Response> {
  const headers = new Headers(init.headers)
  if (init.body !== undefined && !(init.body instanceof FormData)) headers.set('content-type', 'application/json')
  if (accessToken) headers.set('authorization', `Bearer ${accessToken}`)
  if (init.idempotencyKey) headers.set('idempotency-key', init.idempotencyKey)
  const body = init.body === undefined
    ? undefined
    : init.body instanceof FormData || typeof init.body === 'string' || init.body instanceof Blob
      ? init.body as BodyInit
      : JSON.stringify(init.body)
  return fetch(`${apiBase}${path}`, {
    method: init.method ?? 'GET',
    headers,
    body,
    credentials: 'include',
    signal: init.signal ?? timeoutSignal(init.timeoutMs ?? 15_000)
  })
}

export async function request<T>(path: string, init: ApiRequestInit = {}): Promise<T> {
  if (!apiEnabled) throw new ApiError('local_only', 0, '未配置后端地址，当前为本机模式')
  let response = await doFetch(path, init)
  const authPath = path.startsWith('/auth/') && !path.startsWith('/auth/delete-account') && path !== '/auth/bind'
  if (response.status === 401 && !init.noRefresh && !authPath) {
    const refreshed = await refreshAccessToken()
    if (refreshed) response = await doFetch(path, init)
    else clearAccessToken()
  }
  if (!response.ok) throw await parseError(response)
  if (response.status === 204) return undefined as T
  const type = response.headers.get('content-type') ?? ''
  return type.includes('application/json') ? response.json() as Promise<T> : response.text() as Promise<T>
}

export async function requestBlob(path: string, init: ApiRequestInit = {}): Promise<Blob> {
  if (!apiEnabled) throw new ApiError('local_only', 0, '未配置后端地址，当前为本机模式')
  let response = await doFetch(path, { ...init, timeoutMs: init.timeoutMs ?? 60_000 })
  if (response.status === 401 && !init.noRefresh) {
    const refreshed = await refreshAccessToken()
    if (refreshed) response = await doFetch(path, { ...init, timeoutMs: init.timeoutMs ?? 60_000 })
  }
  if (!response.ok) throw await parseError(response)
  return response.blob()
}

export async function refreshSession(): Promise<boolean> {
  return refreshAccessToken()
}

export function apiUrl(path: string): string {
  return `${apiBase}${path}`
}

export function remoteDownloadUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path
  return `${base}${path}`
}
