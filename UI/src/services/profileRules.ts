// 档案里的"可计算"部分：身体数据校验、成绩解析、当前 PB、目标摘要。
// 全部是纯函数，页面只负责展示；口径集中在这里，方便 selfcheck 断言。
import type { GymRecord, GoalType, PersonalBest, UserProfile } from '@/types/domain'

/** 身高 cm 的合理区间；只在填了之后才校验 */
export const HEIGHT_RANGE = { min: 100, max: 250 }
/** 体重 kg 的合理区间；沿用建档页原来的 25–200 */
export const WEIGHT_RANGE = { min: 25, max: 200 }

/** 径赛：按时间比，越短越好 */
export const TRACK_EVENTS = ['100m', '200m', '400m', '800m', '1500m', '5000m']
/** 田赛：按距离比，越远越好 */
export const FIELD_EVENTS = ['跳远', '三级跳', '铅球']
/** 常见举重动作，仍允许自定义 */
export const LIFT_PRESETS = ['深蹲', '硬拉', '卧推']

/** 成绩解析：把 "11.23" / "2:05.3" / "6.85 m" 统一成可比较的数字（秒或米） */
export function parseResult(raw: string, track: boolean): number | null {
  const text = String(raw ?? '').trim()
  if (!text) return null
  // 负号要在清洗前判掉：否则 "-3" 会被后面的正则削成 "3"，把无效输入变成有效成绩
  if (/^[-−]/.test(text)) return null
  // 去掉单位、空格与中文注释，只留数字、小数点、冒号
  const cleaned = text.replace(/[^0-9:.]/g, '')
  if (!cleaned) return null
  const parts = cleaned.split(':')
  if (parts.length > 3) return null
  if (parts.some(p => p === '')) return null
  // 距离类没有"分:秒"的概念，出现冒号一律视为非法
  if (!track && parts.length > 1) return null
  let value: number
  if (parts.length === 1) {
    value = Number(parts[0])
  } else if (parts.length === 2) {
    value = Number(parts[0]) * 60 + Number(parts[1])
  } else {
    value = Number(parts[0]) * 3600 + Number(parts[1]) * 60 + Number(parts[2])
  }
  if (!Number.isFinite(value) || value <= 0) return null
  return Math.round(value * 1000) / 1000
}

export interface EventBest {
  event: string
  track: boolean
  /** 当前 PB 那条记录（原样保留用户输入） */
  best: PersonalBest
  /** 解析后的可比数值：径赛是秒，田赛是米 */
  value: number
  /** 该项目一共几条历史记录 */
  count: number
}

/**
 * 按项目算当前 PB：径赛取最短时间、田赛取最远距离。
 * 只用于"标出哪一条是当前 PB"，不删除也不合并历史记录。
 * 解析不出来的记录不参与比较，但仍然留在列表里。
 */
export function eventBests(list: PersonalBest[] | undefined): EventBest[] {
  const map = new Map<string, EventBest>()
  for (const pb of list ?? []) {
    const value = parseResult(pb.result, pb.track)
    if (value === null) continue
    const key = `${pb.track ? 'T' : 'F'}:${pb.event}`
    const prev = map.get(key)
    if (!prev) {
      map.set(key, { event: pb.event, track: pb.track, best: pb, value, count: 1 })
      continue
    }
    prev.count += 1
    const better = pb.track ? value < prev.value : value > prev.value
    if (better) {
      prev.best = pb
      prev.value = value
    }
  }
  return [...map.values()].sort((a, b) => a.event.localeCompare(b.event, 'zh-Hans-CN'))
}

/** 某条记录是不是它所在项目的当前 PB */
export function isCurrentBest(pb: PersonalBest, list: PersonalBest[] | undefined): boolean {
  return eventBests(list).some(x => x.best.id === pb.id)
}

export interface BodyErrors {
  height?: string
  weight?: string
}

/** 只在填了之后才校验，没填不算错 */
export function bodyErrors(height?: number | '' | null, weight?: number | '' | null): BodyErrors {
  const out: BodyErrors = {}
  if (height !== '' && height !== null && height !== undefined) {
    const h = Number(height)
    if (!Number.isFinite(h) || h < HEIGHT_RANGE.min || h > HEIGHT_RANGE.max) {
      out.height = `身高填写 ${HEIGHT_RANGE.min}–${HEIGHT_RANGE.max} cm 之间的数值（可留空）`
    }
  }
  if (weight !== '' && weight !== null && weight !== undefined) {
    const w = Number(weight)
    if (!Number.isFinite(w) || w < WEIGHT_RANGE.min || w > WEIGHT_RANGE.max) {
      out.weight = `体重填写 ${WEIGHT_RANGE.min}–${WEIGHT_RANGE.max} kg 之间的数值（可留空）`
    }
  }
  return out
}

/** 周期起止顺序；两端都填了才校验 */
export function cycleRangeError(start?: string, end?: string): string | null {
  if (!start || !end) return null
  return start > end ? '周期开始日期不能晚于结束日期。' : null
}

/** 目标摘要：档案页与设置页共用一句，避免两处措辞不一致 */
export function goalSummary(
  p: Pick<UserProfile, 'goalType' | 'targetEvent' | 'targetEventDate' | 'discipline' | 'cyclePhase'> | null | undefined
): string {
  if (!p) return '未设置目标'
  const type: GoalType = p.goalType ?? (p.targetEvent ? 'competition' : p.cyclePhase ? 'cycle' : 'competition')
  if (type === 'competition') {
    if (!p.targetEvent?.trim()) return '比赛目标：还没填赛事名称'
    const when = p.targetEventDate ? formatCnDate(p.targetEventDate) : '日期未定'
    return `${p.targetEvent.trim()} · ${when}`
  }
  const sport = p.discipline?.trim()
  const phase = p.cyclePhase?.trim()
  if (!sport && !phase) return '周期目标：还没填专项与阶段'
  return [sport, phase].filter(Boolean).join(' · ')
}

/** '2026-10-18' → '10 月 18 日'；解析不了就原样返回 */
export function formatCnDate(iso?: string): string {
  if (!iso) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return iso
  return `${Number(m[2])} 月 ${Number(m[3])} 日`
}

/** 读取旧档案时补齐新增字段，避免每次用到都写 `?? []` */
export function normalizeProfile(raw: UserProfile | null | undefined): UserProfile | null {
  if (!raw) return null
  return {
    ...raw,
    // 老档案没有这两组数组：补空数组而不是 undefined，列表组件可以直接循环
    personalBests: Array.isArray(raw.personalBests) ? raw.personalBests : [],
    gymRecords: Array.isArray(raw.gymRecords) ? raw.gymRecords : []
    // 身高/体重保持"没填就是没填"，不塞默认值，也不改写已有体重
  }
}

/** 极限数据的展示文案：1RM 与训练最高重量不能混着说 */
export function gymRecordLabel(r: GymRecord): string {
  const reps = r.reps ? ` × ${r.reps}` : ''
  const kind = r.kind === '1rm' ? '1RM' : '训练最高'
  return `${r.lift} ${r.weight} kg${reps} · ${kind}`
}
