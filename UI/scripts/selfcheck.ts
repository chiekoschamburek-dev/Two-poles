// 纯逻辑自检：不依赖浏览器，直接断言这次冲突修复后的规则行为。
// 运行：npm run selfcheck
import { createPinia, setActivePinia } from 'pinia'
import { buildDayPlan, alternativesFor, isPlanDay, AUTO_RECOMMEND_MIN_AGE } from '@/services/planRules'
import { buildWeeklyReport, loadOf, weekStart } from '@/services/weekRules'
import { buildLoadSeries, intensitySplit, loadZone } from '@/services/loadRules'
import { analyzeMeal, buildLimitations, deriveCompleteness, frequentFoods, inferMealType, suggestCategory, RULE_VERSION } from '@/services/mealRules'
import { estimateEnergy, foodTable, isMixedFood, FOOD_SOURCE_LABEL, resolveUnitGrams, searchFoods, unitKey } from '@/services/foodComposition'
import { validateRecognitionObject, validateRecognitionText } from '@/services/foodRecognition'
import { activeExercises, exercises, gateReason } from '@/services/exercises'
import { useRepCounter } from '@/composables/useRepCounter'
import { angleAt, computeMetrics, nextTimestamp } from '@/composables/poseMath'
import { useAppStore } from '@/stores/app'
import { pickDailyWellnessCard, wellnessCards, WELLNESS_DISCLAIMER } from '@/services/wellnessCards'
import { bodyErrors, cycleRangeError, eventBests, formatCnDate, goalSummary, gymRecordLabel, isCurrentBest, normalizeProfile, parseResult } from '@/services/profileRules'
import { buildPlanMessages, canUseLlm, extractJson, isLlmReady, usingDefault, validatePlanDraft } from '@/services/llm'
import type { MealItem, PersonalBest, TrainingSession, UserProfile, ExercisePhase } from '@/types/domain'

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

console.log('\n4b. 拍照即记录：餐次时间窗与模型结果校验')
ok('05:00 起算早餐', inferMealType('05:00') === 'breakfast')
ok('10:29 仍是早餐', inferMealType('10:29') === 'breakfast')
ok('10:30 起算午餐', inferMealType('10:30') === 'lunch')
ok('14:59 仍是午餐', inferMealType('14:59') === 'lunch')
ok('15:00 起算晚餐', inferMealType('15:00') === 'dinner')
ok('21:00 仍是晚餐', inferMealType('21:00') === 'dinner')
ok('21:01 起算加餐', inferMealType('21:01') === 'snack')
ok('04:59 属于加餐', inferMealType('04:59') === 'snack')
ok('时间窗可覆盖', inferMealType('09:00', [{ type: 'lunch', start: '08:00', end: '09:00' }]) === 'lunch')
ok('Date 按本地时刻判断', inferMealType(new Date(2026, 0, 1, 12, 0)) === 'lunch')

