const FOOD_CATEGORIES = ['谷薯类', '蔬菜类', '水果类', '蛋类', '奶类', '肉类', '豆类', '坚果类', '油脂类', '其他']

const iso = (d) => {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export const isoLocal = iso

export function mondayOf(value) {
  const date = value instanceof Date ? new Date(value) : new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return null
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7))
  date.setHours(0, 0, 0, 0)
  return date
}

export function weekDates(start) {
  return Array.from({ length: 7 }, (_, i) => {
    const date = new Date(start)
    date.setDate(start.getDate() + i)
    return date
  })
}

const loadOf = (session) => {
  if (session.rpe === null || session.rpe === undefined || !session.actualDuration) return null
  return Math.round(session.actualDuration * session.rpe)
}

export function buildWeeklyReport({ start, userId, sessions, meals, planItems }) {
  const monday = mondayOf(start)
  if (!monday) return null
  const dates = weekDates(monday)
  const isoDays = dates.map(iso)
  const inWeek = sessions.filter((s) => isoDays.includes(s.date))
  const weekMeals = meals.filter((m) => isoDays.includes(m.date))
  const plannedDays = [...new Set(planItems.filter((i) => isoDays.includes(i.date)).map((i) => i.date))].sort()

  const loadByDay = isoDays.map((date) => {
    const daySessions = inWeek.filter((s) => s.date === date)
    if (!daySessions.length) return null
    const loads = daySessions.map(loadOf)
    if (loads.some((load) => load === null)) return null
    return loads.reduce((sum, load) => sum + (load ?? 0), 0)
  })

  const completedDates = [...new Set(inWeek.map((s) => s.date))]
  const countedDays = loadByDay.filter((load) => load !== null)
  const totalLoad = countedDays.length ? countedDays.reduce((sum, load) => sum + (load ?? 0), 0) : null
  const rpeMissing = inWeek
    .filter((s) => s.rpe === null || s.rpe === undefined)
    .map((s) => `${s.date.slice(5)} ${s.exerciseName}`)

  const categoryCoverage = Object.fromEntries(FOOD_CATEGORIES.map((category) => [category, 0]))
  for (const meal of weekMeals) {
    for (const item of meal.items ?? []) {
      if (categoryCoverage[item.category] !== undefined) categoryCoverage[item.category] += 1
    }
  }

  const mealDays = new Set(weekMeals.map((meal) => meal.date))
  const dataQuality = []
  if (!inWeek.length) dataQuality.push('本周还没有训练记录，负荷图表为空而不是 0。')
  if (rpeMissing.length) dataQuality.push(`${rpeMissing.length} 条训练未记录 RPE：${rpeMissing.join('、')}。这些条目不参与负荷计算。`)
  if (totalLoad !== null) {
    dataQuality.push(`负荷合计覆盖 ${countedDays.length} 天（本周有记录的 ${new Set(inWeek.map((s) => s.date)).size} 天中）；缺 RPE 的天按未计入处理，不按 0 补齐。`)
  }
  if (!plannedDays.length) {
    dataQuality.push('这一周没有可用的服务端计划，因此不计算完成率。')
  } else if (completedDates.length < plannedDays.length) {
    dataQuality.push(`安排 ${plannedDays.length} 天，有记录 ${completedDates.length} 天；未记录不等于没练，也不计入完成率。`)
  }
  dataQuality.push(`餐食：本周 ${mealDays.size} 天有记录，其余显示"未记录"，不代表未摄入。`)

  return {
    userId: userId ?? 'demo-user',
    weekStartDate: isoDays[0],
    weekEndDate: isoDays[6],
    plannedSessions: plannedDays.length,
    completedSessions: completedDates.length,
    totalDuration: inWeek.reduce((sum, session) => sum + (session.actualDuration ?? 0), 0),
    totalDistance: inWeek.reduce((sum, session) => sum + (session.actualDistance ?? 0), 0),
    totalLoad,
    loadByDay,
    missingSessions: rpeMissing,
    totalMeals: weekMeals.length,
    recordedMeals: weekMeals.filter((meal) => meal.completeness !== 'unknown').length,
    completeMeals: weekMeals.filter((meal) => meal.completeness === 'complete').length,
    categoryCoverage,
    dataQuality,
    ruleVersion: 'report-rules-v2 / diet-rules-v2',
    plannedDays,
    loadDays: countedDays.length,
    unloadedDays: new Set(inWeek.map((s) => s.date)).size - countedDays.length,
    completionRate: plannedDays.length ? completedDates.length / plannedDays.length : null,
    blockedByDiscomfort: inWeek.some((session) => session.discomfort)
  }
}
