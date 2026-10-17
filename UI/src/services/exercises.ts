// 动作库（F12 内容条目）。
// 来源一律如实标注：这些是自编的演示条目，参照常见居家与场地训练动作，
// 未经运动医学或体能专业人士逐项审核；`status: 'retired'` 的条目不可用于新推荐。
import type { TrainingType } from '@/types/domain'

export const EXERCISE_CATALOG_VERSION = 'exercise-catalog-v1'

export const EXERCISE_SOURCE = '自编演示条目 · 参照常见居家训练动作，未经专业人士审核'

/** 场地与文档 §3.4.3(1) 的"场地"过滤维度一致 */
export type Venue = '宿舍或家' | '健身房' | '户外'

export interface CameraConfig {
  /** 取左侧关节角 */
  joint: 'knee' | 'elbow'
  /** 起始位（坐姿/手臂下垂对应关节角小于该值，站位大于该值） */
  neutral: number
  /** 行程末端 */
  bottom: number
  /** 末端保持多久算一次完成，ms */
  minStageMs: number
}

export interface Exercise {
  id: string
  name: string
  type: TrainingType
  /** 需要的器材；空数组表示不需要器材（对应档案里的"无器材"） */
  equipment: string[]
  venues: Venue[]
  /** 单组大约耗时，分钟 */
  minutes: number
  sets: number
  reps?: number
  /** 持续项（平板支撑类）按秒 */
  holdSeconds?: number
  intensity: '低' | '中' | '高'
  /** 与档案"需要避开的"对齐的三个门槛 */
  jumpFree: boolean
  kneeFriendly: boolean
  spineFriendly: boolean
  /** 动作说明，界面直接展示；不写"标准姿势"结论 */
  howto: string
  /** 替换候选与解释用的短句 */
  reason?: string
  camera?: CameraConfig
  status: 'active' | 'retired'
  source: string
}

const E = (e: Exercise) => e