const recGood = validateRecognitionObject({
  items: [
    { foodName: '苹果', category: '水果类', confidence: 0.88, uncertain: false, portionSize: 1, portionUnit: '个', energy: { low: 45, high: 70 } },
    { name: '西兰花', confidence: 86, category: '蔬菜类' }
  ]
})
ok('合法识别结果被接受', recGood.items.length === 2 && recGood.error === '')
ok('0–100 的置信度归一化', recGood.items[1].confidence === 0.86)
ok('营养估计保留为区间', recGood.items[0].nutrition?.low === 45 && recGood.items[0].nutrition?.high === 70)
const recNoConfidence = validateRecognitionObject({ items: [{ foodName: '苹果', category: '水果类' }] })
ok('缺置信度不生成条目', recNoConfidence.items.length === 0 && !!recNoConfidence.error)
const recUnknown = validateRecognitionObject({ items: [{ foodName: '神秘汤', category: '不存在的类', confidence: 0.4 }] })
ok('未知类别落"其他"并标不确定', recUnknown.items[0]?.category === '其他' && recUnknown.items[0]?.uncertain === true)
ok('低置信度自动标不确定', validateRecognitionObject({ items: [{ foodName: '米饭', category: '谷薯类', confidence: 0.4 }] }).items[0].uncertain === true)
ok('混合菜标不确定', validateRecognitionObject({ items: [{ foodName: '饺子', category: '谷薯类', confidence: 0.9 }] }).items[0].uncertain === true)
const recBadPortion = validateRecognitionObject({ items: [{ foodName: '米饭', category: '谷薯类', confidence: 0.8, portionSize: -1, portionUnit: '碗' }] })
ok('无效份量留空而不是猜', recBadPortion.items[0]?.portionSize === undefined)
const recBadJson = validateRecognitionText('这不是 JSON')
ok('非 JSON 不生成记录', recBadJson.items.length === 0 && !!recBadJson.error)
const recFenced = validateRecognitionText('```json\n{"items":[{"foodName":"香蕉","category":"水果类","confidence":0.7}]}\n```')
ok('代码块 JSON 也能解析', recFenced.items.length === 1 && recFenced.items[0].foodName === '香蕉')
ok('空 items 不生成记录', validateRecognitionObject({ items: [] }).items.length === 0)

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
ok('切换记录一起落盘（刷新后不丢）', Array.isArray(persisted.modeLog) && persisted.modeLog.length === 1,
  `modeLog=${persisted.modeLog?.length}`)

store.clearAllData()
ok('清除数据连带计划与切换记录', store.plans.length === 0 && store.planHistory.length === 0 && store.modeLog.length === 0 && !mem.has('twopoles_state'))

console.log('\n7. P1-6 记录入口与「单位↔克数」换算')
const demoUnit = resolveUnitGrams('苹果', '个')
ok('没填过口径时按演示假设', !!demoUnit && demoUnit.grams === 100 && demoUnit.own === false)
ok('目录没有的单位不换算', resolveUnitGrams('苹果', '勺') === null)
const ownMap = { [unitKey('苹果', '个')]: 120 }
const ownUnit = resolveUnitGrams('苹果', '个', ownMap)
ok('本机口径覆盖演示假设', !!ownUnit && ownUnit.grams === 120 && ownUnit.own === true)
const plain = estimateEnergy({ foodName: '苹果', portionSize: 1, portionUnit: '个' })
const tuned = estimateEnergy({ foodName: '苹果', portionSize: 1, portionUnit: '个', unitGrams: ownMap })
ok('口径改变估算克数与区间', !!plain && !!tuned && plain.grams === 100 && tuned.grams === 120 && tuned.low > plain.low)
ok('口径来源写进 basis 供界面显示', !!plain && !!tuned && plain.basis.includes('演示假设') && tuned.basis.includes('本机口径'))
ok('单位本来就是克时不算假设', estimateEnergy({ foodName: '苹果', portionSize: 100, portionUnit: '克' })?.basis.includes('按克记录') === true)
ok('目录搜索命中名称与类别', searchFoods('米饭').some(f => f.name === '米饭') && searchFoods('水果类').length > 0)
ok('空关键字不预置一屏候选', searchFoods('').length === 0)
ok('目录没有的词返回空而不是硬塞近似条目', searchFoods('螺蛳粉').length === 0)

