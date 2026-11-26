// 档案里的"可计算"部分：身体数据校验、可用时长解析、成绩解析、当前 PB、目标摘要。
// 全部是纯函数，页面只负责展示；口径集中在这里，方便 selfcheck 断言。
import type { GymRecord, GoalType, PersonalBest, UserProfile } from '@/types/domain'

/**
 * 年龄是档案必填项；档案页与首次使用引导共用同一区间。
 * 下限保持 12：12–17 岁不做自动推荐（见 exercises.gateReason），低于 12 的数值不给填。
 * 上限放宽到 100：90 岁以上仍在规律活动的用户不该被表单拒绝。
 */
export const AGE_RANGE = { min: 12, max: 100 }
/** 身高 cm 的合理区间；只在填了之后才校验。与服务端 profiles 复校口径一致 */
export const HEIGHT_RANGE = { min: 80, max: 260 }
/** 体重 kg 的合理区间；与服务端口径一致，200 kg 以上也不是不可能 */
export const WEIGHT_RANGE = { min: 20, max: 400 }
/**
 * 单次可用时长（分钟）的合法区间：预设档位之外的「其他时长」按这个校验。
 * 上限 300 只是防手滑；真正排课仍按所选时长取最大值为预算。
 */
export const TIME_RANGE = { min: 5, max: 300 }

/** 年龄必须是区间内的整数；空值不算合法 */
export function isValidAge(age: number | '' | null | undefined): age is number {
  return typeof age === 'number'
    && Number.isInteger(age)
    && age >= AGE_RANGE.min
    && age <= AGE_RANGE.max
}

/** 档案页/引导页共用的年龄错误文案；合法时返回 null */
export function ageError(age: number | '' | null | undefined): string | null {
  return isValidAge(age) ? null : `请填写 ${AGE_RANGE.min}–${AGE_RANGE.max} 岁之间的实际年龄。`
}

/**
 * 专项的统一读法：新档案是可多选的 disciplines，旧档案是单选的 discipline。
 * 旧值不丢；读的地方一律走这里，不再直接碰 profile.discipline。
 */
export function disciplinesOf(
  p: Pick<UserProfile, 'disciplines' | 'discipline'> | null | undefined
): string[] {
  if (!p) return []
  const list = (p.disciplines ?? []).map(item => item.trim()).filter(Boolean)
  if (list.length) return [...new Set(list)]
  const legacy = typeof p.discipline === 'string' ? p.discipline.trim() : ''
  return legacy ? [legacy] : []
}

/**
 * 「45 分钟」/「45」→ 45；解析不出来返回 null。
 * 预设档位与自定义档位都存成「N 分钟」这一种写法，排课预算与界面不必再判断来源。
 */
export function parseTimeMinutes(label: string): number | null {
  const text = String(label ?? '').trim()
  const matched = /^(\d{1,4})(?:\s*分钟)?$/.exec(text)
  if (!matched) return null
  const minutes = Number(matched[1])
  return Number.isFinite(minutes) && minutes > 0 ? minutes : null
}

/** 分钟数 → 落库文案；与预设档位同一格式 */
export function timeLabel(minutes: number): string {
  return `${Math.round(minutes)} 分钟`
}

/**
 * 按分钟数升序，并把档位统一成「N 分钟」这一种写法：
 * 旧档案里可能存着服务端测试用的裸数字 "30"，界面上不该出现一个没有单位的自定义档。
 * 解析不出来的历史值原样保留，不静默丢数据。
 */
export function sortTimeLabels(list: string[]): string[] {
  const labels = new Map<string, string>()
  for (const item of list) {
    const text = String(item ?? '').trim()
    if (!text) continue
    const minutes = parseTimeMinutes(text)
    if (minutes === null) labels.set(`raw:${text}`, text)
    else labels.set(`m:${minutes}`, timeLabel(minutes))
  }
  // 解析不出来的历史值排在最后：它们不参与预算，不该插在真实档位中间
  return [...labels.values()].sort((a, b) => (parseTimeMinutes(a) ?? Number.POSITIVE_INFINITY) - (parseTimeMinutes(b) ?? Number.POSITIVE_INFINITY))
}

/** 自定义时长的错误文案；没填不算错，合法也返回 null */
export function customTimeError(raw: number | '' | null | undefined): string | null {
  if (raw === '' || raw === null || raw === undefined) return null
  const minutes = Number(raw)
  if (!Number.isInteger(minutes) || minutes < TIME_RANGE.min || minutes > TIME_RANGE.max) {
    return `填写 ${TIME_RANGE.min}–${TIME_RANGE.max} 之间的整数分钟`
  }
  return null
}

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

/** 目标摘要的输入：专项两种存法都接受，读取统一走 disciplinesOf */
export interface GoalSummaryInput {
  goalType?: GoalType
  targetEvent?: string
  targetEventDate?: string
  disciplines?: string[]
  discipline?: string
  cyclePhase?: string
}

/** 目标摘要：档案页与设置页共用一句，避免两处措辞不一致 */
export function goalSummary(p: GoalSummaryInput | null | undefined): string {
  if (!p) return '未设置目标'
  const type: GoalType = p.goalType ?? (p.targetEvent ? 'competition' : p.cyclePhase ? 'cycle' : 'competition')
  if (type === 'competition') {
    if (!p.targetEvent?.trim()) return '比赛目标：还没填赛事名称'
    const when = p.targetEventDate ? formatCnDate(p.targetEventDate) : '日期未定'
    return `${p.targetEvent.trim()} · ${when}`
  }
  const sports = disciplinesOf(p)
  const phase = p.cyclePhase?.trim()
  if (!sports.length && !phase) return '周期目标：还没填专项与阶段'
  // 多个专项用顿号并列，不加"等"字，避免暗示还有没列出的项
  return [sports.join('、'), phase].filter(Boolean).join(' · ')
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
    // 专项改为多选：旧档案的单选 discipline 在这里迁进 disciplines，原字段不再参与读取
    disciplines: disciplinesOf(raw),
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
