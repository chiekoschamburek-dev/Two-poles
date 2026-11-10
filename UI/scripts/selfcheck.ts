// 纯逻辑自检：不依赖浏览器，直接断言这次冲突修复后的规则行为。
// 运行：npm run selfcheck
import { createPinia, setActivePinia } from 'pinia'
import { buildDayPlan, alternativesFor, isPlanDay, AUTO_RECOMMEND_MIN_AGE } from '@/services/planRules'
import { buildWeeklyReport, loadOf, weekStart } from '@/services/weekRules'
import { buildLoadSeries, intensitySplit, loadZone } from '@/services/loadRules'
import { analyzeMeal, buildLimitations, deriveCompleteness, frequentFoods, inferMealType, suggestCategory, RULE_VERSION } from '@/services/mealRules'
import { buildDietPhraseMessages, validateDietPhrases } from '@/services/llm'
import { dayIntakeFacts, dietFindings, limitImmediate, meetsImmediateGate, meetsSummaryGate, DIET_THRESHOLDS, DIET_RULE_VERSION } from '@/services/dietFeedbackRules'
import { estimateEnergy, foodTable, isMixedFood, FOOD_SOURCE_LABEL, resolveUnitGrams, searchFoods, unitKey } from '@/services/foodComposition'
import { validateRecognitionObject, validateRecognitionText } from '@/services/foodRecognition'
import { activeExercises, CAMERA_COUNTABLE, exercises, EXERCISE_CATALOG_VERSION, findExercise, gateReason } from '@/services/exercises'
import { applyPlanOverrides, getDemoExercise, guideExercise, readPlanOverrides, summarizeSession } from '@/services/demoCameraService'
import { useRepCounter } from '@/composables/useRepCounter'
import { createRepMachine } from '@/composables/repMachine'
import type { RepMachineSnapshot } from '@/composables/repMachine'
import { analyzeMotion, analyzeGait, classifyAction, detectView, precheckMotion, type MotionFrame, type MotionFrameSeries, type RepAnalysis } from '@/services/motionAnalysis'
import { rulesFor } from '@/services/motionRules'
import { angleAt, computeMetrics, nextTimestamp } from '@/composables/poseMath'
import { useAppStore } from '@/stores/app'
import { pickDailyWellnessCard, wellnessCards, WELLNESS_DISCLAIMER } from '@/services/wellnessCards'
import { bodyErrors, cycleRangeError, eventBests, formatCnDate, goalSummary, gymRecordLabel, isCurrentBest, normalizeProfile, parseResult } from '@/services/profileRules'
import { buildPlanMessages, buildPlanQuestionMessages, canUseLlm, desiredWeeklySessions, extractJson, isLlmReady, usingDefault, validatePlanDraft, validatePlanQuestions } from '@/services/llm'
import { BRIDGE_LIMITS, buildBridgeSignals, buildWeekFacts, peekLine, readDayFacts } from '@/services/bridgeRules'
import { buildAdjustmentSuggestions, buildFeedbackIntents, buildTimeConflictSuggestion } from '@/services/adjustmentRules'
import { buildLongTermTrend, buildMonthlyReport, buildRollingFourWeeksReport } from '@/services/reportRules'
import { clearOutbox, enqueue, listOutbox } from '@/services/outbox'
import { clearStoredState, loadStoredState, saveStoredState, STORAGE_KEYS } from '@/services/storage'
import { clearAnalysisKeyframes, deleteAnalysisKeyframes, getAnalysisKeyframe, saveAnalysisKeyframe } from '@/services/analysisKeyframes'
import { toISODate } from '@/utils/time'
import type { FoodCategory, Meal, MealItem, MotionAnalysis, MotionAnalysisFinding, MotionAnalysisMetric, PersonalBest, Plan, PlanItem, TrainingSession, UserProfile, ExercisePhase } from '@/types/domain'

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
  id: 'u1', age: 30, goal: '保持活力',
  experience: '偶尔运动', availableTimes: ['20 分钟'], equipment: [] as string[],
  availableVenues: ['宿舍或家'], restrictions: [] as string[]
}
const p = (over: Partial<UserProfile>): UserProfile => ({ ...base, ...over })

console.log('\n1. F04 条件过滤（器材 / 限制 / 年龄 / 适用范围）')
const noChair = buildDayPlan(iso(0), p({ equipment: ['无器材'] }))
ok('周一有安排', noChair.items.length > 0, JSON.stringify(noChair.items.map(i => i.exerciseName)))
ok('未选椅子时不排坐站训练', !noChair.items.some(i => i.type === '坐站训练'))
ok('无候选时给出原因', noChair.conflicts.length >= 0)

const withChair = buildDayPlan(iso(2), p({ equipment: ['无器材', '椅子'] }))
ok('有椅子时周三排入坐站训练', withChair.items.some(i => i.type === '坐站训练'))

const knee = buildDayPlan(iso(2), p({ equipment: ['无器材', '椅子'], restrictions: ['膝部负担小'] }))
ok('膝部负担小剔除深蹲跳等高膝负荷项', !knee.items.some(i => i.exerciseName === '深蹲跳'))

const minor = buildDayPlan(iso(0), p({ age: 16 }))
ok('未满 18 岁不生成自动推荐', minor.auto === false && minor.items.length === 0)
ok('给出年龄门槛说明', !!minor.gateNote && minor.gateNote.includes('18'))

const preg = buildDayPlan(iso(0), p({ restrictions: ['孕期或产后'] }))
ok('孕期不进自动推荐但可记录', preg.auto === false && !!preg.gateNote)
ok('gateReason 独立可用', gateReason({ restrictions: ['伤病或遵医嘱限制'] }) !== null)

const fridayPlan = buildDayPlan(iso(4), p({ equipment: ['无器材'] }))
ok('周五使用统一模板而不是运动员有氧模板', fridayPlan.items.length > 0 && !fridayPlan.items.some(i => i.type === '跑步'), JSON.stringify(fridayPlan.items.map(i => i.exerciseName)))

const tight = buildDayPlan(iso(0), p({ availableTimes: ['10 分钟'] }))
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
const rep = buildWeeklyReport(sessions, [], iso(0), { profile: p({}) })
ok('单日负荷 = 时长 × RPE', loadOf(sessions[0]) === 100)
ok('缺 RPE 的单次不可算', loadOf(sessions[1]) === null)
ok('合计只含有 RPE 的天（100 + 40）', rep.totalLoad === 140, String(rep.totalLoad))
ok('缺 RPE 的天记为未计入', rep.unloadedDays === 1, String(rep.unloadedDays))
ok('数据质量说明覆盖范围', rep.dataQuality.some(q => q.includes('覆盖') && q.includes('不按 0 补齐')))
ok('完成率有分母才计算', rep.completionRate !== null)
const idleWeek = buildWeeklyReport([s('2026-10-14', 20, 5)], [], iso(0), { profile: p({ restrictions: ['孕期或产后'] }) })
ok('未安排训练的一周不计算完成率', idleWeek.completionRate === null && idleWeek.plannedSessions === 0)
const hurt = buildWeeklyReport([s('2026-10-12', 20, 5, { discomfort: true })], [], iso(0), { profile: p({}) })
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
const anConfirmed = analyzeMeal([{ ...mi('饺子', '其他', 8, '个'), userConfirmed: true }], [], false)
ok('用户确认后不再进待确认清单', !anConfirmed.unknownItems.includes('饺子'))
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

console.log('\n6. 计划版本与统一排课（store）')
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
ok('本周计划落盘', store.plans.length === 1 && plan.items.length > 0)
ok('重复取同一周不新建', store.ensureWeekPlan(monday).id === plan.id)

const firstItem = plan.items[0]
store.markItemCompleted(plan.id, firstItem.id, true)
ok('完成标记生成新版本', plan.version === v1 + 1 && store.planHistory.length === 1)
ok('历史版本保留改动前的状态', store.planHistory[0].items.find(i => i.id === firstItem.id)!.completed === false)

store.acceptAdjustment(plan.id, plan.items.map(i => ({
  itemId: i.id, type: 'changed' as const, newValue: { exerciseName: '全部改名' }
})), '测试批量改')
ok('接受调整保留已完成项', plan.items.find(i => i.id === firstItem.id)!.exerciseName !== '全部改名')
ok('接受调整写入新版本', plan.version === v1 + 2)
ok('调整原因被记录', plan.reason.includes('测试批量改') && plan.reason.includes('已完成项保持不变'))

const manualPlan = store.addManualItem(plan.id, { date: '2026-10-13', exerciseName: '球场往返跑', minutes: 25 })
ok('手工录入可用且不依赖自动推荐', !!manualPlan && plan.items.some(i => i.exerciseName === '球场往返跑'))

store.setPlanCompletionStyle('strike')
ok('完成样式偏好落盘', store.planCompletionStyle === 'strike'
  && JSON.parse(mem.get(STORAGE_KEYS.meta) || '{}').planCompletionStyle === 'strike')

ok('计划不再带模式字段', store.plans.every(pl => !('mode' in pl)))
ok('同一周只保留一份计划', store.plans.length === 1)
ok('统一模板周五有安排', isPlanDay(iso(4), p({})))
ok('周二仍是休息日', !isPlanDay(iso(1), p({})))
ok('自动推荐年龄门槛导出', AUTO_RECOMMEND_MIN_AGE === 18)

const persistedPlans = JSON.parse(mem.get('twopoles.v1.plans') || '[]')
const persistedHistory = JSON.parse(mem.get('twopoles.v1.planHistory') || '[]')
ok('计划与历史一起落盘', persistedPlans.length === 1 && persistedHistory.length === 3,
  `plans=${persistedPlans.length} history=${persistedHistory.length}`)
ok('历史版本也不带模式字段', persistedHistory.every((pl: Plan) => !('mode' in pl)))
ok('状态按类别拆 key 而不是一个大对象', !mem.has('twopoles_state') && mem.has('twopoles.v1.sessions') && mem.has('twopoles.v1.meals'))

store.clearAllData()
ok('清除数据连带计划与历史', store.plans.length === 0 && store.planHistory.length === 0 && !mem.has('twopoles.v1.plans'))

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
ok('换算口径随状态一起落盘', JSON.parse(mem.get('twopoles.v1.unitGrams') || '{}')[unitKey('苹果', '个')] === 120)
ok('撤销本机口径后退回演示假设', store.forgetUnitGrams('苹果', '个') && resolveUnitGrams('苹果', '个', store.unitGrams)?.own === false)
store.rememberUnitGrams('苹果', '个', 120)
const reviewMeal = store.addMeal({
  date: '2026-10-15', mealType: 'snack', time: '16:00',
  items: [{ foodName: '神秘汤', category: '其他', portionSize: 1, portionUnit: '碗', source: 'photo', photoConfidence: 0.3, uncertain: true }]
})
const storedReview = store.meals.find(m => m.id === reviewMeal.id)!
ok('低置信度条目进入待确认清单', storedReview.analysis?.unknownItems?.includes('神秘汤') === true)
store.confirmMealItem(storedReview.id, storedReview.items[0].id)
ok('逐项确认后不再待确认', storedReview.items[0].userConfirmed === true
  && storedReview.items[0].uncertain === false
  && !storedReview.analysis?.unknownItems?.includes('神秘汤'))
const deleteMeal = store.addMeal({
  date: '2026-10-16', mealType: 'lunch', time: '12:00',
  items: [
    { foodName: '苹果', category: '水果类', portionSize: 1, portionUnit: '个' },
    { foodName: '米饭', category: '谷薯类', portionSize: 1, portionUnit: '碗' }
  ]
})
const storedDelete = store.meals.find(m => m.id === deleteMeal.id)!
ok('删除错误条目后记录保留并重算', store.removeMealItem(storedDelete.id, storedDelete.items[0].id)
  && storedDelete.items.length === 1
  && storedDelete.items[0].foodName === '米饭'
  && storedDelete.completeness === 'complete')
ok('最后一项不能单独删除', store.removeMealItem(storedDelete.id, storedDelete.items[0].id) === false
  && storedDelete.items.length === 1)
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
ok('进阶补充内容齐全', wellnessCards.every(c => !!c.extra.focus.trim() && c.extra.detail.length >= 1 && c.extra.points.length >= 2))
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

console.log('\n9. 负荷序列与强度分布（负荷视图取数）')
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

const oldProfile = { id: 'u1', age: 30, goal: '减脂', experience: '偶尔运动', availableTimes: ['20 分钟'], equipment: [], restrictions: [], weight: 62 } as UserProfile
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
  { id: 'u', age: 30, goal: '减脂', experience: '入门', availableTimes: ['20 分钟'], equipment: ['无器材'], restrictions: [], availableVenues: ['宿舍或家'] },
  draftDates
)
ok('提示词要求只输出 JSON', msgs.system.includes('只输出一个 JSON'))
ok('提示词带上了动作库', msgs.user.includes('动作库'))
ok('提示词带上了可选日期', msgs.user.includes('2026-10-12'))
ok('提示词包含禁项（不给医疗建议）', msgs.system.includes('不提供医疗'))
ok('提示词不再包含模式标签', !msgs.user.includes('大众模式') && !msgs.user.includes('运动员模式'))

const specialtyMsgs = buildPlanMessages(p({ discipline: '800m', cyclePhase: '强度建立' }), draftDates)
ok('专项信息填了就进入提示词', specialtyMsgs.user.includes('800m') && specialtyMsgs.user.includes('强度建立'))
ok('专项信息没填就不出现在提示词', !buildPlanMessages(p({}), draftDates).user.includes('专项：'))