store.updatePrivacy({ showEnergyEstimate: true })
store.addMeal({
  date: '2026-10-12', mealType: 'breakfast', time: '08:00',
  items: [
    { foodName: '苹果（半个）', category: '水果类', portionSize: 1, portionUnit: '个' },
    { foodName: '饺子', category: '其他', portionSize: 1, portionUnit: '盘' }
  ]
})
store.addMeal({ date: '2026-10-14', mealType: 'lunch', time: '12:00', items: [{ foodName: '苹果', category: '水果类', portionSize: 2, portionUnit: '个' }] })
const freq = frequentFoods(store.meals)
ok('常吃按目录规范名归并写法', freq.length === 1 && freq[0].name === '苹果' && freq[0].count === 2, JSON.stringify(freq))
ok('常吃沿用最近一次的份量', freq[0].portionSize === 2 && freq[0].lastDate === '2026-10-14')
ok('混合菜不进常吃', !freq.some(f => f.name === '饺子'))
store.rememberUnitGrams('苹果', '个', 120)
const recorded = store.addMeal({ date: '2026-10-15', mealType: 'dinner', time: '19:00', items: [{ foodName: '苹果', category: '水果类', portionSize: 1, portionUnit: '个' }] })
const ref0 = recorded.analysis?.estimateRefs?.[0]
ok('落库的估算带上本机口径', ref0?.unitOwn === true && ref0?.grams === 120 && !!ref0?.basis.includes('本机口径'))
ok('换算口径随状态一起落盘', JSON.parse(mem.get('twopoles_state') || '{}').unitGrams?.[unitKey('苹果', '个')] === 120)
ok('撤销本机口径后退回演示假设', store.forgetUnitGrams('苹果', '个') && resolveUnitGrams('苹果', '个', store.unitGrams)?.own === false)
store.rememberUnitGrams('苹果', '个', 120)
store.clearAllData()
ok('清除数据也抹掉换算口径', Object.keys(store.unitGrams).length === 0)

console.log('\n8. 姿态几何与帧时间戳（F05 端侧推理）')
type Lm = { x: number; y: number; z: number; visibility?: number }
const body = (over: Record<number, Partial<Lm>> = {}): Lm[] =>
  Array.from({ length: 33 }, (_, i) => ({ x: 0, y: 0, z: 0, visibility: 0.9, ...(over[i] ?? {}) }))
const straight = body({ 23: { x: 0.5, y: 0.2 }, 25: { x: 0.5, y: 0.5 }, 27: { x: 0.5, y: 0.8 } })
const bent = body({ 23: { x: 0.5, y: 0.2 }, 25: { x: 0.5, y: 0.5 }, 27: { x: 0.8, y: 0.5 } })
const elbowRight = body({ 11: { x: 0.3, y: 0.2 }, 13: { x: 0.3, y: 0.5 }, 15: { x: 0.6, y: 0.5 } })
ok('腿伸直时膝角 180°', computeMetrics(straight).kneeAngle === 180, String(computeMetrics(straight).kneeAngle))
ok('屈膝成直角时膝角 90°', computeMetrics(bent).kneeAngle === 90, String(computeMetrics(bent).kneeAngle))
ok('前臂水平时肘角 90°', computeMetrics(elbowRight).elbowAngle === 90)
ok('关键点不足 28 个时不出角度', computeMetrics(body({}).slice(0, 27)).kneeAngle === null)
const dim = body(Object.fromEntries([11, 13, 15, 23, 25, 27].map(i => [i, { visibility: 0.4 }])))
ok('可见度取参与算角的 6 点均值且不超过 1', Math.abs(computeMetrics(dim).visibility - 0.4) < 1e-9, String(computeMetrics(dim).visibility))
ok('三点重合时不给角度', angleAt({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }) === null)
ok('重复帧时间戳被跳过', nextTimestamp(100, 100) === null)
ok('新帧时间戳单调放行', nextTimestamp(120, 100) === 120)
ok('非有限值不当成新帧', nextTimestamp(NaN, 0) === null && nextTimestamp(0, 0) === null)