export const exercises: Exercise[] = [
  // ===== 动态热身 =====
  E({ id: 'ex-shoulder-roll', name: '肩环绕', type: '动态热身', equipment: [], venues: ['宿舍或家', '健身房', '户外'], minutes: 1, sets: 1, reps: 10, intensity: '低', jumpFree: true, kneeFriendly: true, spineFriendly: true, howto: '双肩向后画圆，幅度以不引起不适为准', status: 'active', source: EXERCISE_SOURCE }),
  E({ id: 'ex-hip-swing', name: '髋部摆动', type: '动态热身', equipment: [], venues: ['宿舍或家', '健身房', '户外'], minutes: 2, sets: 1, reps: 10, intensity: '低', jumpFree: true, kneeFriendly: true, spineFriendly: true, howto: '单扶墙，另一腿前后摆动', status: 'active', source: EXERCISE_SOURCE }),
  E({ id: 'ex-mark-march', name: '高抬腿走', type: '动态热身', equipment: [], venues: ['宿舍或家', '健身房', '户外'], minutes: 3, sets: 1, reps: 20, intensity: '低', jumpFree: true, kneeFriendly: true, spineFriendly: false, howto: '原地交替抬膝至髋高，不跑跳', status: 'active', source: EXERCISE_SOURCE }),
  E({ id: 'ex-cat-cow', name: '猫式伸展', type: '动态热身', equipment: [], venues: ['宿舍或家', '健身房'], minutes: 2, sets: 1, reps: 8, intensity: '低', jumpFree: true, kneeFriendly: true, spineFriendly: true, howto: '四点支撑，交替拱背与塌腰', status: 'active', source: EXERCISE_SOURCE }),
  E({ id: 'ex-lunge-twist', name: '动态弓步转体', type: '动态热身', equipment: [], venues: ['宿舍或家', '健身房', '户外'], minutes: 3, sets: 1, reps: 8, intensity: '中', jumpFree: true, kneeFriendly: false, spineFriendly: true, howto: '前弓步同时向同侧转体', status: 'active', source: EXERCISE_SOURCE }),

  // ===== 两个可跟练计数的动作（F05） =====
  E({ id: 'ex-chair-sitstand', name: '坐站训练', type: '坐站训练', equipment: ['椅子'], venues: ['宿舍或家', '健身房'], minutes: 3, sets: 2, reps: 8, intensity: '低', jumpFree: true, kneeFriendly: true, spineFriendly: true, howto: '坐稳后站起再坐下，全程不憋气', reason: '低冲击，只需一把椅子', camera: { joint: 'knee', neutral: 168, bottom: 100, minStageMs: 220 }, status: 'active', source: EXERCISE_SOURCE }),
  E({ id: 'ex-stand-curl', name: '站姿弯举', type: '站姿弯举', equipment: ['哑铃', '弹力带'], venues: ['宿舍或家', '健身房'], minutes: 3, sets: 2, reps: 10, intensity: '中', jumpFree: true, kneeFriendly: true, spineFriendly: true, howto: '大臂贴身，屈肘举起再放下', camera: { joint: 'elbow', neutral: 170, bottom: 55, minStageMs: 180 }, status: 'active', source: EXERCISE_SOURCE }),
  E({ id: 'ex-band-curl', name: '弹力带弯举', type: '站姿弯举', equipment: ['弹力带'], venues: ['宿舍或家', '健身房'], minutes: 3, sets: 2, reps: 10, intensity: '低', jumpFree: true, kneeFriendly: true, spineFriendly: true, howto: '踩住带中段，屈肘拉起', reason: '同等负荷，关节压力更小', status: 'active', source: EXERCISE_SOURCE }),
  E({ id: 'ex-bottle-curl', name: '水瓶替代弯举', type: '站姿弯举', equipment: [], venues: ['宿舍或家', '健身房', '户外'], minutes: 3, sets: 2, reps: 12, intensity: '低', jumpFree: true, kneeFriendly: true, spineFriendly: true, howto: '双手各持一瓶水屈肘举起', reason: '无器材时的等效动作', status: 'active', source: EXERCISE_SOURCE }),

  // ===== 力量与稳定 =====
  E({ id: 'ex-wall-sit', name: '靠墙静蹲', type: '其他', equipment: [], venues: ['宿舍或家', '健身房'], minutes: 4, sets: 2, holdSeconds: 30, intensity: '中', jumpFree: true, kneeFriendly: false, spineFriendly: true, howto: '背靠墙屈膝下蹲，不超过膝盖明显疼痛为界', status: 'active', source: EXERCISE_SOURCE }),
  E({ id: 'ex-band-row', name: '弹力带划船', type: '其他', equipment: ['弹力带'], venues: ['宿舍或家', '健身房'], minutes: 4, sets: 2, reps: 12, intensity: '中', jumpFree: true, kneeFriendly: true, spineFriendly: true, howto: '带绕脚底，屈肘向后拉至躯干两侧', status: 'active', source: EXERCISE_SOURCE }),
  E({ id: 'ex-knee-pushup', name: '跪姿俯卧撑', type: '其他', equipment: [], venues: ['宿舍或家', '健身房'], minutes: 4, sets: 2, reps: 8, intensity: '中', jumpFree: true, kneeFriendly: true, spineFriendly: false, howto: '膝着地，身体保持一条直线', status: 'active', source: EXERCISE_SOURCE }),
  E({ id: 'ex-glute-bridge', name: '臀桥', type: '其他', equipment: [], venues: ['宿舍或家', '健身房'], minutes: 4, sets: 2, reps: 12, intensity: '低', jumpFree: true, kneeFriendly: true, spineFriendly: true, howto: '仰卧屈膝，抬臀至髋与膝同高', status: 'active', source: EXERCISE_SOURCE }),
  E({ id: 'ex-dead-bug', name: '死虫式', type: '其他', equipment: [], venues: ['宿舍或家', '健身房'], minutes: 4, sets: 2, reps: 10, intensity: '低', jumpFree: true, kneeFriendly: true, spineFriendly: true, howto: '腰背贴地，对侧手脚缓慢伸出', status: 'active', source: EXERCISE_SOURCE }),
  E({ id: 'ex-bird-dog', name: '鸟狗式', type: '其他', equipment: [], venues: ['宿舍或家', '健身房'], minutes: 4, sets: 2, reps: 8, intensity: '低', jumpFree: true, kneeFriendly: true, spineFriendly: true, howto: '四点支撑，对侧手脚同时伸出', status: 'active', source: EXERCISE_SOURCE }),
  E({ id: 'ex-side-plank', name: '侧支撑（屈膝）', type: '其他', equipment: [], venues: ['宿舍或家', '健身房'], minutes: 3, sets: 2, holdSeconds: 20, intensity: '中', jumpFree: true, kneeFriendly: true, spineFriendly: true, howto: '屈膝侧撑，抬离床面即可', status: 'active', source: EXERCISE_SOURCE }),
  E({ id: 'ex-plank', name: '平板支撑', type: '其他', equipment: [], venues: ['宿舍或家', '健身房'], minutes: 3, sets: 2, holdSeconds: 30, intensity: '中', jumpFree: true, kneeFriendly: true, spineFriendly: false, howto: '前臂支撑，躯干成一直线', status: 'active', source: EXERCISE_SOURCE }),
  E({ id: 'ex-calf-raise', name: '提踵', type: '其他', equipment: ['椅子'], venues: ['宿舍或家', '健身房'], minutes: 3, sets: 2, reps: 15, intensity: '低', jumpFree: true, kneeFriendly: true, spineFriendly: true, howto: '扶椅背，缓慢抬起脚跟再落下', status: 'active', source: EXERCISE_SOURCE }),
  E({ id: 'ex-band-walk', name: '弹力带侧向行走', type: '其他', equipment: ['弹力带'], venues: ['宿舍或家', '健身房', '户外'], minutes: 4, sets: 2, reps: 12, intensity: '中', jumpFree: true, kneeFriendly: true, spineFriendly: true, howto: '带套膝上，半蹲姿势侧向迈步', status: 'active', source: EXERCISE_SOURCE }),
  E({ id: 'ex-step-up', name: '台阶上下', type: '其他', equipment: ['椅子'], venues: ['宿舍或家', '健身房'], minutes: 5, sets: 2, reps: 10, intensity: '中', jumpFree: true, kneeFriendly: false, spineFriendly: true, howto: '用稳固台阶或低凳，单腿踩上再下', status: 'active', source: EXERCISE_SOURCE }),
  E({ id: 'ex-jumping-jack', name: '开合跳', type: '其他', equipment: [], venues: ['宿舍或家', '健身房', '户外'], minutes: 3, sets: 2, reps: 20, intensity: '高', jumpFree: false, kneeFriendly: false, spineFriendly: true, howto: '连续开合，落地前脚掌先着地', status: 'active', source: EXERCISE_SOURCE }),
  E({ id: 'ex-squat-jump', name: '深蹲跳', type: '其他', equipment: [], venues: ['宿舍或家', '健身房'], minutes: 3, sets: 2, reps: 10, intensity: '高', jumpFree: false, kneeFriendly: false, spineFriendly: false, howto: '下蹲后向上跳起，落地微屈缓冲', status: 'active', source: EXERCISE_SOURCE }),
  E({ id: 'ex-neck-bridge', name: '桥式滚颈', type: '其他', equipment: [], venues: ['宿舍或家'], minutes: 2, sets: 1, reps: 5, intensity: '中', jumpFree: true, kneeFriendly: true, spineFriendly: false, howto: '头部承重翻转，颈椎风险高', status: 'retired', source: `${EXERCISE_SOURCE}；因颈部承压风险已停用，不可用于新推荐` }),

  // ===== 有氧与整理 =====
  E({ id: 'ex-easy-run', name: '轻松跑', type: '跑步', equipment: [], venues: ['户外', '健身房'], minutes: 20, sets: 1, intensity: '中', jumpFree: false, kneeFriendly: false, spineFriendly: true, howto: '保持可对话的节奏', reason: '跑步专项主项；健身房需跑步机', status: 'active', source: EXERCISE_SOURCE }),
  E({ id: 'ex-brisk-walk', name: '快走', type: '跑步', equipment: [], venues: ['户外', '健身房'], minutes: 20, sets: 1, intensity: '低', jumpFree: true, kneeFriendly: true, spineFriendly: true, howto: '步频偏快、心率温和上升', reason: '低冲击替代，不需要跑跳', status: 'active', source: EXERCISE_SOURCE }),
  E({ id: 'ex-ham-stretch', name: '大腿后侧拉伸', type: '舒缓整理', equipment: [], venues: ['宿舍或家', '健身房', '户外'], minutes: 2, sets: 2, holdSeconds: 25, intensity: '低', jumpFree: true, kneeFriendly: true, spineFriendly: true, howto: '坐姿单腿前伸，到轻微牵拉感即止', status: 'active', source: EXERCISE_SOURCE }),
  E({ id: 'ex-breath', name: '腹式呼吸放松', type: '舒缓整理', equipment: [], venues: ['宿舍或家', '健身房', '户外'], minutes: 2, sets: 1, holdSeconds: 60, intensity: '低', jumpFree: true, kneeFriendly: true, spineFriendly: true, howto: '吸气鼓腹，呼气放慢', status: 'active', source: EXERCISE_SOURCE })
]