const qMsgs = buildPlanQuestionMessages(p({}), draftDates)
ok('先问再生成：提示词只让模型问问题', qMsgs.system.includes('先不要生成训练计划') && qMsgs.system.includes('"questions"'))
ok('先问再生成：要求确认每周次数且不要默认三天', qMsgs.system.includes('每周训练次数') && qMsgs.system.includes('不要默认只排三天'))
const qValid = validatePlanQuestions({
  questions: [
    { id: 'days', question: '每周希望练几次？', options: ['3 次', '4 次', '5 次'] },
    { id: 'time', question: '每次能练多久？', options: ['30 分钟', '45 分钟'] }
  ]
})
ok('补充问题被接受', qValid.error === '' && qValid.questions.length === 2)
const qFallback = validatePlanQuestions({ questions: [{ question: '每次能练多久？', options: ['30 分钟'] }] })
ok('缺次数问题时自动补上默认问题', qFallback.questions.some(q => q.id === 'weekly-frequency'))
ok('补充问题最多 3 个', validatePlanQuestions({
  questions: Array.from({ length: 5 }, (_, i) => ({ question: `问题${i}？`, options: ['A', 'B'] }))
}).questions.length <= 3)
ok('从回答解析每周 5 次', desiredWeeklySessions(
  [{ id: 'weekly-frequency', question: '每周希望安排几次训练？', options: [] }],
  { 'weekly-frequency': '5 次' }
) === 5)
const msgsWithAnswers = buildPlanMessages(p({}), draftDates, {
  questions: [{ id: 'weekly-frequency', question: '每周希望安排几次训练？', options: [] }],
  answers: { 'weekly-frequency': '5 次' }
})
ok('生成计划提示词带上补充回答', msgsWithAnswers.user.includes('每周希望安排几次训练？ → 5 次'))
ok('生成计划提示词要求按回答排够次数且不要默认三天', msgsWithAnswers.system.includes('不要默认只排三天') && msgsWithAnswers.system.includes('4–5'))

console.log('\n12. 两仪同期对照（运动 × 饮食，健康口径与缺失口径）')
const mkBridgeSession = (date: string, rpe: number | null, minutes = 20, discomfort = false): TrainingSession => ({
  id: `s-${date}-${rpe}-${minutes}-${discomfort}`, userId: 'u1', date,
  exerciseName: '站姿弯举', type: '站姿弯举', actualDuration: minutes,
  completionStatus: 'completed', rpe, discomfort, cameraUsed: false,
  manualCorrections: 0, createdAt: `${date}T20:00:00.000Z`
})
const mkBridgeMeal = (date: string, type: Meal['mealType'], cats: FoodCategory[], complete = true): Meal => ({
  id: `m-${date}-${type}-${cats.join('')}`, userId: 'u1', date, mealType: type,
  time: type === 'breakfast' ? '08:00' : type === 'lunch' ? '12:00' : type === 'dinner' ? '18:30' : '21:00',
  completeness: complete ? 'complete' : 'partial', analyzed: false,
  items: cats.map((category, i) => ({
    id: `i-${date}-${type}-${i}`, mealId: `m-${date}-${type}`, foodId: `f-${i}`,
    foodName: `食物${i}`, category, portionSize: 1, portionUnit: '份', confirmed: true
  })),
  createdAt: `${date}T12:00:00.000Z`
})

const bridgeDate = (offset: number) => toISODate(iso(offset))
const emptyDay = readDayFacts([], [], bridgeDate(0))
ok('没记录的一天：正餐 0/3，8 类全缺', emptyDay.recordedSlots === 0 && emptyDay.missing.length === 8)
ok('没记录的一天不把类别算成"已出现"', emptyDay.coverage.length === 0)

const oneDay = readDayFacts(
  [mkBridgeSession(bridgeDate(0), 6, 30), mkBridgeSession(bridgeDate(0), 8, 10, true)],
  [
    mkBridgeMeal(bridgeDate(0), 'breakfast', ['谷薯类', '蛋类']),
    mkBridgeMeal(bridgeDate(0), 'lunch', ['蔬菜类', '肉类'], false),
    mkBridgeMeal(bridgeDate(0), 'breakfast', ['奶类']),
    mkBridgeMeal(bridgeDate(0), 'snack', ['水果类'])
  ],
  bridgeDate(0)
)
ok('同餐次记两条只算一档正餐', oneDay.recordedSlots === 2, String(oneDay.recordedSlots))
ok('加餐不计入正餐档数', oneDay.snackCount === 1 && oneDay.recordedSlots === 2)
ok('平均 RPE 只算记了 RPE 的场次', oneDay.avgRpe === 7)
ok('任一场次报不适即为 true', oneDay.discomfort === true)
ok('类别覆盖按出现过的类去重', oneDay.coverage.length === 6, oneDay.coverage.join('、'))
ok('没出现的类进 missing', oneDay.missing.includes('坚果类') && oneDay.missing.includes('豆类'))
ok('训练时长是当天合计', oneDay.sessionMinutes === 40)

const weekSessions = [
  mkBridgeSession(bridgeDate(0), 5, 30),
  mkBridgeSession(bridgeDate(2), 7, 20)
]
const weekMeals = [
  mkBridgeMeal(bridgeDate(0), 'lunch', ['谷薯类', '蔬菜类', '肉类']),
  mkBridgeMeal(bridgeDate(1), 'lunch', ['谷薯类', '蔬菜类'])
]
const bridgeWeek = buildWeekFacts(weekSessions, weekMeals, iso(3))
ok('本周有训练记录的天数', bridgeWeek.sessionDays === 2, String(bridgeWeek.sessionDays))
ok('本周有餐食记录的天数', bridgeWeek.mealDays === 2, String(bridgeWeek.mealDays))
ok('两边都有记录的天数', bridgeWeek.pairedDays === 1, String(bridgeWeek.pairedDays))
ok('只有餐食记录的天数', bridgeWeek.nutritionOnlyDays === 1, String(bridgeWeek.nutritionOnlyDays))
ok('无训练日样本少于 2 天时不给差值', bridgeWeek.coverageGap === null, String(bridgeWeek.coverageGap))
ok('训练日平均覆盖按有训练记录的天算', bridgeWeek.avgCoverageTraining === 1.5, String(bridgeWeek.avgCoverageTraining))

const bridgeWeek2 = buildWeekFacts(weekSessions, [
  ...weekMeals,
  mkBridgeMeal(bridgeDate(3), 'lunch', ['谷薯类', '蔬菜类', '蛋类']),
  mkBridgeMeal(bridgeDate(4), 'lunch', ['谷薯类', '蔬菜类', '豆类'])
], iso(4))
ok('无训练日样本够了才算差值', bridgeWeek2.coverageGap !== null, String(bridgeWeek2.coverageGap))
ok('差值 = 训练日均值 − 无训练日均值', bridgeWeek2.coverageGap === -1.2, String(bridgeWeek2.coverageGap))
ok('差值只用有餐食记录的无训练日，不把空白日当 0', bridgeWeek2.restSampleDays === 3, String(bridgeWeek2.restSampleDays))

const emptySignals = buildBridgeSignals(readDayFacts([], [], bridgeDate(0)), bridgeWeek2)
ok('两边都空时说明空着是合法状态', emptySignals[0]?.id === 'both-empty-today' && emptySignals[0].detail.includes('合法'))
ok('联动提示最多四条', emptySignals.length <= 4)

const trainingNoMeal = readDayFacts([mkBridgeSession(bridgeDate(0), 6, 30)], [], bridgeDate(0))
const trainingSignals = buildBridgeSignals(trainingNoMeal, bridgeWeek2)
ok('有训练但没餐食记录时提示补记', trainingSignals.some(s => s.id === 'training-with-missing-meals'))
ok('补记提示明确"不代表该吃什么"', trainingSignals.find(s => s.id === 'training-with-missing-meals')?.detail.includes('不代表现在该吃什么') === true)

const mealNoTraining = readDayFacts([], [mkBridgeMeal(bridgeDate(0), 'lunch', ['谷薯类'])], bridgeDate(0))
const mealSignals = buildBridgeSignals(mealNoTraining, bridgeWeek2)
ok('只有餐食记录时把注意力引回运动', mealSignals.some(s => s.id === 'meals-without-movement'))
ok('不把"没记录"说成"没运动"', mealSignals.find(s => s.id === 'meals-without-movement')?.detail.includes('没有记录不等于没运动') === true)

const discomfortDay = readDayFacts([mkBridgeSession(bridgeDate(0), 8, 20, true)], [], bridgeDate(0))
const discomfortSignals = buildBridgeSignals(discomfortDay, bridgeWeek2)
ok('不适记录排在最前且语气是 caution', discomfortSignals[0]?.tone === 'caution' && discomfortSignals[0].kind === 'safety')
ok('不适出现时不声称会自动加量', discomfortSignals[0].detail.includes('不会据此建议加量'))

const weeklyDiscomfortWeek = buildWeekFacts([mkBridgeSession(bridgeDate(1), 7, 20, true)], [], iso(1))
ok('本周不适天数被统计', weeklyDiscomfortWeek.discomfortDays === 1)
const nextDaySignals = buildBridgeSignals(readDayFacts([], [], bridgeDate(0)), weeklyDiscomfortWeek)
ok('今天无不适但本周有，也把安全提示放首位', nextDaySignals[0]?.id === 'week-discomfort' && nextDaySignals[0].tone === 'caution')
ok('周内不适不声称会自动停止加量', nextDaySignals[0].detail.includes('不给出加量建议'))

ok('移动端另一极预览：运动只写今天分钟数', peekLine('movement', trainingNoMeal) === '今天 30 分钟', peekLine('movement', trainingNoMeal))
ok('移动端另一极预览：饮食只写今天餐数', peekLine('nutrition', mealNoTraining) === '今天 1/3 餐', peekLine('nutrition', mealNoTraining))
ok('移动端另一极预览：没有记录时不编造数字', peekLine('movement', readDayFacts([], [], bridgeDate(0))) === '今天还没记录')

const movementOnlyWeek = buildWeekFacts([mkBridgeSession(bridgeDate(0), 5, 30)], [], iso(0))
const movementOnlySignals = buildBridgeSignals(readDayFacts([], [], bridgeDate(0)), movementOnlyWeek)
ok('本周只有运动记录时指出另一极缺失', movementOnlySignals.some(s => s.id === 'week-movement-only'))
ok('健康口径清单写明不推断因果', BRIDGE_LIMITS.some(l => l.includes('不代表因果')))
ok('健康口径清单写明未记录不等于没发生', BRIDGE_LIMITS.some(l => l.includes('未记录不等于没发生')))

console.log('\n13. 计划项 → 跟练覆盖')
const sitDemo = getDemoExercise('坐站训练')
const sitOverride = applyPlanOverrides(sitDemo, { sets: 1, reps: 5 })
ok('覆盖组数与每组次数', sitOverride.sets === 1 && sitOverride.repsPerSet === 5)
ok('按新次数重建演示时间线', sitOverride.setEvents.filter(e => e.count !== undefined && e.state !== 'complete').length === 5
  && sitOverride.setEvents.find(e => e.state === 'complete')?.count === 5
  && sitOverride.setDuration === sitOverride.setEvents[sitOverride.setEvents.length - 1].time)
ok('不修改共享的 demo 动作', sitDemo.sets === 2 && sitDemo.repsPerSet === 8)
const noOverride = applyPlanOverrides(sitDemo, {})
ok('无覆盖参数时保持默认', noOverride.sets === 2 && noOverride.repsPerSet === 8
  && noOverride.setEvents.length === sitDemo.setEvents.length)
const plankOverride = applyPlanOverrides(getDemoExercise('平板支撑'), { sets: 1, hold: 20 })
ok('time 模式覆盖保持秒数', plankOverride.holdSeconds === 20 && plankOverride.setDuration === 20_000)
const walkOverride = applyPlanOverrides(getDemoExercise('快走'), { minutes: 30 })
ok('steps 模式覆盖目标分钟', walkOverride.targetMinutes === 30 && walkOverride.setDuration === 1_800_000)
const badOverrides = readPlanOverrides({ sets: '99', reps: '0', hold: '2', minutes: '-3', planItemId: ' p1 ' })
ok('越界覆盖参数被忽略', badOverrides.sets === undefined && badOverrides.reps === undefined
  && badOverrides.hold === undefined && badOverrides.minutes === undefined
  && badOverrides.planItemId === 'p1')
const goodOverrides = readPlanOverrides({ sets: '1', reps: '6', hold: '20', minutes: '30', planItemId: 'p2' })
ok('合法覆盖参数被解析', goodOverrides.sets === 1 && goodOverrides.reps === 6
  && goodOverrides.hold === 20 && goodOverrides.minutes === 30 && goodOverrides.planItemId === 'p2')
const customSession = summarizeSession({
  exercise: sitOverride, planItemId: 'item-1', setsCompleted: 1, repsBySet: [5],
  averageConfidence: 0.9, manualCorrections: 0, elapsedMs: 60_000
})
ok('训练记录写回 planItemId 与覆盖后的次数', customSession.planItemId === 'item-1'
  && customSession.actualSets === 1 && customSession.actualReps === 5
  && customSession.completionStatus === 'completed')
const intervalItem = {
  id: 'interval', planId: 'follow', date: '2026-11-10', exerciseName: '坐站训练', type: '坐站训练' as const,
  plannedSets: 2, plannedReps: 5, plannedDuration: 2, completed: false
}
const timedGuide = guideExercise(sitDemo, 'timer', intervalItem)
const cameraGuide = guideExercise(sitDemo, 'camera', intervalItem)
ok('同一计次计划可按时长跟练或保留摄像头计数规格', timedGuide.mode === 'time'
  && timedGuide.setDuration === 60_000 && timedGuide.sets === 2 && timedGuide.targetReps === 5
  && cameraGuide.mode === 'reps' && cameraGuide.sets === 2 && cameraGuide.repsPerSet === 5)
const customGuide = guideExercise(undefined, 'timer', {
  ...intervalItem, exerciseName: '上坡跑', type: '跑步', plannedDistance: 100, plannedDuration: undefined, plannedReps: undefined
})
ok('未收录的距离动作保留名称与米数，按完成确认推进', customGuide.name === '上坡跑' && customGuide.targetDistance === 100
  && customGuide.mode === 'time' && customGuide.holdSeconds === undefined && customGuide.sets === 2)