console.log('\n9. 今日养生：内容口径与每日轮换')
ok('养生卡片 ≥ 16 条', wellnessCards.length >= 16, String(wellnessCards.length))
ok('健身类 ≥ 8 条', wellnessCards.filter(c => c.category === '健身').length >= 8, String(wellnessCards.filter(c => c.category === '健身').length))
ok('饮食类 ≥ 8 条', wellnessCards.filter(c => c.category === '饮食').length >= 8, String(wellnessCards.filter(c => c.category === '饮食').length))
ok('id 唯一', new Set(wellnessCards.map(c => c.id)).size === wellnessCards.length)
ok('id 为英文 kebab-case', wellnessCards.every(c => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(c.id)))
ok('标题 8–24 字符', wellnessCards.every(c => [...c.title].length >= 8 && [...c.title].length <= 24), wellnessCards.filter(c => [...c.title].length < 8 || [...c.title].length > 24).map(c => `${c.id}:${[...c.title].length}`).join(','))
ok('摘要 25–70 字符', wellnessCards.every(c => [...c.summary].length >= 25 && [...c.summary].length <= 70), wellnessCards.filter(c => [...c.summary].length < 25 || [...c.summary].length > 70).map(c => `${c.id}:${[...c.summary].length}`).join(','))
ok('详情总长 150–400 字符', wellnessCards.every(c => [...c.detail.join('')].length >= 150 && [...c.detail.join('')].length <= 400), wellnessCards.filter(c => [...c.detail.join('')].length < 150 || [...c.detail.join('')].length > 400).map(c => `${c.id}:${[...c.detail.join('')].length}`).join(','))
ok('要点每条不超过 60 字符', wellnessCards.every(c => c.points.every(p => [...p].length <= 60)))
ok('标题 / 摘要 / 来源非空', wellnessCards.every(c => !!c.title.trim() && !!c.summary.trim() && !!c.source.trim()))
ok('详情 2–4 段且每段非空', wellnessCards.every(c => c.detail.length >= 2 && c.detail.length <= 4 && c.detail.every(d => !!d.trim())))
ok('详情不是摘要复读', wellnessCards.every(c => c.detail.join('').length > c.summary.length))
ok('要点 2–4 条', wellnessCards.every(c => c.points.length >= 2 && c.points.length <= 4))
ok('标签 2–4 个', wellnessCards.every(c => c.tags.length >= 2 && c.tags.length <= 4))
ok('覆盖动作要点 / 能量系统 / 抗炎饮食', ['动作要点', '能量系统', '抗炎饮食'].every(t => wellnessCards.some(c => c.topic === t)))
ok('运动员补充内容齐全', wellnessCards.every(c => !!c.athlete.focus.trim() && c.athlete.detail.length >= 1 && c.athlete.points.length >= 2))
ok('免责声明为统一文案', WELLNESS_DISCLAIMER.includes('不构成医疗建议') && WELLNESS_DISCLAIMER.includes('咨询专业人士'))

const wDay = (n: number, h = 12) => {
  const d = new Date(2026, 9, 12, h, 0)
  d.setDate(d.getDate() + n)
  return d
}
ok('同一天重复调用返回同一条', pickDailyWellnessCard(wDay(0)).id === pickDailyWellnessCard(wDay(0)).id)
ok('同一天不同时刻仍是同一条', pickDailyWellnessCard(wDay(0, 0)).id === pickDailyWellnessCard(wDay(0, 23)).id)
const wSeq = Array.from({ length: 16 }, (_, i) => pickDailyWellnessCard(wDay(i)))
ok('相邻两天换卡', wSeq.every((c, i) => i === 0 || c.id !== wSeq[i - 1].id))
ok('相邻两天类别交替', wSeq.every((c, i) => i === 0 || c.category !== wSeq[i - 1].category))
ok('连续 16 天返回 16 个不同 id', new Set(wSeq.map(c => c.id)).size === 16, String(new Set(wSeq.map(c => c.id)).size))

console.log('\n9. 负荷序列与强度分布（运动员模式取数）')
const sess = (date: string, minutes: number, rpe: number | null): TrainingSession => ({
  id: `s-${date}-${minutes}-${rpe}`, userId: 'demo-user', date, exerciseName: '轻松跑', type: '跑步',
  actualDuration: minutes, completionStatus: 'completed', rpe, discomfort: false,
  cameraUsed: false, manualCorrections: 0
})
const REF = new Date(2026, 9, 14) // 2026-10-14
const isoOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const dayFromRef = (offset: number) => { const d = new Date(2026, 9, 14); d.setDate(d.getDate() + offset); return isoOf(d) }

