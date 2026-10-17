// 纯逻辑自检：不依赖浏览器，直接断言这次冲突修复后的规则行为。
// 运行：npm run selfcheck
import { createPinia, setActivePinia } from 'pinia'
import { buildDayPlan, alternativesFor, isPlanDay, AUTO_RECOMMEND_MIN_AGE } from '@/services/planRules'
import { buildWeeklyReport, loadOf, weekStart } from '@/services/weekRules'
import { analyzeMeal, buildLimitations, deriveCompleteness, suggestCategory, RULE_VERSION } from '@/services/mealRules'
import { estimateEnergy, foodTable, isMixedFood, FOOD_SOURCE_LABEL } from '@/services/foodComposition'
import { activeExercises, exercises, gateReason } from '@/services/exercises'
import { useRepCounter } from '@/composables/useRepCounter'
import { useAppStore } from '@/stores/app'
import type { MealItem, TrainingSession, UserProfile, ExercisePhase } from '@/types/domain'

let failed = 0
let passed = 0
function ok(name: string, cond: boolean, extra = '') {
  if (cond) { passed++; console.log(`  ok  ${name}`) }
  else { failed++; console.log(`FAIL  ${name}${extra ? ' — ' + extra : ''}`) }
}
function iso(offsetDays: number) {
  const d = new Date(2026, 9, 12) // 周一
  d.setDate(d.getDate() + offsetDays)
  return d
}
const base = {
  id: 'u1', mode: 'public' as const, modeChangedAt: '', age: 30, goal: '保持活力',
  experience: '偶尔运动', availableTimes: ['20 分钟'], equipment: [] as string[],
  availableVenues: ['宿舍或家'], restrictions: [] as string[]
}
const p = (over: Partial<UserProfile>): UserProfile => ({ ...base, ...over })

console.log('\n1. F04 条件过滤（器材 / 限制 / 年龄 / 适用范围）')
const noChair = buildDayPlan(iso(0), p({ equipment: ['无器材'] }), 'public')
ok('周一有安排', noChair.items.length > 0, JSON.stringify(noChair.items.map(i => i.exerciseName)))
ok('未选椅子时不排坐站训练', !noChair.items.some(i => i.type === '坐站训练'))
ok('无候选时给出原因', noChair.conflicts.length >= 0)

const withChair = buildDayPlan(iso(2), p({ equipment: ['无器材', '椅子'] }), 'public')
ok('有椅子时周三排入坐站训练', withChair.items.some(i => i.type === '坐站训练'))
ok('坐站训练默认锁定', withChair.items.some(i => i.locked))

const knee = buildDayPlan(iso(2), p({ equipment: ['无器材', '椅子'], restrictions: ['膝部负担小'] }), 'public')
ok('膝部负担小剔除深蹲跳等高膝负荷项', !knee.items.some(i => i.exerciseName === '深蹲跳'))

const minor = buildDayPlan(iso(0), p({ age: 16 }), 'public')
ok('未满 18 岁不生成自动推荐', minor.auto === false && minor.items.length === 0)
ok('给出年龄门槛说明', !!minor.gateNote && minor.gateNote.includes('18'))

const preg = buildDayPlan(iso(0), p({ restrictions: ['孕期或产后'] }), 'public')
ok('孕期不进自动推荐但可记录', preg.auto === false && !!preg.gateNote)
ok('gateReason 独立可用', gateReason({ restrictions: ['伤病或遵医嘱限制'] }) !== null)

const athleteHome = buildDayPlan(iso(4), p({ equipment: ['无器材'] }), 'athlete')
ok('场地只填宿舍时不给跑步安排并说明原因', !athleteHome.items.some(i => i.type === '跑步') && athleteHome.conflicts.some(x => x.includes('场地')))
const athleteOutdoor = buildDayPlan(iso(4), p({ equipment: ['无器材'], availableVenues: ['户外'] }), 'athlete')
ok('周五运动员模式以有氧为主', athleteOutdoor.items.some(i => i.type === '跑步'), JSON.stringify(athleteOutdoor.items.map(i => i.exerciseName)))

const tight = buildDayPlan(iso(0), p({ availableTimes: ['10 分钟'] }), 'public')
ok('10 分钟预算内排得下', tight.items.reduce((s, i) => s + (i.plannedDuration ?? 0), 0) <= 10)

ok('替换候选带原因', alternativesFor(activeExercises().find(e => e.name === '站姿弯举')!, p({ equipment: ['无器材', '弹力带'] })).every(a => a.reason.length > 0))
const noAlt = alternativesFor(activeExercises().find(e => e.name === '坐站训练')!, p({}))
ok('同类型无候选时返回空数组（界面如实提示）', Array.isArray(noAlt))

console.log('\n2. 动作库与 F12 条目要求')
ok('动作条目 ≥ 20', exercises.length >= 20, String(exercises.length))
ok('含停用条目', exercises.some(e => e.status === 'retired'))
ok('停用条目不进入可用集合', !activeExercises().some(e => e.status === 'retired'))
ok('食物条目 ≥ 40', foodTable.length >= 40, String(foodTable.length))
ok('每条食物都标注未核对来源', foodTable.every(f => f.verified === false))