/** 档案"需要避开的"选项与动作门槛的对应关系 */
export const RESTRICTION_KEYS = ['无跳跃', '膝部负担小', '腰部负担小', '低强度起步'] as const

/**
 * 命中这些限制时保留记录功能，但不进入自动训练推荐流程（文档 §1.3、§7）。
 * 它们不是"动作过滤器"，而是适用范围门槛：系统不据此判断动作是否安全。
 */
export const GATE_RESTRICTIONS = ['孕期或产后', '伤病或遵医嘱限制']

export function gateReason(profile: { restrictions?: string[] } | null): string | null {
  const hit = (profile?.restrictions ?? []).filter(r => GATE_RESTRICTIONS.includes(r))
  if (!hit.length) return null
  return `${hit.join('、')}：可以照常记录训练与三餐，但不生成自动训练推荐。具体安排请遵循专业人员给你的意见，或在计划页手工录入。`
}

export function passesRestrictions(ex: Exercise, restrictions: string[]): string[] {
  const blocked: string[] = []
  for (const r of restrictions) {
    if (r === '无跳跃' && !ex.jumpFree) blocked.push(`${ex.name} 含跑跳，与"无跳跃"冲突`)
    if (r === '膝部负担小' && !ex.kneeFriendly) blocked.push(`${ex.name} 对膝关节压力较大，与"膝部负担小"冲突`)
    if (r === '腰部负担小' && !ex.spineFriendly) blocked.push(`${ex.name} 需要腰部稳定支撑，与"腰部负担小"冲突`)
    if (r === '低强度起步' && ex.intensity === '高') blocked.push(`${ex.name} 强度为高，与"低强度起步"冲突`)
  }
  return blocked
}

/** 器材是否满足：动作不需要器材时任何档案都算满足 */
export function hasEquipment(ex: Exercise, equipment: string[]): boolean {
  if (!ex.equipment.length) return true
  return ex.equipment.some(q => equipment.includes(q))
}

export function activeExercises(): Exercise[] {
  return exercises.filter(e => e.status === 'active')
}

export function findExercise(name: string): Exercise | undefined {
  return exercises.find(e => e.name === name)
}