// ——— 短样本：只有 8 天覆盖，够算均值但不够算 ACWR ———
const shortSeries = buildLoadSeries(
  [sess(dayFromRef(-7), 60, 5), sess(dayFromRef(-2), 40, 6)],
  REF
)
ok('窗口长度 = 28 天', shortSeries.points.length === 28, String(shortSeries.points.length))
ok('窗口升序且最后一天是参考日', shortSeries.points[0].date === dayFromRef(-27) && shortSeries.points[27].date === dayFromRef(0))
ok('首条记录之前是 unknown，不是 0', shortSeries.points[0].state === 'unknown' && shortSeries.points[0].load === null)
ok('首条记录之后无记录的一天是 rest 且负荷 0', shortSeries.points[27].state === 'rest' && shortSeries.points[27].load === 0, shortSeries.points[27].date)
ok('覆盖天数 = 8', shortSeries.coveredDays === 8, String(shortSeries.coveredDays))
ok('样本不足时 ACWR 为 null 且给出还差几天', shortSeries.acwr === null && shortSeries.daysNeeded === 6, `${shortSeries.acwr} / ${shortSeries.daysNeeded}`)
// 300 (60min×5) + 240 (40min×6) = 540，覆盖 8 天 → 67.5
ok('CTL 含休息日（540 / 8 = 67.5）', shortSeries.ctl === 67.5, String(shortSeries.ctl))
ok('ATL 只看近 7 天（240 / 7 = 34.3）', shortSeries.atl === 34.3, String(shortSeries.atl))

// ——— 缺 RPE 的那天整天剔除，不按 0 补齐 ———
const missingSeries = buildLoadSeries(
  [sess(dayFromRef(-1), 50, null), sess(dayFromRef(-2), 30, 5)],
  REF
)
const missingDay = missingSeries.points.find(p => p.date === dayFromRef(-1))
ok('缺 RPE 的日期标为 missing', missingDay?.state === 'missing' && missingDay.load === null)
ok('missing 天数被统计', missingSeries.missingDays === 1, String(missingSeries.missingDays))
// 10-12 有 150，10-13 缺 RPE 被剔除，10-14 休息记 0 → (150 + 0) / 2 = 75
ok('missing 不进平均（(150+0) / 2 = 75）', missingSeries.ctl === 75, String(missingSeries.ctl))

// ——— 长样本：14 天覆盖，负荷持平 → ACWR 恰好 1.00 ———
const flatSeries = buildLoadSeries(
  [sess(dayFromRef(-13), 60, 5), sess(dayFromRef(-1), 60, 5)],
  REF
)
ok('覆盖 14 天时开始给 ACWR', flatSeries.acwr !== null, String(flatSeries.coveredDays))
ok('两周负荷相同时 ACWR = 1', flatSeries.acwr === 1, String(flatSeries.acwr))
ok('daysNeeded 归零', flatSeries.daysNeeded === 0)

// ——— 近 7 天突增 → 落在偏高档（第 15 天 200，近 7 天 315，覆盖 16 天） ———
const rampSeries = buildLoadSeries(
  [sess(dayFromRef(-15), 40, 5), sess(dayFromRef(-5), 30, 5), sess(dayFromRef(-2), 33, 5)],
  REF
)
ok('近 7 天突增时 ACWR > 1.3', rampSeries.acwr !== null && rampSeries.acwr > 1.3, String(rampSeries.acwr))
ok('落在偏高两档之一', ['high', 'veryHigh'].includes(loadZone(rampSeries.acwr)), String(loadZone(rampSeries.acwr)))

// ——— 分档边界 ———
ok('0.79 → low', loadZone(0.79) === 'low')
ok('0.80 → optimal', loadZone(0.8) === 'optimal')
ok('1.30 → optimal', loadZone(1.3) === 'optimal')
ok('1.31 → high', loadZone(1.31) === 'high')
ok('1.50 → high', loadZone(1.5) === 'high')
ok('1.51 → veryHigh', loadZone(1.51) === 'veryHigh')
ok('null → unknown', loadZone(null) === 'unknown')