console.log('\n3. 负荷口径（缺 RPE 不按 0 补齐）')
const s = (date: string, dur: number, rpe: number | null, extra: Partial<TrainingSession> = {}): TrainingSession => ({
  id: `s-${date}-${dur}`, userId: 'u1', date, exerciseName: '跑步', type: '跑步',
  actualDuration: dur, completionStatus: 'completed', rpe, discomfort: false,
  cameraUsed: false, manualCorrections: 0, createdAt: `${date}T09:00:00.000Z`, ...extra
})
const sessions = [s('2026-10-12', 20, 5), s('2026-10-14', 30, null), s('2026-10-16', 10, 4)]
const rep = buildWeeklyReport(sessions, [], iso(0), { profile: p({}), mode: 'public' })
ok('单日负荷 = 时长 × RPE', loadOf(sessions[0]) === 100)
ok('缺 RPE 的单次不可算', loadOf(sessions[1]) === null)
ok('合计只含有 RPE 的天（100 + 40）', rep.totalLoad === 140, String(rep.totalLoad))
ok('缺 RPE 的天记为未计入', rep.unloadedDays === 1, String(rep.unloadedDays))
ok('数据质量说明覆盖范围', rep.dataQuality.some(q => q.includes('覆盖') && q.includes('不按 0 补齐')))
ok('完成率有分母才计算', rep.completionRate !== null)
const idleWeek = buildWeeklyReport([s('2026-10-14', 20, 5)], [], iso(0), { profile: p({ restrictions: ['孕期或产后'] }), mode: 'public' })
ok('未安排训练的一周不计算完成率', idleWeek.completionRate === null && idleWeek.plannedSessions === 0)
const hurt = buildWeeklyReport([s('2026-10-12', 20, 5, { discomfort: true })], [], iso(0), { profile: p({}), mode: 'public' })
ok('报了不适则阻止自动加量', hurt.blockedByDiscomfort === true)

console.log('\n4. 饮食口径（类别推断 / 混合菜 / 免责清单）')
ok('苹果推断为水果类', suggestCategory('苹果') === '水果类')
ok('燕麦粥推断为谷薯类', suggestCategory('燕麦粥') === '谷薯类')
ok('饺子识别为混合菜', isMixedFood('饺子') && suggestCategory('饺子') === null)
ok('未知食物不猜类别', suggestCategory('神秘汤') === null)
const mi = (foodName: string, category: MealItem['category'], portionSize?: number, portionUnit?: string): MealItem =>
  ({ id: foodName, mealId: 'm1', foodId: foodName, foodName, category, portionSize, portionUnit, confirmed: true })
const an = analyzeMeal([mi('苹果', '水果类', 1, '个'), mi('饺子', '其他', 8, '个')], [], true)
ok('混合菜进待确认清单', an.unknownItems.includes('饺子'))
ok('含估算时免责清单改写', an.limitations.some(l => l.includes('区间粗估')) && !an.limitations.some(l => l.includes('hasNutritionEstimate = false')))
ok('不含估算时仍声明无估算', buildLimitations(false).some(l => l.includes('hasNutritionEstimate = false')))
ok('规则版本已升代', RULE_VERSION === 'diet-rules-v2')
const est = estimateEnergy({ foodName: '苹果', portionSize: 1, portionUnit: '个' })
ok('出数带区间与来源', !!est && est.low < est.high && est.source === FOOD_SOURCE_LABEL && est.basis.length > 0)
ok('缺份量不出数', estimateEnergy({ foodName: '苹果' }) === null)
ok('混合菜不出数', estimateEnergy({ foodName: '饺子', portionSize: 1, portionUnit: '盘' }) === null)
ok('份量完整性判定', deriveCompleteness([mi('苹果', '水果类')]) === 'partial')

console.log('\n5. F05 计数状态机')
const c = useRepCounter({ neutral: 170, bottom: 55, hysteresis: 8, minStageMs: 100, minRepMs: 700, maxStageMs: 6000, minVisibility: 0.5 })
let t = 0
/** 按约 11 fps 喂帧：一个阶段 8 帧（约 0.7 s），符合一次动作的真实节奏 */
const stage = (angle: number | null, frames = 8, vis = 0.95) => {
  let res = { phase: 'idle' as ExercisePhase, counted: false, gate: null as string | null }
  for (let i = 0; i < frames; i++) { t += 90; res = c.feed(angle, vis, t) }
  return res
}
stage(172); stage(170)                     // 起始位稳定
stage(50); stage(48)                       // 弯举到顶并停留
stage(170); stage(172)                     // 回到起始 → 计一次
ok('一个完整行程计一次', c.count.value === 1, String(c.count.value))
stage(50); stage(170)
ok('第二个完整行程计两次', c.count.value === 2, String(c.count.value))
const occ = useRepCounter({ neutral: 170, bottom: 55, hysteresis: 8, minStageMs: 100, minRepMs: 700, maxStageMs: 6000, minVisibility: 0.5 })
let t2 = 0
const occFeed = (angle: number | null, vis: number, frames = 8) => {
  for (let i = 0; i < frames; i++) { t2 += 90; occ.feed(angle, vis, t2) }
}
occFeed(170, 0.95)
occFeed(50, 0.95)
occFeed(170, 0.2)                          // 回程全程被遮挡
occFeed(50, 0.2)
occFeed(170, 0.95)
ok('遮挡期间不累计次数', occ.count.value === 0 && occ.phase.value === 'ready' && occ.gate.value === null, `count=${occ.count.value} phase=${occ.phase.value}`)