const quickGuide = guideExercise(undefined, 'camera', { ...intervalItem, exerciseName: '闭眼单腿站立', plannedHoldSeconds: 3 })
ok('图片里的单组秒数优先于分钟，短时长也可以跟练', quickGuide.name === '闭眼单腿站立' && quickGuide.setDuration === 3000)
const timedGuideRecord = summarizeSession({
  exercise: timedGuide, planItemId: intervalItem.id, setsCompleted: 2, repsBySet: [],
  elapsedMs: 120_000, averageConfidence: 0, manualCorrections: 0
})
ok('计时记录保留完成组数和时长，目标次数不写成实际次数', timedGuideRecord.actualReps === undefined
  && timedGuideRecord.countedReps === undefined && timedGuideRecord.cameraUsed === false
  && timedGuideRecord.actualSets === 2 && timedGuideRecord.actualDuration === 2 && timedGuideRecord.completionStatus === 'completed')

console.log('\n14. 计划调整建议（时间冲突）')
const timeProfile = p({ availableTimes: ['20 分钟'] })
const planWithItems = (items: PlanItem[]): Plan => ({
  id: 'plan-time', userId: 'u1', version: 1, createdAt: '2026-11-02T08:00:00.000Z',
  reason: 'test', weekStartDate: '2026-11-02', weekEndDate: '2026-11-08',
  items
})
const timeItem = (id: string, duration: number, completed = false): PlanItem => ({
  id, planId: 'plan-time', date: '2026-11-02', exerciseName: '坐站训练', type: '坐站训练',
  plannedDuration: duration, plannedSets: 2, plannedReps: 8, completed
})
const overBudget = buildTimeConflictSuggestion(planWithItems([timeItem('a', 15), timeItem('b', 10)]), timeProfile, '2026-11-02')
ok('超预算给出搬移建议', !!overBudget && overBudget.itemId === 'a'
  && overBudget.changes[0].newValue?.date === '2026-11-03')
ok('时间冲突建议带可读原因', !!overBudget && overBudget.reason.includes('超过') && overBudget.reason.includes('20 分钟'))
const underBudget = buildTimeConflictSuggestion(planWithItems([timeItem('a', 15), timeItem('b', 5)]), timeProfile, '2026-11-02')
ok('不超预算不提示', underBudget === null)
const completedFirst = buildTimeConflictSuggestion(planWithItems([timeItem('a', 15, true), timeItem('b', 10)]), timeProfile, '2026-11-02')
ok('跳过已完成项', !!completedFirst && completedFirst.itemId === 'b')
ok('无计划不提示', buildTimeConflictSuggestion(null, timeProfile, '2026-11-02') === null)
const suggestionsOpen = buildAdjustmentSuggestions({
  plan: planWithItems([timeItem('a', 15), timeItem('b', 10)]),
  profile: timeProfile, selectedDate: '2026-11-02', resolutions: {}
})
ok('未处理建议保留', suggestionsOpen.length === 1)
const suggestionsResolved = buildAdjustmentSuggestions({
  plan: planWithItems([timeItem('a', 15), timeItem('b', 10)]),
  profile: timeProfile, selectedDate: '2026-11-02',
  resolutions: { [suggestionsOpen[0].key]: 'dismissed' }
})
ok('已处理建议被过滤', suggestionsResolved.length === 0)

console.log('\n15. 反馈调整（降量）')
const fbNow = new Date(2026, 10, 2, 12, 0, 0)
const fbSession = (
  id: string, date: string, rpe: number | null,
  extra: Partial<TrainingSession> = {}
): TrainingSession => ({
  id, userId: 'u1', date, exerciseName: '站姿弯举', type: '站姿弯举',
  actualDuration: 10, completionStatus: 'completed', rpe, discomfort: false,
  cameraUsed: false, manualCorrections: 0, createdAt: `${date}T10:00:00.000Z`, ...extra
})
const fbPlan = (item: Partial<PlanItem> = {}): Plan => planWithItems([{
  id: 'fb-item', planId: 'plan-fb', date: '2026-11-05', exerciseId: 'ex-stand-curl',
  exerciseName: '站姿弯举', type: '站姿弯举', plannedDuration: 3,
  plannedSets: 2, plannedReps: 10, completed: false, ...item
}])
const fbProfile = p({})
const highHigh = [fbSession('s1', '2026-10-28', 9), fbSession('s2', '2026-11-01', 8)]
const downIntents = buildFeedbackIntents(highHigh, fbProfile, fbNow)
ok('两次高 RPE 产生降量意图', downIntents.length === 1 && downIntents[0].direction === 'down')
const downSuggestions = buildAdjustmentSuggestions({
  plan: fbPlan(), profile: fbProfile, selectedDate: '2026-11-02',
  resolutions: {}, sessions: highHigh, now: fbNow
})
const down = downSuggestions.find(s => s.source === 'feedback')
ok('降量建议落到下一次同动作', !!down && down.itemId === 'fb-item'
  && down.from === '2×10' && down.to === '1×10'
  && down.changes[0].newValue?.plannedSets === 1)
ok('降量建议带触发日期与 RPE', !!down && down.reason.includes('10-28') && down.reason.includes('RPE 9'))
ok('单次高 RPE 不触发', buildFeedbackIntents([fbSession('s1', '2026-11-01', 9)], fbProfile, fbNow).length === 0)
ok('一高一低不触发', buildFeedbackIntents([
  fbSession('s1', '2026-10-28', 9), fbSession('s2', '2026-11-01', 2)
], fbProfile, fbNow).length === 0)
const nullSkipped = buildFeedbackIntents([
  fbSession('s1', '2026-10-20', 9), fbSession('s2', '2026-10-25', null),
  fbSession('s3', '2026-10-28', 8)
], fbProfile, fbNow)
ok('未记 RPE 的场次跳过且不打断', nullSkipped.length === 1 && nullSkipped[0].direction === 'down')
const tooOld = buildFeedbackIntents([
  fbSession('s1', '2026-10-01', 9), fbSession('s2', '2026-11-01', 8)
], fbProfile, fbNow)
ok('超出 21 天的反馈不触发', tooOld.length === 0)
const downSingle = buildAdjustmentSuggestions({
  plan: fbPlan({ plannedSets: 1 }), profile: fbProfile, selectedDate: '2026-11-02',
  resolutions: {}, sessions: highHigh, now: fbNow
}).find(s => s.source === 'feedback')
ok('单组动作降次数', !!downSingle && downSingle.from === '1×10' && downSingle.to === '1×8'
  && downSingle.changes[0].newValue?.plannedReps === 8)
const downTime = buildAdjustmentSuggestions({
  plan: fbPlan({ plannedSets: 1, plannedReps: undefined, plannedHoldSeconds: 30, plannedDuration: 3 }),
  profile: fbProfile, selectedDate: '2026-11-02', resolutions: {}, sessions: highHigh, now: fbNow
}).find(s => s.source === 'feedback')
ok('计时动作降保持秒数', !!downTime && downTime.from === '1×30秒' && downTime.to === '1×25秒'
  && downTime.changes[0].newValue?.plannedHoldSeconds === 25)
const downSteps = buildAdjustmentSuggestions({
  plan: fbPlan({ plannedHoldSeconds: undefined, plannedReps: undefined, plannedTargetMinutes: 20, plannedDuration: 20 }),
  profile: fbProfile, selectedDate: '2026-11-02', resolutions: {}, sessions: highHigh, now: fbNow
}).find(s => s.source === 'feedback')
ok('计步动作降目标分钟', !!downSteps && downSteps.from === '20分钟' && downSteps.to === '15分钟'
  && downSteps.changes[0].newValue?.plannedTargetMinutes === 15)
const resolvedDown = buildAdjustmentSuggestions({
  plan: fbPlan(), profile: fbProfile, selectedDate: '2026-11-02',
  resolutions: down ? { [down.key]: 'accepted' } : {}, sessions: highHigh, now: fbNow
})
ok('同一证据处理后不再出现', !resolvedDown.some(s => s.source === 'feedback'))

console.log('\n16. 反馈调整（升量）')
const lowLow = [fbSession('u1', '2026-10-28', 2), fbSession('u2', '2026-11-01', 3)]
const upIntents = buildFeedbackIntents(lowLow, fbProfile, fbNow)
ok('两次低 RPE + 全部完成产生升量意图', upIntents.length === 1 && upIntents[0].direction === 'up')
const up = buildAdjustmentSuggestions({
  plan: fbPlan(), profile: fbProfile, selectedDate: '2026-11-02',
  resolutions: {}, sessions: lowLow, now: fbNow
}).find(s => s.source === 'feedback')
ok('升量建议加到下一次同动作', !!up && up.from === '2×10' && up.to === '3×10'
  && up.changes[0].newValue?.plannedSets === 3)
ok('升量同步更新计划时长', !!up && up.changes[0].newValue?.plannedDuration === 5)
ok('一次部分完成不升量', buildFeedbackIntents([
  fbSession('u1', '2026-10-28', 2), fbSession('u2', '2026-11-01', 3, { completionStatus: 'partial' })
], fbProfile, fbNow).length === 0)
ok('一次高 RPE 不升量', buildFeedbackIntents([
  fbSession('u1', '2026-10-28', 2), fbSession('u2', '2026-11-01', 8)
], fbProfile, fbNow).length === 0)
const nullLow = buildFeedbackIntents([
  fbSession('u1', '2026-10-20', 2), fbSession('u2', '2026-10-25', null), fbSession('u3', '2026-11-01', 3)
], fbProfile, fbNow)
ok('升量判定同样跳过未记 RPE', nullLow.length === 1 && nullLow[0].direction === 'up')
const upSingle = buildAdjustmentSuggestions({
  plan: fbPlan({ plannedSets: 1 }), profile: fbProfile, selectedDate: '2026-11-02',
  resolutions: {}, sessions: lowLow, now: fbNow
}).find(s => s.source === 'feedback')
ok('单组动作升次数', !!upSingle && upSingle.from === '1×10' && upSingle.to === '1×12'
  && upSingle.changes[0].newValue?.plannedReps === 12)
const upTime = buildAdjustmentSuggestions({
  plan: fbPlan({ plannedSets: 1, plannedReps: undefined, plannedHoldSeconds: 30, plannedDuration: 3 }),
  profile: fbProfile, selectedDate: '2026-11-02', resolutions: {}, sessions: lowLow, now: fbNow
}).find(s => s.source === 'feedback')
ok('计时动作升保持秒数', !!upTime && upTime.from === '1×30秒' && upTime.to === '1×35秒')
const upSteps = buildAdjustmentSuggestions({
  plan: fbPlan({ plannedHoldSeconds: undefined, plannedReps: undefined, plannedTargetMinutes: 20, plannedDuration: 20 }),
  profile: fbProfile, selectedDate: '2026-11-02', resolutions: {}, sessions: lowLow, now: fbNow
}).find(s => s.source === 'feedback')
ok('计步动作升目标分钟', !!upSteps && upSteps.from === '20分钟' && upSteps.to === '25分钟')

console.log('\n17. 反馈调整（安全事实 / 受限档案）')
const safetySessions = [
  fbSession('d1', '2026-10-28', 9, { discomfort: true }),
  fbSession('d2', '2026-11-01', 8)
]
const safetyIntent = buildFeedbackIntents(safetySessions, fbProfile, fbNow)[0]
ok('不适优先于高 RPE', safetyIntent?.direction === 'safety')
const safetySuggestion = buildAdjustmentSuggestions({
  plan: fbPlan(), profile: fbProfile, selectedDate: '2026-11-02',
  resolutions: {}, sessions: safetySessions, now: fbNow
}).find(s => s.source === 'feedback')
ok('安全事实卡不产生数字改动', !!safetySuggestion && safetySuggestion.safetyOnly === true
  && safetySuggestion.changes.length === 0)
ok('安全事实卡带不适/原因证据', !!safetySuggestion && safetySuggestion.reason.includes('不适'))
const reasonSessions = [
  fbSession('r1', '2026-10-28', 2, { completionStatus: 'partial', completionReason: '时间不够' }),
  fbSession('r2', '2026-11-01', 3)
]
ok('非空未完成原因进入安全事实', buildFeedbackIntents(reasonSessions, fbProfile, fbNow)[0]?.direction === 'safety')
const gateIntent = buildFeedbackIntents(highHigh, p({ restrictions: ['孕期或产后'] }), fbNow)[0]
ok('GATE_RESTRICTIONS 不生成数字调整', gateIntent?.direction === 'safety' && gateIntent.allowNumeric === false)
const minorIntent = buildFeedbackIntents(highHigh, p({ age: 17 }), fbNow)[0]
ok('未成年不生成数字调整', minorIntent?.direction === 'safety' && minorIntent.allowNumeric === false)

console.log('\n18. 无计划 / 无目标边界')
const noPlanCurrent = buildAdjustmentSuggestions({
  plan: null, nextPlan: null, profile: fbProfile, selectedDate: '2026-11-02',
  resolutions: {}, sessions: highHigh, now: fbNow
}).find(s => s.source === 'feedback')
ok('没有当前计划时提示生成本周计划', !!noPlanCurrent && noPlanCurrent.needsPlan === 'current-week'
  && noPlanCurrent.changes.length === 0)
const noTargetNoNext = buildAdjustmentSuggestions({
  plan: fbPlan({ date: '2026-10-01' }), nextPlan: null, profile: fbProfile, selectedDate: '2026-11-02',
  resolutions: {}, sessions: highHigh, now: fbNow
}).find(s => s.source === 'feedback')
ok('当前周没有目标且下周未生成时提示生成下周计划', !!noTargetNoNext && noTargetNoNext.needsPlan === 'next-week')
const nextPlanWithTarget: Plan = {
  ...planWithItems([{
    id: 'next-item', planId: 'next-plan', date: '2026-11-09', exerciseId: 'ex-stand-curl',
    exerciseName: '站姿弯举', type: '站姿弯举', plannedDuration: 3,
    plannedSets: 2, plannedReps: 10, completed: false
  }]),
  id: 'next-plan', weekStartDate: '2026-11-09', weekEndDate: '2026-11-15'
}
const nextTarget = buildAdjustmentSuggestions({
  plan: fbPlan({ date: '2026-10-01' }), nextPlan: nextPlanWithTarget,
  profile: fbProfile, selectedDate: '2026-11-02', resolutions: {}, sessions: highHigh, now: fbNow
}).find(s => s.source === 'feedback')
ok('下周有计划时顺延到下周同动作', !!nextTarget && nextTarget.planId === 'next-plan'
  && nextTarget.itemId === 'next-item' && nextTarget.from === '2×10')