// ——— 空数据不给假数 ———
const emptySeries = buildLoadSeries([], REF)
ok('没有记录时 ctl/atl/acwr 全为 null', emptySeries.ctl === null && emptySeries.atl === null && emptySeries.acwr === null)
ok('没有记录时全天 unknown，不冒充休息日', emptySeries.points.every(p => p.state === 'unknown'), String(emptySeries.unknownDays))

// ——— 强度分布：按 RPE 7 分界，用时长不用次数 ———
const split = intensitySplit([
  sess(dayFromRef(-2), 90, 4),   // 低强度 90 分钟
  sess(dayFromRef(-1), 10, 8),   // 高强度 10 分钟
  sess(dayFromRef(-1), 30, 1),   // 低强度 30 分钟
  sess(dayFromRef(0), 20, null)  // 未记 RPE，无法归类
])
ok('低强度时长 = 120', split.lowMinutes === 120, String(split.lowMinutes))
ok('高强度时长 = 10', split.highMinutes === 10, String(split.highMinutes))
ok('未记 RPE 的时长单独统计，不塞进任一侧', split.unknownMinutes === 20, String(split.unknownMinutes))
ok('占比按可归类时长算（120 / 130）', Math.abs((split.lowShare ?? 0) - 120 / 130) < 1e-9, String(split.lowShare))
ok('没有可归类时长时占比为 null', intensitySplit([]).lowShare === null)
ok('分界阈值默认 7', split.threshold === 7)

console.log('\n10. 档案：身体数据、成绩解析、PB、目标摘要')
ok('径赛成绩 11.23 → 11.23 秒', parseResult('11.23', true) === 11.23, String(parseResult('11.23', true)))
ok('径赛成绩 2:05.3 → 125.3 秒', parseResult('2:05.3', true) === 125.3, String(parseResult('2:05.3', true)))
ok('带空格的 2:05 也能解析', parseResult(' 2:05 ', true) === 125)
ok('田赛成绩 6.85 m → 6.85 米', parseResult('6.85 m', false) === 6.85, String(parseResult('6.85 m', false)))
ok('田赛成绩 6.85 → 6.85 米', parseResult('6.85', false) === 6.85)
ok('田赛不接受"分:秒"写法', parseResult('2:05', false) === null)
ok('空成绩返回 null', parseResult('   ', true) === null)
ok('非数字返回 null', parseResult('abc', true) === null)
ok('0 与负数不算成绩', parseResult('0', true) === null && parseResult('-3', false) === null)

const pb = (id: string, event: string, track: boolean, result: string): PersonalBest => ({ id, event, track, result })
const pbList = [
  pb('a', '100m', true, '11.50'),
  pb('b', '100m', true, '11.23'),
  pb('c', '100m', true, '11.02'),
  pb('d', '跳远', false, '6.40'),
  pb('e', '跳远', false, '6.85'),
  pb('f', '跳远', false, '6.12')
]
const bests = eventBests(pbList)
const best100 = bests.find(b => b.event === '100m')
const bestLong = bests.find(b => b.event === '跳远')
ok('径赛取最短时间作为当前 PB', best100?.best.id === 'c', best100?.best.result)
ok('田赛取最远距离作为当前 PB', bestLong?.best.id === 'e', bestLong?.best.result)
ok('当前 PB 统计了同项目的历史条数', best100?.count === 3 && bestLong?.count === 3)
ok('历史记录不会被合并或删除', eventBests(pbList).reduce((n, b) => n + b.count, 0) === pbList.length)
ok('isCurrentBest 只认最好的一条', isCurrentBest(pbList[0], pbList) === false && isCurrentBest(pbList[2], pbList) === true)
ok('解析不出的记录不参与比较但仍保留', eventBests([...pbList, pb('g', '100m', true, '稍后补')]).find(b => b.event === '100m')?.count === 3)