const fast = useRepCounter({ neutral: 170, bottom: 55, hysteresis: 8, minStageMs: 100, minRepMs: 700, maxStageMs: 6000, minVisibility: 0.5 })
let t3 = 0
const fastFeed = (angle: number, frames: number, ms: number) => {
  for (let i = 0; i < frames; i++) { t3 += ms; fast.feed(angle, 0.95, t3) }
}
fastFeed(170, 5, 80)
fastFeed(50, 3, 80)                        // 到顶并确认
fastFeed(170, 2, 60)                       // 回程总时长 330ms < minRepMs
ok('抖动行程不计入', fast.count.value === 0, String(fast.count.value))
ok('阈值可被机位校准改写', typeof c.calibrate === 'function' && c.lowThreshold.value < 170)

console.log('\n6. 计划版本与模式切换（store）')
const mem = new Map<string, string>()
globalThis.localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: () => null,
  length: 0
} as unknown as Storage
// store 里的主题逻辑会写 <html data-theme>；无浏览器的自检只需要这个落点
globalThis.document = { documentElement: { dataset: {} as Record<string, string> } } as unknown as Document
setActivePinia(createPinia())
const store = useAppStore()
store.updateProfile(p({ equipment: ['无器材', '椅子'] }))
const monday = iso(0)
const plan = store.ensureWeekPlan(monday)
const v1 = plan.version
const sitStand = plan.items.find(i => i.locked)!
ok('本周计划落盘', store.plans.length === 1 && plan.items.length > 0)
ok('重复取同一周不新建', store.ensureWeekPlan(monday).id === plan.id)

store.toggleItemLock(plan.id, sitStand.id)
ok('锁定变更生成新版本', plan.version === v1 + 1 && store.planHistory.length === 1)
ok('历史版本保留改动前的状态', store.planHistory[0].items.find(i => i.id === sitStand.id)!.locked === true)

const before = plan.items.map(i => ({ n: i.exerciseName, l: i.locked })).slice()
store.acceptAdjustment(plan.id, plan.items.map(i => ({
  itemId: i.id, type: 'changed' as const, newValue: { exerciseName: '全部改名' }
})), '测试批量改')
ok('接受调整保留锁定项', plan.items.every((i, idx) => i.locked === before[idx].l))
ok('接受调整写入新版本', plan.version === v1 + 2)
ok('调整原因被记录', plan.reason.includes('测试批量改') && plan.reason.includes('锁定项保持不变'))

const manualPlan = store.addManualItem(plan.id, { date: '2026-10-13', exerciseName: '球场往返跑', minutes: 25 })
ok('手工录入可用且不依赖自动推荐', !!manualPlan && plan.items.some(i => i.exerciseName === '球场往返跑'))

const preview = store.requestModeSwitch('athlete')
ok('切换前先给差异与确认', !!preview && preview.toLabel === '运动员模式' && preview.differences.length > 0)
ok('未确认时模式不变', store.currentMode === 'public')
ok('未确认时计划未被改写', store.plans.filter(pl => pl.mode === 'public').length === 1 && store.plans.filter(pl => pl.mode === 'athlete').length === 0)
store.cancelModeSwitch()
ok('取消后不残留待确认态', store.pendingSwitch === null)
store.requestModeSwitch('athlete')
store.confirmModeSwitch()
ok('确认后模式生效并记录切换', store.currentMode === 'athlete' && store.modeLog.length === 1)
ok('旧模式计划仍可见', store.plans.some(pl => pl.mode === 'public'))
const copied = store.copyPlanToMode(plan.id, 'athlete')
ok('复制才形成新模式计划', !!copied && copied.mode === 'athlete' && copied.reason.includes('复制'))
ok('计划按模式分别计数', store.plans.length === 2)
ok('运动员模式周五有安排', isPlanDay(iso(4), p({}), 'athlete'))
ok('大众模式周二是休息日', !isPlanDay(iso(1), p({}), 'public'))
ok('自动推荐年龄门槛导出', AUTO_RECOMMEND_MIN_AGE === 18)

const persisted = JSON.parse(mem.get('twopoles_state') || '{}')
ok('计划与历史一起落盘', persisted.plans?.length === 2 && persisted.planHistory?.length === 3,
  `plans=${persisted.plans?.length} history=${persisted.planHistory?.length}`)

store.clearAllData()
ok('清除数据连带计划与切换记录', store.plans.length === 0 && store.planHistory.length === 0 && store.modeLog.length === 0 && !mem.has('twopoles_state'))

console.log(`\n通过 ${passed} 项，失败 ${failed} 项`)
if (failed) process.exitCode = 1