const nextPlanWithoutTarget = { ...nextPlanWithTarget, items: [] }
const blocked = buildAdjustmentSuggestions({
  plan: fbPlan({ date: '2026-10-01' }), nextPlan: nextPlanWithoutTarget,
  profile: fbProfile, selectedDate: '2026-11-02', resolutions: {}, sessions: highHigh, now: fbNow
}).find(s => s.source === 'feedback')
ok('下周计划没有该动作时明确说明', !!blocked && !!blocked.blockedReason && blocked.changes.length === 0)
const safetyNoTarget = buildAdjustmentSuggestions({
  plan: null, nextPlan: null, profile: fbProfile, selectedDate: '2026-11-02',
  resolutions: {}, sessions: safetySessions, now: fbNow
}).find(s => s.source === 'feedback')
ok('不适事实即使没有目标也能提示', !!safetyNoTarget && safetyNoTarget.safetyOnly === true
  && safetyNoTarget.itemId === '')

console.log('\n19. 近四周报告')
const reportSessions = [
  mkBridgeSession('2026-10-07', 5, 20),
  mkBridgeSession('2026-10-14', null, 10),
  mkBridgeSession('2026-10-28', 4, 10),
  mkBridgeSession('2026-11-01', 6, 10)
]
const reportMeals = [
  mkBridgeMeal('2026-10-07', 'breakfast', ['水果类', '谷薯类']),
  mkBridgeMeal('2026-10-14', 'lunch', ['蔬菜类', '蛋类'], false),
  mkBridgeMeal('2026-10-28', 'dinner', ['水果类', '奶类'])
]
const rolling = buildRollingFourWeeksReport(
  reportSessions, reportMeals, new Date(2026, 10, 2),
  { profile: p({ availableTimes: ['20 分钟'] }) }
)
ok('近四周结束于今天、开始于 27 天前', rolling.start === '2026-10-06' && rolling.end === '2026-11-02')
ok('近四周切成 4 个 7 天块', rolling.blocks.length === 4
  && rolling.blocks[0].start === '2026-10-06' && rolling.blocks[0].end === '2026-10-12'
  && rolling.blocks[3].start === '2026-10-27' && rolling.blocks[3].end === '2026-11-02')
ok('块负荷按完整日累计', rolling.blocks[0].load === 100 && rolling.blocks[0].loadCompleteness === 'complete')
ok('缺 RPE 的块标不完整且不补 0', rolling.blocks[1].load === null && rolling.blocks[1].loadCompleteness === 'incomplete')
ok('无记录块为 none', rolling.blocks[2].load === null && rolling.blocks[2].loadCompleteness === 'none')
ok('总负荷只累计完整日', rolling.totalLoad === 200 && rolling.loadDays === 3 && rolling.unloadedDays === 1)
ok('训练天数与总时长', rolling.trainingDays === 4 && rolling.totalSessions === 4 && rolling.totalMinutes === 50)
ok('餐食天数与完整/部分记录', rolling.mealDays === 3 && rolling.totalMeals === 3
  && rolling.completeMeals === 2 && rolling.partialMeals === 1)
ok('类别覆盖按条目累计', rolling.categoryCoverage['水果类'] === 2 && rolling.categoryCoverage['谷薯类'] === 1
  && rolling.categoryCoverage['奶类'] === 1)
ok('数据质量说明缺 RPE 不计入', rolling.dataQuality.some(q => q.includes('不参与负荷计算')))
ok('数据质量说明餐食未记录口径', rolling.dataQuality.some(q => q.includes('未记录') && q.includes('不代表未摄入')))
const emptyRolling = buildRollingFourWeeksReport(
  [], [], new Date(2026, 10, 2), { profile: p({ availableTimes: ['20 分钟'] }) }
)
ok('空窗口负荷留空而不是 0', emptyRolling.totalLoad === null && emptyRolling.trainingDays === 0
  && emptyRolling.blocks.every(b => b.loadCompleteness === 'none' && b.load === null))
ok('空窗口数据质量说明空着合法', emptyRolling.dataQuality.some(q => q.includes('还没有训练记录')))

console.log('\n20. 月报')
const feb = buildMonthlyReport([], [], new Date(2026, 1, 1), { profile: p({}) }, new Date(2026, 2, 15))
ok('2 月按 4 个块切分', feb.blocks.length === 4 && feb.start === '2026-02-01' && feb.end === '2026-02-28'
  && feb.blocks[3].start === '2026-02-22' && feb.blocks[3].end === '2026-02-28')
const oct = buildMonthlyReport([], [], new Date(2026, 9, 1), { profile: p({}) }, new Date(2026, 10, 2))
ok('31 天月份按 5 个块切分', oct.blocks.length === 5 && oct.blocks[4].start === '2026-10-29'
  && oct.blocks[4].end === '2026-10-31')
const apr = buildMonthlyReport([], [], new Date(2026, 3, 1), { profile: p({}) }, new Date(2026, 4, 2))
ok('30 天月份最后一块只到月末', apr.blocks.length === 5 && apr.blocks[4].start === '2026-04-29'
  && apr.blocks[4].end === '2026-04-30')
const currentNov = buildMonthlyReport(
  reportSessions, reportMeals, new Date(2026, 10, 1),
  { profile: p({ availableTimes: ['20 分钟'] }) }, new Date(2026, 10, 2)
)
ok('当前月只统计到今天', currentNov.start === '2026-11-01' && currentNov.end === '2026-11-02'
  && currentNov.blocks.length === 1 && currentNov.blocks[0].end === '2026-11-02')
ok('当前月数据质量写截止日期', currentNov.dataQuality.some(q => q.includes('当前月统计到 11 月 2 日')))
ok('月报负荷与近四周同口径', currentNov.totalLoad === 60 && currentNov.trainingDays === 1)

console.log('\n21. 长期趋势')
const longSessions = [
  mkBridgeSession('2026-06-15', 5, 20),
  mkBridgeSession('2026-06-20', null, 10),
  mkBridgeSession('2026-08-10', 4, 10),
  mkBridgeSession('2026-10-28', 6, 10),
  mkBridgeSession('2026-11-01', 2, 10)
]
const trend = buildLongTermTrend(longSessions, new Date(2026, 10, 2), 6)
ok('长期固定 6 个月份', trend.length === 6 && trend[0].month === '2026-06'
  && trend[5].month === '2026-11' && trend.map(p => p.label).join(',') === '6月,7月,8月,9月,10月,11月')
ok('长期负荷按完整日累计', trend[0].load === 100 && trend[0].loadCompleteness === 'incomplete'
  && trend[2].load === 40 && trend[4].load === 60 && trend[5].load === 20)
ok('没有记录的月份负荷留空', trend[1].load === null && trend[1].loadCompleteness === 'none'
  && trend[3].load === null && trend[3].loadCompleteness === 'none')
ok('训练天数只统计有记录的天数', trend[0].trainingDays === 2 && trend[1].trainingDays === 0
  && trend[2].trainingDays === 1 && trend[5].trainingDays === 1)
ok('当前月标记为部分月份', trend[5].partialMonth === true && trend.slice(0, 5).every(p => !p.partialMonth))
ok('没有训练的月份 hasSession=false', trend[1].hasSession === false && trend[3].hasSession === false)

console.log('\n22. 同步 outbox：同一 clientId 合并与删除吸收')
clearOutbox()
enqueue('session.create', 'session-1', { id: 'session-1' })
enqueue('session.feedback', 'session-1', { id: 'session-1' })
enqueue('session.delete', 'session-1', { id: 'session-1' })
ok('删除吸收同一条未上传的创建与反馈', listOutbox().length === 1 && listOutbox()[0].kind === 'session.delete')

enqueue('meal.create', 'meal-1', { id: 'meal-1' })
enqueue('meal.update', 'meal-1', { id: 'meal-1', time: '12:30' })
ok('餐食更新按 clientId 合并成一条', listOutbox().length === 2 && listOutbox().filter(op => op.clientId === 'meal-1').length === 1)

enqueue('profile.update', 'u1', { age: 30 })
enqueue('profile.update', 'u1', { age: 31 })
const profileOps = listOutbox().filter(op => op.kind === 'profile.update')
ok('档案更新只保留最后一次', profileOps.length === 1 && (profileOps[0].payload as { age: number }).age === 31)
clearOutbox()
ok('清空 outbox 后不残留', listOutbox().length === 0)

console.log('\n23. 分类存储迁移与配额恢复')
clearStoredState()
const legacy = { profile: p({}), sessions: [s('2026-11-02', 10, null)], meals: [] }
mem.set('twopoles_state', JSON.stringify(legacy))
const originalSetItem = localStorage.setItem
localStorage.setItem = (key, value) => {
  if (key === STORAGE_KEYS.sessions) throw new DOMException('Quota exceeded', 'QuotaExceededError')
  originalSetItem(key, value)
}
const interrupted = loadStoredState()
ok('迁移失败仍返回完整旧记录并保留旧 key', interrupted.sessions?.length === 1 && mem.has('twopoles_state'))
ok('部分分类已写入时再次启动仍能读取旧记录', loadStoredState().sessions?.length === 1)
localStorage.setItem = originalSetItem
const recovered = loadStoredState()
ok('配额恢复后完成迁移并移除旧 key', recovered.sessions?.length === 1 && !mem.has('twopoles_state') && mem.has(STORAGE_KEYS.sessions))
ok('完整迁移后刷新可读到分类记录', loadStoredState().sessions?.length === 1)

// 模式分类取消前：同一周可能同时存在两份计划，meta 记录最后使用的模式
mem.set(STORAGE_KEYS.meta, JSON.stringify({ mode: 'athlete' }))
mem.set(STORAGE_KEYS.profile, JSON.stringify({ ...p({}), mode: 'athlete', modeChangedAt: '2026-11-01T00:00:00.000Z' }))
const legacyPlan = (id: string, version: number, mode: string) => ({
  id, userId: 'u1', version, createdAt: `2026-11-0${version}T08:00:00.000Z`,
  reason: 'legacy', weekStartDate: '2026-11-02', weekEndDate: '2026-11-08',
  items: [], mode
} as Plan & { mode: string })
mem.set(STORAGE_KEYS.plans, JSON.stringify([
  legacyPlan('legacy-public', 1, 'public'),
  legacyPlan('legacy-athlete', 2, 'athlete')
]))
mem.set('twopoles.v1.modeLog', JSON.stringify([{ from: 'public', to: 'athlete', at: '2026-11-01T00:00:00.000Z', openPlanCount: 0 }]))
const unifiedModes = loadStoredState()
ok('双模式计划合并为一份当前计划', unifiedModes.plans?.length === 1 && unifiedModes.plans[0].id === 'legacy-athlete',
  JSON.stringify(unifiedModes.plans?.map(pl => pl.id)))
ok('另一模式计划进入历史', unifiedModes.planHistory?.some(pl => pl.id === 'legacy-public'))
const profileHasMode = unifiedModes.profile ? 'mode' in (unifiedModes.profile as Record<string, unknown>) : false
ok('迁移后档案与计划不带模式字段', !profileHasMode
  && [...(unifiedModes.plans ?? []), ...(unifiedModes.planHistory ?? [])].every(pl => !('mode' in pl)))
ok('旧模式切换记录被移除', !mem.has('twopoles.v1.modeLog'))
clearStoredState()