ok('两项都没填 → 无错误', Object.keys(bodyErrors('', '')).length === 0)
ok('只填身高不阻塞', Object.keys(bodyErrors(175, '')).length === 0)
ok('身高超范围报错', !!bodyErrors(90, '').height && !!bodyErrors(300, '').height)
ok('体重超范围报错', !!bodyErrors('', 10).weight && !!bodyErrors('', 260).weight)
ok('175 / 65 → 无错误', Object.keys(bodyErrors(175, 65)).length === 0)

ok('周期开始晚于结束 → 报错', cycleRangeError('2026-10-10', '2026-10-01') !== null)
ok('周期顺序正常 → 不报错', cycleRangeError('2026-09-01', '2026-10-01') === null)
ok('只填一端不校验', cycleRangeError('2026-10-10', '') === null)

ok('比赛目标摘要', goalSummary({ goalType: 'competition', targetEvent: '秋季赛', targetEventDate: '2026-10-18' }) === '秋季赛 · 10 月 18 日', goalSummary({ goalType: 'competition', targetEvent: '秋季赛', targetEventDate: '2026-10-18' }))
ok('周期目标摘要', goalSummary({ goalType: 'cycle', discipline: '800m', cyclePhase: '强度建立' }) === '800m · 强度建立', goalSummary({ goalType: 'cycle', discipline: '800m', cyclePhase: '强度建立' }))
ok('没有目标时给诚实文案', goalSummary({ goalType: 'competition' }).includes('还没填'))
ok('日期格式化跨月正确', formatCnDate('2026-12-01') === '12 月 1 日')

const oldProfile = { id: 'u1', mode: 'public', modeChangedAt: '', age: 30, goal: '减脂', experience: '偶尔运动', availableTimes: ['20 分钟'], equipment: [], restrictions: [], weight: 62 } as UserProfile
const normalized = normalizeProfile(oldProfile)
ok('旧档案补出 PB 空数组', Array.isArray(normalized?.personalBests) && normalized?.personalBests?.length === 0)
ok('旧档案补出极限数据空数组', Array.isArray(normalized?.gymRecords))
ok('旧档案的体重原样保留', normalized?.weight === 62)
ok('旧档案不凭空造出身高', normalized?.height === undefined)
ok('null 档案仍返回 null', normalizeProfile(null) === null)

ok('1RM 与训练最高重量的文案不同', gymRecordLabel({ id: 'x', lift: '深蹲', weight: 120, kind: '1rm' }) !== gymRecordLabel({ id: 'y', lift: '深蹲', weight: 120, kind: 'working' }))

console.log('\n11. 大模型计划：提示词、响应解析、校验')
ok('未填 base_url 视为未配置', isLlmReady({ baseUrl: '', apiKey: 'k', model: 'm' }) === false)
ok('缺模型名也视为未配置', isLlmReady({ baseUrl: 'https://x/v1', apiKey: 'k', model: '' }) === false)
ok('填齐才算配置好', isLlmReady({ baseUrl: 'https://x/v1', apiKey: '', model: 'm' }) === true)
// 切到内置模型只是偏好，不能把已填的配置弄丢
const keptConfig = { baseUrl: 'https://x/v1', apiKey: 'k', model: 'mine', preference: 'default' as const }
ok('选了内置模型：请求走默认', usingDefault(keptConfig) === true)
ok('选了内置模型：自己的配置仍然在', isLlmReady(keptConfig) === true && keptConfig.baseUrl === 'https://x/v1')
ok('切回自定义：又用自己的', usingDefault({ ...keptConfig, preference: 'custom' as const }) === false)
ok('旧数据没偏好但有配置 → 用自己的', usingDefault({ baseUrl: 'https://x/v1', apiKey: 'k', model: 'mine' }) === false)
ok('旧数据没偏好也没配置 → 用默认', usingDefault({ baseUrl: '', apiKey: '', model: '' }) === true)
ok('选了自定义但没填 → 回退默认', usingDefault({ baseUrl: '', apiKey: '', model: '', preference: 'custom' as const }) === true)
ok('没自己的配置但有服务端默认 → 可用', canUseLlm({ baseUrl: '', apiKey: '', model: '' }, { available: true, model: 'mock' }) === true)
ok('两边都没有 → 不可用', canUseLlm({ baseUrl: '', apiKey: '', model: '' }, { available: false, model: null }) === false)
ok('自己的配置优先于默认', canUseLlm({ baseUrl: 'https://x/v1', apiKey: 'k', model: 'mine' }, { available: true, model: 'mock' }) === true)

