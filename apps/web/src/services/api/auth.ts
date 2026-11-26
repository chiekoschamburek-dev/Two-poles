import { clearAccessToken, request, setAccessToken } from './http'

export interface AuthUser {
  id: string
  type: 'anonymous' | 'registered'
  createdAt: string
}

export interface AuthResult {
  userId: string
  user: AuthUser
  accessToken: string
  expiresIn: number
}

function accept(result: AuthResult): AuthResult {
  setAccessToken(result.accessToken)
  return result
}

export async function register(identifier: string, password: string): Promise<AuthResult> {
  return accept(await request<AuthResult>('/auth/register', {
    method: 'POST',
    body: { identifier, password }
  }))
}

export async function login(identifier: string, password: string): Promise<AuthResult> {
  return accept(await request<AuthResult>('/auth/login', {
    method: 'POST',
    body: { identifier, password }
  }))
}

export async function device(): Promise<AuthResult> {
  return accept(await request<AuthResult>('/auth/device', { method: 'POST' }))
}

export async function refresh(): Promise<AuthResult | null> {
  try {
    const result = await request<AuthResult>('/auth/refresh', { method: 'POST', noRefresh: true })
    return accept(result)
  } catch {
    clearAccessToken()
    return null
  }
}

export async function bind(identifier: string, password: string): Promise<AuthUser> {
  const body = await request<{ user: AuthUser }>('/auth/bind', {
    method: 'POST',
    body: { identifier, password }
  })
  return body.user
}

export async function logout(): Promise<void> {
  try {
    await request<void>('/auth/logout', { method: 'POST', noRefresh: true })
  } catch {
    /* 本地登出不能因为网络失败而卡住 */
  } finally {
    clearAccessToken()
  }
}
