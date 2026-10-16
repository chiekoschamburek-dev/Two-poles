const WEEKDAYS_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const WEEKDAYS_EN = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY']
const MONTHS_EN = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER']

const pad = (n: number) => String(n).padStart(2, '0')

export function shortDate(d: Date): string {
  return `${WEEKDAYS_CN[d.getDay()]} · ${d.getMonth() + 1}月${d.getDate()}日`
}

export function eyebrowDate(d: Date): string {
  return `${WEEKDAYS_EN[d.getDay()]} · ${MONTHS_EN[d.getMonth()]} ${d.getDate()}`
}

export function greeting(d: Date): string {
  const h = d.getHours()
  if (h < 11) return '上午好'
  if (h < 14) return '中午好'
  if (h < 18) return '下午好'
  return '晚上好'
}

export function displayName(nickname?: string): string {
  return nickname?.trim() || '朋友'
}

export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Monday-first grid; leading nulls pad the offset of the 1st */
export function monthCells(year: number, month: number): (number | null)[] {
  const offset = (new Date(year, month, 1).getDay() + 6) % 7
  const days = new Date(year, month + 1, 0).getDate()
  return [...Array<null>(offset).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)]
}