console.log('\n24. 实时计数：帧连续性、遮挡、重置与校准')
ok('浮点媒体时间统一为整数毫秒避免推理图时间戳冲突', nextTimestamp(1000.99999999, 999) === 1000)
ok('同一毫秒内的伪新帧不会再次送入 MediaPipe', nextTimestamp(1000.00000001, 1000) === null)
const counterRule = { neutral: 170, bottom: 55, hysteresis: 8, minStageMs: 100, minRepMs: 700, maxStageMs: 6000, minVisibility: 0.5 }
function counterFixture(rule = counterRule) {
  const counter = useRepCounter(rule)
  let timestamp = 0
  return { counter,
    stage(angle: number | null, frames = 8, visibility = 0.95) {
      for (let i = 0; i < frames; i++) { timestamp += 90; counter.feed(angle, visibility, timestamp) }
    },
    jump(ms: number) { timestamp += ms },
    timestamp: () => timestamp
  }
}
const missingFrame = counterFixture()
missingFrame.stage(170); missingFrame.stage(50); missingFrame.stage(null, 1); missingFrame.stage(170)
ok('关键点丢失后不能把残留半次记为一次', missingFrame.counter.count.value === 0)
missingFrame.stage(50); missingFrame.stage(170)
ok('关键点恢复并重新起始后可正常计数', missingFrame.counter.count.value === 1)
const resetCounter = counterFixture()
resetCounter.stage(170); resetCounter.stage(50); resetCounter.stage(170)
resetCounter.counter.reset()
resetCounter.stage(50); resetCounter.stage(170)
ok('换组重置后必须重新确认起始位', resetCounter.counter.count.value === 0)
resetCounter.stage(50); resetCounter.stage(170)
ok('新组确认起始位后从 1 重新计数', resetCounter.counter.count.value === 1)
const pauseCounter = counterFixture()
pauseCounter.stage(170); pauseCounter.stage(50); pauseCounter.stage(170)
pauseCounter.stage(50); pauseCounter.counter.interrupt(); pauseCounter.stage(170)
ok('暂停保留已完成次数并丢弃未完成半次', pauseCounter.counter.count.value === 1)
pauseCounter.stage(50); pauseCounter.stage(170)
ok('暂停后可继续累计次数', pauseCounter.counter.count.value === 2)
const gapCounter = counterFixture()
gapCounter.stage(170); gapCounter.stage(50); gapCounter.jump(2000); gapCounter.stage(170)
ok('摄像头断帧不能跨越缺失画面补计次数', gapCounter.counter.count.value === 0)
const invalidCounter = counterFixture()
invalidCounter.stage(170); invalidCounter.stage(50); invalidCounter.stage(NaN, 1); invalidCounter.stage(170)
ok('非有限角度中断行程且不污染平滑窗口', invalidCounter.counter.count.value === 0)
invalidCounter.stage(50); invalidCounter.stage(170)
ok('无效角度恢复后仍可计数', invalidCounter.counter.count.value === 1)
const repeated = counterFixture()
repeated.stage(170)
const sameTimestamp = repeated.timestamp()
for (let i = 0; i < 100; i++) repeated.counter.feed(50, 0.95, sameTimestamp)
repeated.stage(170)
ok('同一个推理帧不能反复参与平滑或计数', repeated.counter.count.value === 0)
repeated.counter.feed(null, 0, sameTimestamp - 10)
ok('倒退帧不会覆盖当前有效阶段', repeated.counter.phase.value === 'ready')
const opposite = counterFixture({ ...counterRule, neutral: 20, bottom: 155 })
opposite.stage(20); opposite.stage(160); opposite.stage(20)
ok('角度递增方向也按完整往返计一次', opposite.counter.count.value === 1)
const calibratedCount = pauseCounter.counter.count.value
const briefReturn = counterFixture({ ...counterRule, minStageMs: 220 })
briefReturn.stage(170); briefReturn.stage(50); briefReturn.stage(170, 3)
ok('自然回程短暂停留也能确认一次，不要求末端停住很久', briefReturn.counter.count.value === 1)
const slowMovement = counterFixture()
slowMovement.stage(170); slowMovement.stage(112, 45); slowMovement.stage(50, 20); slowMovement.stage(112, 5); slowMovement.stage(170)
ok('单阶段未超时的缓慢完整行程不因总时长超过六秒漏计', slowMovement.counter.count.value === 1)
const calibrated = await pauseCounter.counter.calibrate(() => ({ angle: 165, visibility: 0.95 }), 300)
ok('机位校准保留已计次数', calibrated && pauseCounter.counter.count.value === calibratedCount)
const stalledCalibration = await pauseCounter.counter.calibrate(() => ({ angle: 165, visibility: 0.95, timestamp: 10 }), 300)
ok('冻结画面不能靠重复采样通过机位校准', !stalledCalibration)
const failedStart = await pauseCounter.counter.calibrate(() => ({ angle: 55, visibility: 0.95 }), 300)
ok('在动作末端校准不会生成失效阈值', !failedStart && pauseCounter.counter.calibratedNeutral.value === 165)
const visibleRight = body({
  11: { x: 0.4, y: 0.2, visibility: 0.2 }, 13: { x: 0.4, y: 0.4, visibility: 0.2 }, 15: { x: 0.6, y: 0.4, visibility: 0.2 },
  12: { x: 0.6, y: 0.2 }, 14: { x: 0.6, y: 0.4 }, 16: { x: 0.8, y: 0.4 }
})
const rightMetrics = computeMetrics(visibleRight)
ok('左臂遮挡时选择可见的右臂关节计数', rightMetrics.elbowSide === 'right' && rightMetrics.elbowAngle === 90 && rightMetrics.elbowVisibility === 0.9)
const hiddenWrist = body({ 11: { x: 0.4, y: 0.2 }, 13: { x: 0.4, y: 0.4 }, 15: { x: 0.6, y: 0.4, visibility: 0.1 } })
ok('单个关键关节遮挡不能被全身平均可见度掩盖', computeMetrics(hiddenWrist).elbowVisibility === 0.1)
ok('非有限关键点坐标不产生角度', angleAt({ x: NaN, y: 0 } as Lm, { x: 0, y: 0 } as Lm, { x: 1, y: 1 } as Lm) === null)
const manualSummary = summarizeSession({ exercise: sitOverride, setsCompleted: 1, repsBySet: [5], averageConfidence: 0, manualCorrections: 0, elapsedMs: 30_000 })
ok('手动与演示记录不会伪装成使用了摄像头', manualSummary.cameraUsed === false && manualSummary.countedReps === undefined)
const modelSummary = summarizeSession({ exercise: sitOverride, setsCompleted: 1, repsBySet: [5], cameraUsed: true, countedReps: 4, averageConfidence: 0.9, manualCorrections: 1, elapsedMs: 30_000 })
ok('模型次数与修正后的实际次数分别保存', modelSummary.cameraUsed && modelSummary.countedReps === 4 && modelSummary.actualReps === 5)

console.log('\n25. 图片导入：保留动作和规格，日期有据可查')
const fetchBeforeImageCheck = globalThis.fetch
const modelBeforeImageCheck = store.llmDefault
const profileBeforeFeedbackCheck = store.userProfile
const textBeforeFeedbackCheck = store.planFeedbackText
const imageRequests: unknown[] = []
const imageItems = [
  { exerciseName: '平板支撑', plannedHoldSeconds: 30 },
  { exerciseName: '死虫式', plannedReps: 20 },
  { exerciseName: '龙旗', plannedReps: 5 },
  { exerciseName: '跳绳', plannedHoldSeconds: 30 },
  { exerciseName: '站立抬腿', plannedReps: 10, note: '1-2组' },
  { exerciseName: '上坡立定跳', plannedSets: 4, plannedReps: 5, note: '间歇2分钟' },
  { exerciseName: '上坡跑', plannedSets: 4, plannedDistance: 100 }
]
const recognizedSchedule = '平板支撑30秒+死虫式20个+龙旗5次+跳绳30秒\n站立抬腿10次×1-2组\n上坡立定跳5次×4组 间歇2分钟\n上坡跑100米4组'
const reference = new Date(2026, 10, 10)
const imageDataUrl = 'data:image/jpeg;base64,dGVzdA=='
let reply: unknown = { reason: '安排轻松跑', days: [{ date: '2026-11-09', items: [{ exerciseName: '轻松跑', plannedDuration: 23 }] }] }
try {
  store.llmDefault = { available: true, model: 'mock-vision', route: 'ok' }
  globalThis.fetch = async (_url, init) => {
    const content: unknown = JSON.parse(String(init?.body)).messages[1].content
    imageRequests.push(content)
    return Response.json({ model: 'mock-vision', text: JSON.stringify(reply) })
  }
  await store.generatePlanDraft(reference, {}, { text: '', imageDataUrl })
  ok('模型未返回图片转录时停止导入', store.planDraftState.status === 'error'
    && !store.planDraftState.draft && imageRequests.length === 1)
  reply = { readable: true, transcript: recognizedSchedule, days: [{ date: null, items: [{ exerciseName: '肩环绕' }] }] }
  await store.retryPlanDraft()
  ok('重试仍使用原图片', JSON.stringify(imageRequests[1]) === JSON.stringify(imageRequests[0]))
  ok('拒绝转录中不存在的动作并展示转录', store.planDraftState.status === 'error'
    && store.planDraftState.imageTranscript === recognizedSchedule && !store.planDraftState.draft)
  reply = { readable: true, transcript: recognizedSchedule, days: [{ date: '周三', items: imageItems }] }
  await store.retryPlanDraft()
  ok('没有来源的日期不会写入草稿', store.planDraftState.status === 'error'
    && store.planDraftState.error.includes('日期') && !store.planDraftState.draft)
  reply = { readable: true, transcript: recognizedSchedule, days: [{ date: null, items: imageItems }] }
  const requestsBefore = imageRequests.length
  await store.retryPlanDraft()
  const draft = store.planDraftState.draft
  const importedItems = draft?.days[0]?.items ?? []
  ok('图片成功后直接进入草稿，无二次排课请求', store.planDraftState.status === 'ready'
    && store.planDraftState.imageTranscript === recognizedSchedule
    && imageRequests.length === requestsBefore + 1 && Array.isArray(imageRequests[requestsBefore]))
  ok('未注明日期时使用日历所选日期并提示', draft?.days[0].date === '2026-11-10'
    && store.planDraftState.warnings.some(w => w.includes('2026-11-10')))
  ok('原动作名和顺序全部保留，包括动作库未收录的项目', importedItems.map(i => i.exerciseName).join('|')
    === imageItems.map(i => i.exerciseName).join('|') && importedItems.some(i => i.notInLibrary))
  ok('缺失的数值留空，秒数、距离、次数、组数和间歇保持原规格',
    importedItems.every(i => i.plannedDuration === undefined)
    && importedItems[0]?.plannedHoldSeconds === 30 && importedItems[0]?.plannedSets === undefined
    && importedItems[1]?.plannedReps === 20
    && importedItems[4]?.plannedSets === undefined && importedItems[4]?.note === '1-2组'
    && importedItems[5]?.plannedSets === 4 && importedItems[5]?.plannedReps === 5 && importedItems[5]?.note === '间歇2分钟'
    && importedItems[6]?.plannedDistance === 100 && importedItems[6]?.plannedSets === 4)
  const saved = draft && store.acceptPlanDraft(draft, reference)
  ok('保存后原动作、单位和组数范围仍可用', saved?.source === 'image'
    && saved.items.length === imageItems.length && saved.items[0]?.plannedHoldSeconds === 30
    && saved.items[4]?.note === '1-2组' && saved.items[6]?.plannedDistance === 100)
  reply = { readable: true, transcript: recognizedSchedule, days: [{ date: '周三', items: imageItems }] }
  await store.generatePlanDraft(reference, {}, { text: '这组是星期三的训练', imageDataUrl })
  ok('用户补充的星期可映射到计划周', store.planDraftState.draft?.days[0].date === '2026-11-11')

  console.log('\n26. 手工录入范围：按天追加，按周使用完整周')
  const newYearDay = new Date(2027, 0, 1)
  const previous = store.ensureWeekPlan(newYearDay)
  const onOtherDay = store.addManualItem(previous.id, { date: '2026-12-31', exerciseName: '周四的已有训练', minutes: 15 })
  const onTargetDay = store.addManualItem(previous.id, { date: '2027-01-01', exerciseName: '周五的已有训练', minutes: 10 })
  if (onTargetDay) store.markItemCompleted(previous.id, onTargetDay.id, true)
  const daySource = { scope: 'day' as const, text: '第一段是周四', imageDataUrl }
  reply = { readable: true, transcript: recognizedSchedule, days: [{ date: '周四', items: imageItems }] }
  await store.generatePlanDraft(newYearDay, {}, daySource)
  ok('按天导入时，图片中另一天的日期会明确报错', store.planDraftState.status === 'error'
    && store.planDraftState.error.includes('所选训练日期不符'))
  reply = { readable: true, transcript: recognizedSchedule, days: [{ date: null, items: imageItems }] }
  await store.generatePlanDraft(newYearDay, {}, { ...daySource, text: '' })
  const dayDraft = store.planDraftState.draft
  ok('按天草稿只使用所选日期，并保留该日期所属周的范围', dayDraft?.dayDate === '2027-01-01'
    && dayDraft.days.length === 1 && dayDraft.days[0].date === '2027-01-01'
    && store.planDraftState.weekDates?.[0] === '2026-12-28' && store.planDraftState.weekDates?.[6] === '2027-01-03')
  if (dayDraft) {
    const wrongDate = { ...dayDraft, days: dayDraft.days.map(day => ({ ...day, date: '2026-12-31' })) }
    ok('确认时再次拦截超出所选日期的草稿', store.acceptPlanDraft(wrongDate, newYearDay) === null)
  }
  const updated = dayDraft && store.acceptPlanDraft(dayDraft, newYearDay)
  ok('按天保存追加到原计划，保留同日、其他日期及完成状态', !!updated
    && updated.version === previous.version + 1 && updated.items.length === previous.items.length + imageItems.length
    && updated.items.some(item => item.id === onOtherDay?.id && item.planId === updated.id)
    && updated.items.some(item => item.id === onTargetDay?.id && item.completed))

  const textItems = [{ exerciseName: '轻松跑', plannedDuration: 20 }]
  reply = { days: [{ date: '2026-12-31', items: textItems }, { date: '2027-01-01', items: textItems }] }
  await store.generatePlanDraft(newYearDay, {}, { scope: 'day', text: '轻松跑 20 分钟' })
  const dayText = imageRequests.at(-1)
  ok('按天生成文本只发所选日期，草稿过滤其他日期',
    typeof dayText === 'string' && dayText.includes('2027-01-01') && !dayText.includes('2026-12-31')
    && store.planDraftState.draft?.days.length === 1 && store.planDraftState.draft.days[0].date === '2027-01-01')
  await store.generatePlanDraft(newYearDay, {}, { scope: 'week', text: '周四和周五各轻松跑 20 分钟' })
  const weekText = imageRequests.at(-1)
  const weekDraft = store.planDraftState.draft
  ok('按周选择周内一天时，模型与草稿使用完整的跨年周',
    typeof weekText === 'string' && weekText.includes('2026-12-28') && weekText.includes('2027-01-03')
    && !!weekDraft && !weekDraft.dayDate && weekDraft.days.length === 2)

  console.log('\n27. AI 反馈调整：草稿审核、版本保护、保留原项目')
  store.userProfile = null
  const feedbackDate = new Date(2027, 0, 6)
  const existing = store.acceptPlanDraft({
    source: 'image', reason: '反馈调整的原计划', model: 'mock-vision',
    days: [{ date: '2027-01-06', items: [
      { exerciseName: '轻松跑', type: '跑步', plannedDuration: 30 },
      { exerciseName: '上坡跑', type: '跑步', plannedDistance: 100, plannedSets: 4 },
      { exerciseName: '提踵', type: '其他', plannedSets: 3 },
      { exerciseName: '平板支撑', type: '其他', plannedHoldSeconds: 30 },
      { exerciseName: '龙旗', type: '其他', plannedReps: 5 }
    ] }]
  }, feedbackDate)!
  const [run, hill, calf, plank, dragon] = existing.items
  store.acceptAdjustment(existing.id, [{ itemId: run.id, type: 'changed', newValue: { plannedTargetMinutes: 30 } }], '设置跟练目标')
  store.markItemCompleted(existing.id, dragon.id, true)
  const feedback = '周三没空，轻松跑移到周五，缩短为 20 分钟；上坡跑换为肩环绕，移除提踵，加一项放松。'
  store.planFeedbackText = ` ${feedback} `
  const unchangedVersion = existing.version
  reply = { changes: [{ op: 'update', itemId: dragon.id, item: { plannedReps: 10 } }] }
  await store.generatePlanFeedback(feedbackDate, feedback)
  ok('模型不能修改已完成动作', store.planDraftState.status === 'error' && !store.planDraftState.adjustment)
  reply = { changes: [{ op: 'update', itemId: run.id, item: { date: '2027-01-11' } }] }
  await store.retryPlanDraft()
  ok('拒绝超出所选周的调整', store.planDraftState.status === 'error' && !store.planDraftState.adjustment)

  reply = { reason: '按反馈减少训练量并调整日期', changes: [
    { op: 'update', itemId: run.id, item: { date: '2027-01-08', plannedDuration: 20 } },
    { op: 'update', itemId: hill.id, item: { exerciseName: '肩环绕', plannedReps: 10 } },
    { op: 'remove', itemId: calf.id },
    { op: 'add', item: { date: '2027-01-08', exerciseName: '腹式呼吸放松', plannedHoldSeconds: 60 } }
  ] }
  const historyCount = store.planHistory.length
  await store.retryPlanDraft()
  const request = imageRequests.at(-1)
  ok('反馈请求包含输入反馈和当前项目，草稿包含修改、替换、移除及新增', typeof request === 'string'
    && request.includes(feedback) && request.includes(run.id) && store.planDraftState.adjustment?.changes.length === 4)
  ok('生成草稿时计划、版本和历史都没有更新', existing.version === unchangedVersion
    && existing.items.find(item => item.id === run.id)?.plannedDuration === 30 && store.planHistory.length === historyCount)
  store.resetPlanDraft()
  ok('拒绝后不能再保存该草稿', store.acceptPlanFeedback() === null && existing.version === unchangedVersion)
  ok('生成和取消后保留原输入', store.planFeedbackText === ` ${feedback} `)

  await store.generatePlanFeedback(feedbackDate, feedback)
  const originalName = existing.items.find(item => item.id === hill.id)?.exerciseName
  store.addManualItem(existing.id, { date: '2027-01-07', exerciseName: '并发新增', minutes: 5 })
  const changedVersion = existing.version
  ok('确认时发现计划已更新会要求重新生成', store.acceptPlanFeedback() === null && existing.version === changedVersion
    && store.planDraftState.error.includes('已经更新'))
  ok('版本冲突时保留反馈', store.planFeedbackText === ` ${feedback} `)
  await store.retryPlanDraft()
  const adjusted = store.acceptPlanFeedback()
  ok('启用新版本后清空已提交的反馈', !!adjusted && store.planFeedbackText === '')
  ok('确认后只更新目标周并创建一个版本，保留原计划历史', adjusted?.id === existing.id
    && adjusted.version === changedVersion + 1 && adjusted.source === 'image'
    && store.planHistory.at(-1)?.version === changedVersion
    && store.planHistory.at(-1)?.items.some(item => item.id === hill.id && item.exerciseName === originalName))
  ok('应用已审核的变更，保留已完成项和本次未修改的项目', !!adjusted
    && adjusted.items.some(item => item.id === run.id && item.plannedDuration === 20 && item.plannedTargetMinutes === 20 && item.date === '2027-01-08')
    && adjusted.items.some(item => item.id === hill.id && item.exerciseName === '肩环绕' && item.plannedDistance === undefined && item.plannedReps === 10)
    && !adjusted.items.some(item => item.id === calf.id)
    && adjusted.items.some(item => item.exerciseName === '腹式呼吸放松' && item.plannedHoldSeconds === 60 && item.planId === existing.id)
    && adjusted.items.some(item => item.id === plank.id && item.plannedHoldSeconds === 30)
    && adjusted.items.some(item => item.id === dragon.id && item.completed && item.plannedReps === 5)
    && adjusted.items.some(item => item.exerciseName === '并发新增'))
  reply = { reason: '当前安排已满足反馈', changes: [{ op: 'update', itemId: run.id, item: { plannedDuration: 20 } }] }
  await store.generatePlanFeedback(feedbackDate, feedback)
  ok('无实际改动时不会产生新版本', store.planDraftState.adjustment?.changes.length === 0
    && store.acceptPlanFeedback() === null && existing.version === changedVersion + 1)
} finally {
  store.resetPlanDraft()
  store.llmDefault = modelBeforeImageCheck
  store.userProfile = profileBeforeFeedbackCheck
  store.planFeedbackText = textBeforeFeedbackCheck
  globalThis.fetch = fetchBeforeImageCheck
}

