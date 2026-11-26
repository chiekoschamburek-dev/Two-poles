// 全站共用一个 body 滚动锁：多个弹层嵌套时按持有者计数，最后一个关闭才恢复。
// 之前每个弹层各存一份 previousOverflow，后关的会把先关的"原值"再写回去，页面从此划不动。
const holders = new Set<symbol>()
let savedOverflow = ''

export function lockBodyScroll(): symbol | null {
  if (typeof document === 'undefined') return null
  const token = Symbol('body-scroll-lock')
  if (holders.size === 0) {
    savedOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
  }
  holders.add(token)
  return token
}

export function unlockBodyScroll(token: symbol | null | undefined): void {
  if (typeof document === 'undefined' || !token) return
  if (!holders.delete(token)) return
  if (holders.size === 0) {
    document.body.style.overflow = savedOverflow
    savedOverflow = ''
  }
}

/** 路由切换/异常兜底：无视剩余持有者，直接把滚动条还给页面 */
export function resetBodyScroll(): void {
  if (typeof document === 'undefined') return
  holders.clear()
  document.body.style.overflow = savedOverflow || ''
  savedOverflow = ''
}