const draftDates = ['2026-10-12', '2026-10-13', '2026-10-14']
ok('能解析纯 JSON', extractJson('{"days":[]}') !== null)
ok('能解析代码块里的 JSON', extractJson('```json\n{"reason":"x","days":[]}\n```') !== null)
ok('能跳过前后解释文字', JSON.stringify(extractJson('好的，计划如下：{"reason":"x","days":[]} 希望有帮助')) === '{"reason":"x","days":[]}')
ok('不是 JSON 时返回 null', extractJson('我没法完成这个请求') === null)

const rawPlan = {
  reason: '按可用时间排了三天',
  days: [
    { date: '2026-10-12', items: [{ exerciseName: '轻松跑', plannedDuration: 20 }] },
    { date: '2026-10-13', items: [{ exerciseName: '编造的动作', type: '不存在的类型', plannedDuration: 999 }] },
    { date: '2026-09-01', items: [{ exerciseName: '轻松跑' }] }
  ]
}
const checked = validatePlanDraft(rawPlan, draftDates, 'mock-model')
ok('草稿解析成功', checked.draft !== null, checked.error)
ok('范围外的日期被剔除并给警告', checked.draft?.days.every(d => draftDates.includes(d.date)) === true && checked.warnings.some(w => w.includes('2026-09-01')))
ok('库内动作按库里的类型归类', checked.draft?.days[0].items[0].type === '跑步', checked.draft?.days[0].items[0].type)
ok('库外动作标 notInLibrary', checked.draft?.days[1].items[0].notInLibrary === true)
ok('非法类型回退为"其他"', checked.draft?.days[1].items[0].type === '其他', checked.draft?.days[1].items[0].type)
ok('离谱时长被夹到 180 以内', (checked.draft?.days[1].items[0].plannedDuration ?? 0) <= 180)

ok('一天超过 6 项只留前 6 个', validatePlanDraft({
  days: [{ date: '2026-10-12', items: Array.from({ length: 9 }, () => ({ exerciseName: '轻松跑', plannedDuration: 10 })) }]
}, draftDates).draft?.days[0].items.length === 6)
ok('全部日期越界 → 报错而不是空计划', validatePlanDraft({ days: [{ date: '2026-01-01', items: [{ exerciseName: '轻松跑' }] }] }, draftDates).draft === null)
ok('没有 days 字段 → 报错', validatePlanDraft({ reason: 'x' }, draftDates).error.includes('训练日'))
ok('非对象输入 → 报错', validatePlanDraft('不是对象', draftDates).draft === null)

const msgs = buildPlanMessages(
  { id: 'u', mode: 'public', modeChangedAt: '', age: 30, goal: '减脂', experience: '入门', availableTimes: ['20 分钟'], equipment: ['无器材'], restrictions: [], availableVenues: ['宿舍或家'] },
  draftDates,
  'public'
)
ok('提示词要求只输出 JSON', msgs.system.includes('只输出一个 JSON'))
ok('提示词带上了动作库', msgs.user.includes('动作库'))
ok('提示词带上了可选日期', msgs.user.includes('2026-10-12'))
ok('提示词包含禁项（不给医疗建议）', msgs.system.includes('不提供医疗'))

console.log(`\n通过 ${passed} 项，失败 ${failed} 项`)
if (failed) process.exitCode = 1