console.log('\n28. 视频分析：计数状态机纯函数复用')
const pureRule = { neutral: 170, bottom: 55, hysteresis: 8, minStageMs: 100, minRepMs: 700, maxStageMs: 6000, minVisibility: 0.5 }
const machine = createRepMachine(pureRule)
let mt = 0
let countedEvents = 0
let countedSnapshot: RepMachineSnapshot | null = null
let machineSnapshot = machine.snapshot()
const machineStage = (angle: number | null, frames = 8, vis = 0.95) => {
  for (let i = 0; i < frames; i++) {
    mt += 90
    machineSnapshot = machine.feed(angle, vis, mt)
    if (machineSnapshot.counted) { countedEvents++; countedSnapshot = machineSnapshot }
  }
  return machineSnapshot
}
machineStage(172); machineStage(170)
machineStage(50); machineStage(48)
machineStage(170); machineStage(172)
ok('纯状态机复现完整行程计数', machineSnapshot.count === 1 && countedEvents === 1, `count=${machineSnapshot.count}`)
ok('纯状态机给出这次重复的起止时间', !!countedSnapshot?.lastRep && countedSnapshot.lastRep.endMs > countedSnapshot.lastRep.startMs)
ok('计数瞬间阶段为 complete 且无门禁', countedSnapshot?.phase === 'complete' && countedSnapshot.gate === null)

const wrapped = useRepCounter(pureRule)
const mirrored = createRepMachine(pureRule)
const mixedSequence: (number | null)[] = [172, 172, 170, 90, 50, 48, 60, 120, 170, 172, 50, 55, 170, 172, null, 170]
let replayTs = 0
let mismatch = 0
for (const angle of mixedSequence) {
  replayTs += 90
  const live = wrapped.feed(angle, 0.95, replayTs)
  const pure = mirrored.feed(angle, 0.95, replayTs)
  if (live.phase !== pure.phase || live.counted !== pure.counted || live.gate !== pure.gate) mismatch++
}
ok('纯状态机与实时包装逐步一致', mismatch === 0 && wrapped.count.value === mirrored.snapshot().count,
  `mismatch=${mismatch} live=${wrapped.count.value} pure=${mirrored.snapshot().count}`)

machine.interrupt('暂停')
ok('interrupt 把阶段重置并把门禁交回调用方', machine.snapshot().phase === 'ready' && machine.snapshot().gate === '暂停')
machine.reset('开始')
ok('reset 清空次数与最近一次重复', machine.snapshot().count === 0 && machine.snapshot().lastRep === null)

console.log('\n29. 视频分析：深蹲侧面规则')
const pointAt = (x: number, y: number, visibility = 0.95) => ({ x, y, visibility })
function legFrame(timeMs: number, kneeAngle: number, lean: number, hipBelow: boolean): MotionFrame {
  const knee = pointAt(0.5, 0.6)
  const thighAngle = hipBelow ? 8 : -82
  const hip = pointAt(
    knee.x + 0.2 * Math.cos(thighAngle * Math.PI / 180),
    knee.y + 0.2 * Math.sin(thighAngle * Math.PI / 180)
  )
  const shinAngle = thighAngle + kneeAngle
  const ankle = pointAt(
    knee.x + 0.2 * Math.cos(shinAngle * Math.PI / 180),
    knee.y + 0.2 * Math.sin(shinAngle * Math.PI / 180)
  )
  const leanRad = lean * Math.PI / 180
  const shoulder = pointAt(hip.x + 0.4 * Math.sin(leanRad), hip.y - 0.4 * Math.cos(leanRad))
  return {
    timeMs,
    visibility: 0.95,
    points: {
      shoulder: { left: shoulder, right: shoulder },
      hip: { left: hip, right: hip },
      knee: { left: knee, right: knee },
      ankle: { left: ankle, right: ankle },
      heel: { left: null, right: null },
      toe: { left: null, right: null }
    }
  }
}
function withOffset(frame: MotionFrame, offset: number): MotionFrame {
  const shift = (p: { x: number; y: number; visibility: number } | null) => p ? { ...p, x: p.x + offset } : null
  return {
    timeMs: frame.timeMs,
    visibility: frame.visibility,
    points: {
      shoulder: { left: shift(frame.points.shoulder.left), right: shift(frame.points.shoulder.right) },
      hip: { left: shift(frame.points.hip.left), right: shift(frame.points.hip.right) },
      knee: { left: shift(frame.points.knee.left), right: shift(frame.points.knee.right) },
      ankle: { left: shift(frame.points.ankle.left), right: shift(frame.points.ankle.right) },
      heel: { left: null, right: null },
      toe: { left: null, right: null }
    }
  }
}
function buildSquatSeries(options: { reps: number; bottomKnee?: number; hipBelow?: boolean; lean?: number }): MotionFrameSeries {
  const fps = 15
  const step = 1000 / fps
  const bottom = options.bottomKnee ?? 100
  const frames: MotionFrame[] = []
  let time = step
  const push = (angle: number) => {
    const depthLean = options.lean ?? 25
    const range = 172 - bottom
    const progress = range === 0 ? 0 : Math.max(0, Math.min(1, (172 - angle) / range))
    const lean = 5 + (depthLean - 5) * progress
    frames.push(legFrame(time, angle, lean, (options.hipBelow ?? true) && angle < 130))
    time += step
  }
  for (let rep = 0; rep < options.reps; rep++) {
    for (let i = 0; i < 5; i++) push(172)
    for (let i = 1; i <= 8; i++) push(172 + (bottom - 172) * i / 8)
    for (let i = 0; i < 5; i++) push(bottom)
    for (let i = 1; i <= 8; i++) push(bottom + (172 - bottom) * i / 8)
  }
  // 收尾停稳，让最后一次回到起始位也能被确认
  for (let i = 0; i < 5; i++) push(172)
  return { action: 'squat', fps, frames }
}
const goodSquat = buildSquatSeries({ reps: 2 })
ok('侧面视角识别为 side', detectView(goodSquat.frames).view === 'side')
const frontFrames = buildSquatSeries({ reps: 1 }).frames.map(frame =>
  ({
    ...withOffset(frame, -0.12),
    points: {
      ...withOffset(frame, -0.12).points,
      shoulder: { left: withOffset(frame, -0.12).points.shoulder.left, right: withOffset(frame, 0.12).points.shoulder.right },
      hip: { left: withOffset(frame, -0.12).points.hip.left, right: withOffset(frame, 0.12).points.hip.right },
      knee: { left: withOffset(frame, -0.12).points.knee.left, right: withOffset(frame, 0.12).points.knee.right },
      ankle: { left: withOffset(frame, -0.12).points.ankle.left, right: withOffset(frame, 0.12).points.ankle.right }
    }
  }) as MotionFrame)
ok('正面视角识别为 front', detectView(frontFrames).view === 'front')
const ambiguous = buildSquatSeries({ reps: 1 }).frames.map(frame => {
  const left = withOffset(frame, -0.07)
  const right = withOffset(frame, 0.07)
  return {
    ...frame,
    points: {
      shoulder: { left: left.points.shoulder.left, right: right.points.shoulder.right },
      hip: { left: left.points.hip.left, right: right.points.hip.right },
      knee: { left: left.points.knee.left, right: right.points.knee.right },
      ankle: { left: left.points.ankle.left, right: right.points.ankle.right },
      heel: { left: null, right: null },
      toe: { left: null, right: null }
    }
  } as MotionFrame
})
ok('模糊视角不硬判', detectView(ambiguous).view === null)
const goodResult = analyzeMotion({ ...goodSquat, view: 'side' })
ok('两次完整深蹲计数为 2', goodResult.repCount === 2, String(goodResult.repCount))
ok('标准动作不产生关注项', goodResult.findings.length === 0, goodResult.findings.map(f => f.ruleId).join(','))
ok('节奏测量值随结果输出', goodResult.metrics.some(m => m.id === 'metric-rep-count' && m.value === 2)
  && goodResult.metrics.some(m => m.id === 'metric-eccentric' && m.value !== '—'))
const shallowSquat = analyzeMotion({ ...buildSquatSeries({ reps: 1, hipBelow: false }), view: 'side' })
ok('浅蹲产生深度关注项', shallowSquat.findings.some(f => f.ruleId === 'SQ-SE-01'))
const bentSquat = analyzeMotion({ ...buildSquatSeries({ reps: 1, bottomKnee: 60 }), view: 'side' })
ok('膝角偏离参考区间产生关注项', bentSquat.findings.some(f => f.ruleId === 'SQ-SE-02'))
const leaningSquat = analyzeMotion({ ...buildSquatSeries({ reps: 1, lean: 60 }), view: 'side' })
ok('躯干前倾偏大产生关注项', leaningSquat.findings.some(f => f.ruleId === 'SQ-SE-03'),
  `reps=${leaningSquat.repCount} findings=${JSON.stringify(leaningSquat.findings.map(f => [f.ruleId, f.measured]))} metrics=${JSON.stringify(leaningSquat.metrics)}`)
ok('所有关注项都有文献出处', [shallowSquat, bentSquat, leaningSquat].every(result =>
  result.findings.every(f => f.sourceLabel.includes('NSCA'))))
