// crypto.randomUUID is unavailable in insecure contexts (http on a LAN IP)
export function newId(): string {
  const c = globalThis.crypto
  if (c?.randomUUID) return c.randomUUID()
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