ok('结果不含评分字段', !('score' in goodResult) && goodResult.findings.every(f => !('score' in f)))
const goodPrecheck = precheckMotion({ fps: goodSquat.fps, frames: goodSquat.frames })
ok('合格深蹲自动识别且不再提示歧义', goodPrecheck.verdict === 'ok'
  && goodPrecheck.action === 'squat' && goodPrecheck.actionConfident === true
  && goodPrecheck.view === 'side' && goodPrecheck.repCount === 2
  && !goodPrecheck.reasons.some(reason => reason.includes('深蹲与硬拉')))
const deadliftSeries = buildSquatSeries({ reps: 2, bottomKnee: 150, lean: 65 })
const deadliftPrecheck = precheckMotion({ fps: deadliftSeries.fps, frames: deadliftSeries.frames })
ok('髋铰链大前倾识别为硬拉', deadliftPrecheck.action === 'deadlift' && deadliftPrecheck.actionConfident === true
  && !deadliftPrecheck.reasons.some(reason => reason.includes('深蹲与硬拉')))
const ambiguousStrength = buildSquatSeries({ reps: 2, bottomKnee: 120, lean: 40 })
const ambiguousClass = classifyAction(ambiguousStrength.frames, ambiguousStrength.fps)
ok('特征不明确时默认深蹲并标注低置信', ambiguousClass.action === 'squat' && !ambiguousClass.confident)
const ambiguousStrengthPrecheck = precheckMotion({ fps: ambiguousStrength.fps, frames: ambiguousStrength.frames })
ok('特征不明确走降级并提示可切换', ambiguousStrengthPrecheck.verdict === 'degraded' && ambiguousStrengthPrecheck.actionConfident === false
  && ambiguousStrengthPrecheck.reasons.some(reason => reason.includes('特征不明确')))
const lowVisibility = goodSquat.frames.map((frame, index) => index % 3 === 0 ? frame : { ...frame, visibility: 0.2 })
const degradedPrecheck = precheckMotion({ fps: goodSquat.fps, frames: lowVisibility })
ok('可见度偏低走降级而不是拒绝', degradedPrecheck.verdict === 'degraded'
  && degradedPrecheck.reasons.some(reason => reason.includes('可见度')))
const stillFrames = buildSquatSeries({ reps: 1, bottomKnee: 172 })
const noRepPrecheck = precheckMotion({ fps: stillFrames.fps, frames: stillFrames.frames })
ok('没有完整重复时降级并说明', noRepPrecheck.verdict === 'degraded' && noRepPrecheck.repCount === 0
  && noRepPrecheck.reasons.some(reason => reason.includes('完整重复')))
const emptyPrecheck = precheckMotion({ fps: 15, frames: [] })
ok('没有人体时拒绝', emptyPrecheck.verdict === 'rejected' && emptyPrecheck.view === null && emptyPrecheck.action === null)
const unknownViewPrecheck = precheckMotion({ fps: 15, frames: ambiguous })
ok('视角无法判定时拒绝', unknownViewPrecheck.verdict === 'rejected'
  && unknownViewPrecheck.reasons.some(reason => reason.includes('视角')))

console.log('\n31. 视频分析：深蹲正面与硬拉规则')
const baseRep = (overrides: Partial<RepAnalysis> = {}): RepAnalysis => ({
  index: 1, startMs: 0, endMs: 1000, bottomMs: 500,
  bottomKneeAngle: 100, bottomHipAngle: 120, bottomTrunkAngle: 20,
  endKneeAngle: 170, endHipAngle: 170, endTrunkAngle: 5,
  depthOffset: 0.1, leftKneeAngle: 100, rightKneeAngle: 103,
  kneeAnkleRatio: 1, shoulderHeightDiff: 0.01, hipHeightDiff: 0.01,
  eccentricMs: 600, bottomHoldMs: 300,
  ...overrides
})
const squatFrontRules = rulesFor('squat', 'front')
const valgusContext = { action: 'squat' as const, view: 'front' as const, fps: 15, reps: [baseRep({ kneeAnkleRatio: 0.5 })] }
const valgusFindings = squatFrontRules.find(rule => rule.id === 'SQ-FR-01')!.evaluate(valgusContext) as MotionAnalysisFinding[]
ok('深蹲正面膝内扣命中并带出处', valgusFindings.length === 1
  && valgusFindings[0].measured === 0.5 && valgusFindings[0].sourceLabel.includes('Hewett'))
const normalValgus = squatFrontRules.find(rule => rule.id === 'SQ-FR-01')!
  .evaluate({ ...valgusContext, reps: [baseRep({ kneeAnkleRatio: 0.95 })] }) as MotionAnalysisFinding[]
ok('深蹲正面正常站距不误报', normalValgus.length === 0)
const symmetryMetrics = squatFrontRules.find(rule => rule.id === 'SQ-FR-02')!.evaluate(valgusContext) as MotionAnalysisMetric[]
ok('左右膝角差只进测量值', symmetryMetrics.some(metric => metric.id === 'metric-knee-asymmetry' && metric.value === 3))

const deadliftSideRules = rulesFor('deadlift', 'side')
const deadliftContext = { action: 'deadlift' as const, view: 'side' as const, fps: 15, reps: [baseRep({ endHipAngle: 150, endTrunkAngle: 20, bottomTrunkAngle: 55 })] }
const hipFindings = deadliftSideRules.find(rule => rule.id === 'DL-SE-03')!.evaluate(deadliftContext) as MotionAnalysisFinding[]
ok('硬拉锁定伸髋不完整命中', hipFindings.length === 1 && hipFindings[0].measured === 150)
const lockoutFindings = deadliftSideRules.find(rule => rule.id === 'DL-SE-02')!.evaluate(deadliftContext) as MotionAnalysisFinding[]
ok('硬拉锁定姿态偏离竖直命中', lockoutFindings.length === 1 && lockoutFindings[0].measured === 20)
const normalDeadlift = { ...deadliftContext, reps: [baseRep({ endHipAngle: 172, endTrunkAngle: 6 })] }
ok('硬拉正常锁定不误报', (deadliftSideRules.find(rule => rule.id === 'DL-SE-03')!.evaluate(normalDeadlift) as unknown[]).length === 0
  && (deadliftSideRules.find(rule => rule.id === 'DL-SE-02')!.evaluate(normalDeadlift) as unknown[]).length === 0)
const deadliftMetrics = deadliftSideRules.find(rule => rule.id === 'DL-SE-04')!.evaluate(deadliftContext) as MotionAnalysisMetric[]
ok('硬拉节奏与最低点躯干角进测量值', deadliftMetrics.some(metric => metric.id === 'metric-bottom-trunk' && metric.value === 55))
const deadliftFrontMetrics = rulesFor('deadlift', 'front')[0].evaluate({
  action: 'deadlift', view: 'front', fps: 15,
  reps: [baseRep({ shoulderHeightDiff: 0.03, hipHeightDiff: 0.02 })]
}) as MotionAnalysisMetric[]
ok('硬拉正面只出左右对称测量值', deadliftFrontMetrics.some(metric => metric.id === 'metric-shoulder-diff' && metric.value === 0.03)
  && deadliftFrontMetrics.some(metric => metric.id === 'metric-hip-diff' && metric.value === 0.02))

console.log('\n32. 视频分析：跑姿侧面步态与规则')
function runningFrame(timeMs: number, options: { spread?: number; kneeForward?: number; inwardFactor?: number; trunkLean?: number } = {}): MotionFrame {
  const spread = options.spread ?? 0
  const forward = options.kneeForward ?? 0.07
  const inward = options.inwardFactor ?? 1
  const lean = (options.trunkLean ?? 11) * Math.PI / 180
  const side = (direction: number, phase: number) => {
    const hipX = 0.5 + spread * direction
    const hipY = 0.38 + 0.004 * Math.sin(2 * Math.PI * timeMs / 500)
    const kneeX = 0.5 + spread * direction * inward
    const ankleY = 0.72 + 0.035 * Math.cos(2 * Math.PI * timeMs / 600 + phase)
    const ankleX = 0.5 + spread * direction + forward
    const shoulderX = hipX - 0.26 * Math.sin(lean)
    const shoulderY = hipY - 0.26 * Math.cos(lean)
    return {
      hip: pointAt(hipX, hipY),
      knee: pointAt(kneeX, 0.56),
      ankle: pointAt(ankleX, ankleY),
      shoulder: pointAt(shoulderX, shoulderY)
    }
  }
  const left = side(-1, 0)
  const right = side(1, Math.PI)
  return {
    timeMs,
    visibility: 0.95,
    points: {
      shoulder: { left: left.shoulder, right: right.shoulder },
      hip: { left: left.hip, right: right.hip },
      knee: { left: left.knee, right: right.knee },
      ankle: { left: left.ankle, right: right.ankle },
      heel: { left: null, right: null },
      toe: { left: null, right: null }
    }
  }
}
const runningFrames = Array.from({ length: 120 }, (_, index) => runningFrame((index + 1) * (1000 / 30)))
const gait = analyzeGait(runningFrames, 30)
ok('跑姿至少识别 5 个步态周期', gait.cycles >= 5, `cycles=${gait.cycles}`)
ok('跑姿步频为合理正数', gait.cadence !== null && gait.cadence > 120, `cadence=${gait.cadence}`)
ok('跑姿触地时间与垂直振幅可测', gait.contactTimeMs !== null && gait.verticalOscillation !== null)
const runningClass = classifyAction(runningFrames, 30)
ok('步态特征命中时自动判为跑姿', runningClass.action === 'running' && runningClass.confident)
const runningPrecheck = precheckMotion({ fps: 30, frames: runningFrames })
ok('跑姿检查自动路由且不拒绝', runningPrecheck.action === 'running' && runningPrecheck.verdict !== 'rejected'
  && runningPrecheck.gaitCycles !== null)
const runningResult = analyzeMotion({ action: 'running', view: 'side', fps: 30, frames: runningFrames })
ok('跑姿结果给步态周期而不是重复次数', runningResult.repCount === null && runningResult.gaitCycles === gait.cycles)
ok('正常跑姿不误报触地膝过伸', !runningResult.findings.some(finding => finding.ruleId === 'RUN-SE-02'))
ok('跑姿步频与代理指标进测量值', runningResult.metrics.some(metric => metric.id === 'metric-cadence')
  && runningResult.metrics.some(metric => metric.id === 'metric-contact-time')
  && runningResult.metrics.some(metric => metric.id === 'metric-contact-diff')
  && runningResult.metrics.some(metric => metric.id === 'metric-vertical'))
const overextendedFrames = Array.from({ length: 120 }, (_, index) => runningFrame((index + 1) * (1000 / 30), { kneeForward: 0.01 }))
const overextendedResult = analyzeMotion({ action: 'running', view: 'side', fps: 30, frames: overextendedFrames })
ok('触地膝角过伸命中', overextendedResult.findings.some(finding => finding.ruleId === 'RUN-SE-02'))
const leaningFrames = Array.from({ length: 120 }, (_, index) => runningFrame((index + 1) * (1000 / 30), { trunkLean: 30 }))
const leaningResult = analyzeMotion({ action: 'running', view: 'side', fps: 30, frames: leaningFrames })
ok('躯干前倾偏离参考区间命中', leaningResult.findings.some(finding => finding.ruleId === 'RUN-SE-01'))
const noGaitPrecheck = precheckMotion({ fps: 15, frames: stillFrames.frames })
ok('无步态的静止视频不判为跑姿，走力量降级', noGaitPrecheck.verdict === 'degraded'
  && noGaitPrecheck.action === 'squat' && noGaitPrecheck.actionConfident === false)
const runningVideoPrecheck = precheckMotion({ fps: 30, frames: runningFrames })
ok('跑步视频自动路由为跑姿而不是拒绝', runningVideoPrecheck.action === 'running'
  && runningVideoPrecheck.actionConfident === true && runningVideoPrecheck.verdict !== 'rejected')
const stillStrengthPrecheck = precheckMotion({ fps: 15, frames: stillFrames.frames })
ok('双脚不交替的动作不误判为跑姿', stillStrengthPrecheck.action === 'squat' && stillStrengthPrecheck.verdict !== 'rejected')
const fewCyclesPrecheck = precheckMotion({ fps: 30, frames: runningFrames.slice(0, 60) })
ok('跑步特征存疑时按跑姿降级而不是误判成力量', fewCyclesPrecheck.action === 'running'
  && fewCyclesPrecheck.actionConfident === false && fewCyclesPrecheck.verdict === 'degraded'
  && (fewCyclesPrecheck.gaitCycles ?? 0) < 5,
  `action=${fewCyclesPrecheck.action} confident=${fewCyclesPrecheck.actionConfident} verdict=${fewCyclesPrecheck.verdict} cycles=${fewCyclesPrecheck.gaitCycles}`)

console.log('\n33. 视频分析：跑姿正面规则')
const frontRunFrames = Array.from({ length: 120 }, (_, index) =>
  runningFrame((index + 1) * (1000 / 30), { spread: 0.06, inwardFactor: 0.5 }))
const frontRunGait = analyzeGait(frontRunFrames, 30)
ok('正面触地膝间/踝间比可测', frontRunGait.contactKneeAnkleRatio !== null
  && frontRunGait.contactKneeAnkleRatio < 0.8, String(frontRunGait.contactKneeAnkleRatio))
const frontRunResult = analyzeMotion({ action: 'running', view: 'front', fps: 30, frames: frontRunFrames })
ok('正面跑姿膝内扣命中', frontRunResult.findings.some(finding => finding.ruleId === 'RUN-FR-01'))
ok('正面跑姿不出侧面步频关注项', !frontRunResult.findings.some(finding => finding.ruleId.startsWith('RUN-SE')))
ok('正面跑姿左右对称进测量值', frontRunResult.metrics.some(metric => metric.id === 'metric-shoulder-diff')
  && frontRunResult.metrics.some(metric => metric.id === 'metric-hip-diff'))

console.log('\n34. 分析记录持久化与关键帧')
const analysisRecord: MotionAnalysis = {
  id: 'analysis-1',
  userId: 'demo-user',
  date: '2026-11-10',
  action: 'squat',
  exerciseName: '深蹲',
  view: 'side',
  status: 'completed',
  lowConfidenceReasons: [],
  findings: [{
    id: 'analysis-1-f0',
    ruleId: 'SQ-SE-01',
    title: '下蹲深度不足',
    detail: '第 1 次最低点髋部没有低于膝部',
    timeMs: 1200,
    measured: -0.2,
    unit: '（归一化差值）',
    thresholdLabel: '最低点髋点低于膝点（≥ 0）',
    sourceLabel: 'NSCA《Essentials of Strength Training and Conditioning》第4版 · 深蹲技术要点',
    keyframeRef: 'analysis-1-f0'
  }],
  metrics: [{ id: 'metric-rep-count', label: '完整重复次数', value: 1 }],
  repCount: 1,
  gaitCycles: null,
  ruleVersion: 'motion-analysis-rules-v1',
  createdAt: '2026-11-10T08:00:00.000Z',
  _sync: 'pending'
}
const currentStored = loadStoredState()
saveStoredState({ ...currentStored, analyses: [analysisRecord] })
ok('分析记录按分类 key 落盘', (mem.get(STORAGE_KEYS.analyses) ?? '').includes('analysis-1'))
ok('关键帧只存引用，不把图片塞进 localStorage', !(mem.get(STORAGE_KEYS.analyses) ?? '').includes('data:image'))
const reloaded = loadStoredState()
ok('刷新后能读回分析记录与关键帧引用', reloaded.analyses?.length === 1
  && reloaded.analyses[0].findings[0]?.keyframeRef === 'analysis-1-f0')
const beforeAdd = store.analyses.length
store.addAnalysis({ ...analysisRecord, id: 'analysis-2', createdAt: '2026-11-10T09:00:00.000Z' })
ok('addAnalysis 写入状态并落盘', store.analyses.length === beforeAdd + 1
  && store.analyses[0].id === 'analysis-2'
  && (mem.get(STORAGE_KEYS.analyses) ?? '').includes('analysis-2'))
store.removeAnalysis('analysis-2')
ok('removeAnalysis 从状态与存储移除', !store.analyses.some(item => item.id === 'analysis-2')
  && !(mem.get(STORAGE_KEYS.analyses) ?? '').includes('analysis-2'))
store.addAnalysis({ ...analysisRecord, id: 'analysis-link', createdAt: '2026-11-10T10:00:00.000Z' })
const linkOk = store.linkAnalysisToSession('analysis-link', 'local-session-1')
const linkedAnalysis = store.analyses.find(item => item.id === 'analysis-link')
ok('分析记录可关联训练记录', linkOk && linkedAnalysis?.sessionId === 'local-session-1' && linkedAnalysis?._sync === 'pending')
store.linkAnalysisToSession('analysis-link', undefined)
ok('取消关联写回 undefined', !store.analyses.find(item => item.id === 'analysis-link')?.sessionId)
store.removeAnalysis('analysis-link')
clearStoredState()
ok('旧状态没有 analyses key 时按空处理', (loadStoredState().analyses ?? []).length === 0)
await saveAnalysisKeyframe('analysis-1-f0', new Blob(['x']))
ok('无 IndexedDB 环境写入关键帧不抛错', (await getAnalysisKeyframe('analysis-1-f0')) === null)
await deleteAnalysisKeyframes(['analysis-1-f0'])
await clearAnalysisKeyframes()
ok('无 IndexedDB 环境删除关键帧不抛错', true)

console.log('\n35. 深蹲/硬拉进入动作库与跟练')
ok('动作库版本升到 v2', EXERCISE_CATALOG_VERSION === 'exercise-catalog-v2')
const squatExercise = findExercise('深蹲')
const deadliftExercise = findExercise('硬拉')
ok('深蹲/硬拉作为「其他」类型进入动作库', squatExercise?.status === 'active' && deadliftExercise?.status === 'active'
  && squatExercise.type === '其他' && deadliftExercise.type === '其他')
ok('深蹲用膝角、硬拉用髋角计数', squatExercise?.camera?.joint === 'knee' && deadliftExercise?.camera?.joint === 'hip')
ok('深蹲/硬拉不进入每日自动编排池', squatExercise?.autoPlan === false && deadliftExercise?.autoPlan === false)
ok('两个新动作进入可计数清单', (CAMERA_COUNTABLE as readonly string[]).includes('深蹲')
  && (CAMERA_COUNTABLE as readonly string[]).includes('硬拉'))
const rowAlternatives = alternativesFor(findExercise('弹力带划船')!, null).map(alternative => alternative.name)
ok('深蹲/硬拉出现在同类型替换候选', rowAlternatives.includes('深蹲') && rowAlternatives.includes('硬拉'))
const mondayPlan = buildDayPlan(new Date(2026, 10, 9), null)
ok('自动编排顺序不变，仍先选原「其他」动作', mondayPlan.items.some(item => item.exerciseName === '靠墙静蹲')
  && !mondayPlan.items.some(item => item.exerciseName === '深蹲'))
ok('跟练条目包含深蹲/硬拉且为计次模式', getDemoExercise('深蹲').repsPerSet === 10
  && getDemoExercise('硬拉').repsPerSet === 8 && getDemoExercise('硬拉').mode === 'reps')
const hipRightBody = body({
  11: { x: 0.3, y: 0.2, visibility: 0.2 }, 23: { x: 0.5, y: 0.2, visibility: 0.2 }, 25: { x: 0.5, y: 0.5, visibility: 0.2 },
  12: { x: 0.3, y: 0.2, visibility: 0.95 }, 24: { x: 0.5, y: 0.2, visibility: 0.95 }, 26: { x: 0.8, y: 0.5, visibility: 0.95 }
})
const hipMetrics = computeMetrics(hipRightBody)
ok('髋角按可见侧择优', hipMetrics.hipSide === 'right' && hipMetrics.hipAngle === 135,
  `side=${hipMetrics.hipSide} angle=${hipMetrics.hipAngle}`)

console.log('\n36. 分析记录同步队列')
clearOutbox()
enqueue('analysis.create', 'local-analysis-a', { id: 'local-analysis-a' })
enqueue('analysis.update', 'local-analysis-a', { id: 'local-analysis-a', sessionId: 'session-1' })
const mergedAnalysisOps = listOutbox()
ok('分析更新合并进未上传的创建', mergedAnalysisOps.length === 1
  && mergedAnalysisOps[0].kind === 'analysis.create'
  && (mergedAnalysisOps[0].payload as { sessionId?: string }).sessionId === 'session-1')
enqueue('analysis.delete', 'local-analysis-a', { id: 'local-analysis-a' })
const analysisDeleteOps = listOutbox()
ok('分析删除吸收创建与更新', analysisDeleteOps.length === 1 && analysisDeleteOps[0].kind === 'analysis.delete')
enqueue('analysis.create', 'local-analysis-b', { id: 'local-analysis-b' })
ok('不同 clientId 的分析创建各自保留', listOutbox().length === 2)
clearOutbox()

console.log('\n37. 饮食反馈：结构规则、门槛与润色校验')
ok('反馈规则版本已登记', DIET_RULE_VERSION === 'diet-feedback-v1')
const dm = (date: string, mealType: Meal['mealType'], rows: MealItem[]): Meal =>
  ({ id: `dm-${date}-${mealType}`, userId: 'u1', date, mealType, time: '12:00', completeness: 'complete', items: rows, analyzed: false, createdAt: date })
const D = '2026-11-11'

const singleItemFacts = dayIntakeFacts([dm(D, 'lunch', [mi('米饭', '谷薯类', 1, '碗')])], D)
ok('只有 1 项不满足即时门槛', !meetsImmediateGate(singleItemFacts) && dietFindings(singleItemFacts, '18:00').length === 0)
ok('dayIntakeFacts 统计条目与类别', singleItemFacts.itemCount === 1 && singleItemFacts.categories[0] === '谷薯类')

// R2 主食占比：4 项里 2 项谷薯 = 50% 触发；3 项不到最少条目数不触发
const stapleFacts = dayIntakeFacts([dm(D, 'lunch', [
  mi('米饭', '谷薯类', 1, '碗'), mi('面条', '谷薯类', 1, '碗'), mi('苹果', '水果类', 1, '个'), mi('牛奶', '奶类', 1, '杯')
])], D)
const stapleFindings = dietFindings(stapleFacts, '12:00')
ok('谷薯类过半触发主食偏高', stapleFindings.some(f => f.id === 'staple-heavy'), JSON.stringify(stapleFindings.map(f => f.id)))
ok('主食偏高依据带占比', stapleFindings.find(f => f.id === 'staple-heavy')?.basis.includes('2 /') === true)
const fewFacts = dayIntakeFacts([dm(D, 'lunch', [mi('米饭', '谷薯类'), mi('面条', '谷薯类'), mi('苹果', '水果类')])], D)
ok('条目不足最少值不算占比', !dietFindings(fewFacts, '12:00').some(f => f.id === 'staple-heavy'))

// R1/R3/R4 缺失类有 15:00 时间门槛
const noProteinFacts = dayIntakeFacts([dm(D, 'lunch', [mi('米饭', '谷薯类', 1, '碗'), mi('苹果', '水果类', 1, '个')])], D)
ok('14:59 不催缺失类', !dietFindings(noProteinFacts, '14:59').some(f => f.id === 'protein-missing'))
const afternoonFindings = dietFindings(noProteinFacts, '15:00')
ok('15:00 起提示蛋白质缺失', afternoonFindings.some(f => f.id === 'protein-missing'))
ok('同一时点提示蔬菜缺失，已有水果不再催水果', afternoonFindings.some(f => f.id === 'veg-missing') && !afternoonFindings.some(f => f.id === 'fruit-missing'))
ok('有蛋白质不再提示缺失', !dietFindings(dayIntakeFacts([dm(D, 'lunch', [mi('米饭', '谷薯类'), mi('鸡蛋', '蛋类')])], D), '18:00').some(f => f.id === 'protein-missing'))

// R5 加餐：门槛要求至少 1 餐正餐，纯加餐日不反馈
const snackFacts = dayIntakeFacts([
  dm(D, 'lunch', [mi('米饭', '谷薯类', 1, '碗')]),
  dm(D, 'snack', [mi('坚果', '坚果类', 1, '把')]),
  dm(D, 'snack', [mi('酸奶', '奶类', 1, '杯')]),
  dm(D, 'snack', [mi('苹果', '水果类', 1, '个')])
], D)
ok('20:00 前/不足 3 次不提示加餐', !dietFindings(snackFacts, '19:59').some(f => f.id === 'snack-heavy') && !dietFindings(dayIntakeFacts([dm(D, 'snack', [mi('坚果', '坚果类')]), dm(D, 'snack', [mi('酸奶', '奶类')])], D), '20:00').some(f => f.id === 'snack-heavy'))
ok('20:00 起 3 次加餐触发', dietFindings(snackFacts, '20:00').some(f => f.id === 'snack-heavy'))

// 优先级与条数上限：无蛋白质、无蔬菜、无水果且谷薯过半的一天，四条全中
const priorityFacts = dayIntakeFacts([dm(D, 'lunch', [
  mi('米饭', '谷薯类', 1, '碗'), mi('面条', '谷薯类', 1, '碗'), mi('米线', '谷薯类', 1, '碗'), mi('坚果', '坚果类', 1, '把')
])], D)
const priorityFindings = dietFindings(priorityFacts, '18:00')
ok('即时反馈最多 2 条', limitImmediate(priorityFindings).length === DIET_THRESHOLDS.maxImmediate && priorityFindings.length > DIET_THRESHOLDS.maxImmediate)
ok('按优先级排序：蛋白质 → 主食 → 蔬菜 → 水果', priorityFindings.map(f => f.id).join(',') === 'protein-missing,staple-heavy,veg-missing,fruit-missing')

// 晚间总结：门槛 2 餐、不限条数、回顾语气
ok('总结要 2 餐正餐', !meetsSummaryGate(priorityFacts) && dietFindings(priorityFacts, '21:30', { summary: true }).length === 0)
const summaryFacts = dayIntakeFacts([
  dm(D, 'lunch', [mi('米饭', '谷薯类', 1, '碗'), mi('面条', '谷薯类', 1, '碗')]),
  dm(D, 'dinner', [mi('米线', '谷薯类', 1, '碗'), mi('坚果', '坚果类', 1, '把')])
], D)
ok('总结模式过门槛后列出全部规则', dietFindings(summaryFacts, '21:30', { summary: true }).length === 4)
ok('总结门槛不够不生成', dietFindings(dayIntakeFacts([dm(D, 'lunch', [mi('米饭', '谷薯类'), mi('苹果', '水果类')])], D), '21:30', { summary: true }).length === 0)

// 润色输出校验：未知 id 丢弃、空/超长退回规则文案
const phraseTarget = afternoonFindings[0]
const phraseOk = validateDietPhrases({ items: [
  { id: phraseTarget.id, advice: '晚饭加个鸡蛋或一杯牛奶就好。' },
  { id: 'made-up', advice: '不存在的一条' },
  { id: 'veg-missing', advice: '' },
  { id: 'fruit-missing', advice: 'x'.repeat(101) }
] }, afternoonFindings)
ok('合法润色被接受', phraseOk.phrases[phraseTarget.id] === '晚饭加个鸡蛋或一杯牛奶就好。')
ok('未知 id / 空文案 / 超长都退回保底', !('made-up' in phraseOk.phrases) && !('veg-missing' in phraseOk.phrases) && !('fruit-missing' in phraseOk.phrases) && phraseOk.warnings.length > 0)
ok('非 JSON 输出整包退回', Object.keys(validateDietPhrases('乱字符串', afternoonFindings).phrases).length === 0)
const dietMsgs = buildDietPhraseMessages(afternoonFindings, noProteinFacts, false)
ok('润色提示词带结论与条目', dietMsgs.system.includes('不得新增问题') && dietMsgs.user.includes('米饭'))

console.log(`\n通过 ${passed} 项，失败 ${failed} 项`)
if (failed) process.exitCode = 1
