import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { Worker } from 'node:worker_threads'
import { backup } from 'node:sqlite'
import { mkdtemp, rmdir, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { openDatabase, transaction, nowIso, jsonParse } from './db.mjs'
import {
  ACCESS_TTL_SECONDS,
  REFRESH_COOKIE,
  clearRefreshCookie,
  createRefreshToken,
  hashIdentifier,
  hashPassword,
  normalizeIdentifier,
  parseCookies,
  refreshCookie,
  revokeRefreshToken,
  rotateRefreshToken,
  signAccessToken,
  userFromRequest,
  userJson,
  verifyPassword
} from './auth.mjs'
import { buildWeeklyReport, isoLocal, mondayOf, weekDates } from './report.mjs'

const FOOD_CATEGORIES = ['谷薯类', '蔬菜类', '水果类', '蛋类', '奶类', '肉类', '豆类', '坚果类', '油脂类', '其他']
const DEFAULT_PRIVACY = {
  cameraEnabled: true,
  saveVideoLocally: false,
  dataRetentionDays: 90,
  exportFormat: 'json',
  showEnergyEstimate: false,
  saveFoodPhotoLocally: true
}
const MAX_BODY = 2 * 1024 * 1024
const DEFAULT_DB = fileURLToPath(new URL('./data/twopoles.sqlite', import.meta.url))

class HttpError extends Error {
  constructor(code, status, message, detail) {
    super(message)
    this.code = code
    this.status = status
    this.detail = detail
  }
}

const fail = (code, status, message, detail) => {
  throw new HttpError(code, status, message, detail)
}

const assert = (condition, message, code = 'validation_failed') => {
  if (!condition) fail(code, 400, message)
}

const stringOrNull = (value, max = 500) => {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') return null
  return value.trim().slice(0, max) || null
}

const numberOrNull = (value) => {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

const integerOrNull = (value) => {
  const number = numberOrNull(value)
  return number === null ? null : Math.round(number)
}

const bool = (value) => value === true || value === 1 || value === '1'

const isDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
const isIso = (value) => typeof value === 'string' && !Number.isNaN(Date.parse(value))

const stringArray = (value, max = 30) => {
  if (!Array.isArray(value)) return []
  return value
    .filter((item) => typeof item === 'string')
    .map((item) => item.trim().slice(0, 80))
    .filter(Boolean)
    .slice(0, max)
}

const objectArray = (value, max = 50) => (Array.isArray(value) ? value.filter((item) => item && typeof item === 'object').slice(0, max) : [])

const jsonText = (value) => JSON.stringify(value ?? null)

function planBaseVersion(req, body) {
  const value = req.headers['if-match']
  if (typeof value !== 'string') fail('precondition_required', 428, '计划写入需要 If-Match 版本号')
  const match = /^(?:"([1-9]\d*)"|([1-9]\d*))$/.exec(value)
  assert(match, 'If-Match 必须是有效的计划版本号')
  const version = Number(match[1] ?? match[2])
  assert(Number.isSafeInteger(version), '计划版本号无效')
  assert(body.baseVersion === undefined || body.baseVersion === version, 'baseVersion 与 If-Match 不一致')
  return version
}

function sendJson(res, status, body, headers = {}) {
  const payload = body === undefined ? '' : JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers
  })
  res.end(payload)
}

function sendEmpty(res, status, headers = {}) {
  res.writeHead(status, { 'Cache-Control': 'no-store', ...headers })
  res.end()
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    let tooLarge = false
    req.on('data', (chunk) => {
      if (tooLarge) return
      raw += chunk
      if (raw.length > MAX_BODY) {
        tooLarge = true
        reject(new HttpError('validation_failed', 413, '请求体过大'))
      }
    })
    req.on('end', () => {
      if (tooLarge) return
      if (!raw.trim()) return resolve({})
      try {
        const parsed = JSON.parse(raw)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          reject(new HttpError('validation_failed', 400, '请求体必须是 JSON 对象'))
          return
        }
        resolve(parsed)
      } catch {
        reject(new HttpError('validation_failed', 400, '请求体不是合法 JSON'))
      }
    })
    req.on('error', reject)
  })
}

function profileJson(row) {
  if (!row) return null
  return {
    id: row.user_id,
    mode: row.mode,
    modeChangedAt: row.mode_changed_at ?? row.updated_at,
    nickname: row.nickname ?? undefined,
    age: row.age,
    goal: row.goal ?? '',
    experience: row.experience ?? '',
    availableTimes: jsonParse(row.available_times_json, []),
    equipment: jsonParse(row.equipment_json, []),
    availableVenues: jsonParse(row.available_venues_json, []),
    restrictions: jsonParse(row.restrictions_json, []),
    height: row.height ?? undefined,
    weight: row.weight ?? undefined,
    discipline: row.discipline ?? undefined,
    cyclePhase: row.cycle_phase ?? undefined,
    cycleStartDate: row.cycle_start ?? undefined,
    cycleEndDate: row.cycle_end ?? undefined,
    goalType: row.goal_type ?? undefined,
    targetEvent: row.target_event ?? undefined,
    targetEventDate: row.target_event_date ?? undefined,
    targetResult: row.target_result ?? undefined,
    cycleFocus: row.cycle_focus ?? undefined,
    personalBests: jsonParse(row.personal_bests_json, []),
    gymRecords: jsonParse(row.gym_records_json, []),
    updatedAt: row.updated_at
  }
}

function privacyJson(row) {
  if (!row) return { ...DEFAULT_PRIVACY }
  return { ...DEFAULT_PRIVACY, ...jsonParse(row.json, {}), updatedAt: row.updated_at }
}

function sessionJson(row) {
  if (!row) return null
  return {
    id: row.id,
    serverId: row.id,
    clientId: row.client_id,
    userId: row.user_id,
    planItemId: row.plan_item_id ?? undefined,
    date: row.date,
    exerciseName: row.exercise_name,
    type: row.type ?? '其他',
    actualDuration: row.actual_duration ?? undefined,
    actualDistance: row.actual_distance ?? undefined,
    actualSets: row.actual_sets ?? undefined,
    actualReps: row.actual_reps ?? undefined,
    completionStatus: row.completion_status ?? 'completed',
    completionReason: row.completion_reason ?? undefined,
    rpe: row.rpe ?? null,
    discomfort: !!row.discomfort,
    notes: row.notes ?? undefined,
    cameraUsed: !!row.camera_used,
    manualCorrections: row.manual_corrections ?? 0,
    countedReps: row.counted_reps ?? undefined,
    confidence: row.avg_confidence ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    _sync: 'synced'
  }
}

function mealItemJson(row) {
  return {
    id: row.client_item_id || row.id,
    serverId: row.id,
    mealId: row.meal_record_id,
    foodId: row.food_id ?? '',
    foodName: row.food_name,
    category: row.category,
    portionSize: row.portion_size ?? undefined,
    portionUnit: row.portion_unit ?? undefined,
    confirmed: !!row.confirmed,
    source: row.source ?? 'manual',
    photoConfidence: row.photo_confidence ?? undefined,
    uncertain: row.uncertain === null ? undefined : !!row.uncertain,
    userConfirmed: row.user_confirmed === null ? undefined : !!row.user_confirmed,
    modelEnergy: jsonParse(row.model_energy_json, null) ?? undefined
  }
}

function mealJson(row, items) {
  if (!row) return null
  return {
    id: row.id,
    serverId: row.id,
    clientId: row.client_id,
    userId: row.user_id,
    date: row.date,
    mealType: row.meal_type,
    time: row.time ?? '',
    completeness: row.completeness ?? 'unknown',
    items: items.map(mealItemJson),
    analyzed: !!row.analyzed,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    photoThumb: row.photo_thumb ?? undefined,
    photoId: row.photo_id ?? undefined,
    _sync: 'synced'
  }
}

function planItemJson(row, planId) {
  return {
    id: row.client_item_id || row.id,
    serverId: row.id,
    planId,
    date: row.date,
    exerciseId: row.exercise_id ?? undefined,
    exerciseName: row.exercise_name,
    type: row.type ?? '其他',
    note: row.note ?? undefined,
    plannedDuration: row.planned_duration ?? undefined,
    plannedDistance: row.planned_distance ?? undefined,
    plannedSets: row.planned_sets ?? undefined,
    plannedReps: row.planned_reps ?? undefined,
    plannedHoldSeconds: row.planned_hold_seconds ?? undefined,
    plannedTargetMinutes: row.planned_target_minutes ?? undefined,
    locked: !!row.locked,
    completed: !!row.completed,
    alternatives: jsonParse(row.alternatives_json, [])
  }
}

function planJson(row, items) {
  if (!row) return null
  return {
    id: row.id,
    serverId: row.id,
    clientId: row.client_id,
    userId: row.user_id,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    mode: row.mode,
    reason: row.reason,
    weekStartDate: row.week_start,
    weekEndDate: row.week_end,
    items: items.map((item) => planItemJson(item, row.id)),
    locked: !!row.locked,
    source: row.source ?? undefined,
    _sync: 'synced'
  }
}

function readItems(db, table, column, id) {
  return db.prepare(`SELECT * FROM ${table} WHERE ${column} = ? ORDER BY order_index ASC, id ASC`).all(id)
}

function readPlan(db, planId) {
  const row = db.prepare('SELECT * FROM plans WHERE id = ?').get(planId)
  return row ? planJson(row, readItems(db, 'plan_items', 'plan_id', planId)) : null
}

function readMeal(db, mealId) {
  const row = db.prepare('SELECT * FROM meal_records WHERE id = ?').get(mealId)
  return row ? mealJson(row, readItems(db, 'meal_items', 'meal_record_id', mealId)) : null
}

function latestPlan(db, userId, weekStart, mode) {
  const row = db.prepare(`
    SELECT * FROM plans
    WHERE user_id = ? AND week_start = ? AND mode = ? AND deleted_at IS NULL
    ORDER BY version DESC LIMIT 1
  `).get(userId, weekStart, mode)
  return row ? readPlan(db, row.id) : null
}

function audit(db, userId, action, targetType = null, targetId = null) {
  db.prepare(`
    INSERT INTO audit_events (user_id, actor_role, action, target_type, target_id, event_code, created_at)
    VALUES (?, 'user', ?, ?, ?, NULL, ?)
  `).run(userId, action, targetType, targetId, nowIso())
}

function idempotencyResult(db, userId, key) {
  if (!key) return null
  const row = db.prepare('SELECT * FROM idempotency_keys WHERE user_id = ? AND key = ?').get(userId, key)
  return row ? { status: row.status, body: jsonParse(row.response_json, {}) } : null
}

function saveIdempotency(db, userId, key, method, path, status, body) {
  if (!key) return
  db.prepare(`
    INSERT OR REPLACE INTO idempotency_keys (user_id, key, method, path, status, response_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(userId, key, method, path, status, JSON.stringify(body), nowIso())
}

function findSession(db, userId, id) {
  return db.prepare(`
    SELECT * FROM training_sessions
    WHERE user_id = ? AND deleted_at IS NULL AND (id = ? OR client_id = ?)
    LIMIT 1
  `).get(userId, id, id)
}

function findMeal(db, userId, id) {
  return db.prepare(`
    SELECT * FROM meal_records
    WHERE user_id = ? AND deleted_at IS NULL AND (id = ? OR client_id = ?)
    LIMIT 1
  `).get(userId, id, id)
}

function findPlan(db, userId, id) {
  return db.prepare(`
    SELECT * FROM plans
    WHERE user_id = ? AND deleted_at IS NULL AND (id = ? OR client_id = ?)
    ORDER BY version DESC LIMIT 1
  `).get(userId, id, id)
}

function writeProfile(db, userId, raw, current) {
  const now = nowIso()
  const profile = {
    ...(current ?? {}),
    ...raw
  }
  const age = integerOrNull(profile.age)
  assert(age !== null && age >= 12 && age <= 90, '年龄必须在 12–90 之间')
  const mode = profile.mode === 'athlete' ? 'athlete' : 'public'
  const availableTimes = stringArray(profile.availableTimes, 12)
  const equipment = stringArray(profile.equipment, 30)
  const venues = stringArray(profile.availableVenues, 10)
  const restrictions = stringArray(profile.restrictions, 30)
  const personalBests = objectArray(profile.personalBests, 50)
  const gymRecords = objectArray(profile.gymRecords, 50)
  const height = numberOrNull(profile.height)
  const weight = numberOrNull(profile.weight)
  assert(height === null || (height >= 80 && height <= 260), '身高超出合理范围')
  assert(weight === null || (weight >= 20 && weight <= 400), '体重超出合理范围')

  const previousMode = current?.mode
  db.prepare(`
    INSERT INTO profiles (
      user_id, nickname, age, goal, experience, available_times_json, equipment_json,
      available_venues_json, restrictions_json, mode, mode_changed_at, height, weight,
      discipline, cycle_phase, cycle_start, cycle_end, goal_type, target_event,
      target_event_date, target_result, cycle_focus, personal_bests_json,
      gym_records_json, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      nickname = excluded.nickname,
      age = excluded.age,
      goal = excluded.goal,
      experience = excluded.experience,
      available_times_json = excluded.available_times_json,
      equipment_json = excluded.equipment_json,
      available_venues_json = excluded.available_venues_json,
      restrictions_json = excluded.restrictions_json,
      mode = excluded.mode,
      mode_changed_at = excluded.mode_changed_at,
      height = excluded.height,
      weight = excluded.weight,
      discipline = excluded.discipline,
      cycle_phase = excluded.cycle_phase,
      cycle_start = excluded.cycle_start,
      cycle_end = excluded.cycle_end,
      goal_type = excluded.goal_type,
      target_event = excluded.target_event,
      target_event_date = excluded.target_event_date,
      target_result = excluded.target_result,
      cycle_focus = excluded.cycle_focus,
      personal_bests_json = excluded.personal_bests_json,
      gym_records_json = excluded.gym_records_json,
      updated_at = excluded.updated_at
  `).run(
    userId,
    stringOrNull(profile.nickname, 80),
    age,
    stringOrNull(profile.goal, 200),
    stringOrNull(profile.experience, 200),
    jsonText(availableTimes),
    jsonText(equipment),
    jsonText(venues),
    jsonText(restrictions),
    mode,
    stringOrNull(profile.modeChangedAt, 40) ?? now,
    height,
    weight,
    stringOrNull(profile.discipline, 80),
    stringOrNull(profile.cyclePhase, 80),
    stringOrNull(profile.cycleStartDate, 20),
    stringOrNull(profile.cycleEndDate, 20),
    profile.goalType === 'competition' || profile.goalType === 'cycle' ? profile.goalType : null,
    stringOrNull(profile.targetEvent, 120),
    stringOrNull(profile.targetEventDate, 20),
    stringOrNull(profile.targetResult, 80),
    stringOrNull(profile.cycleFocus, 200),
    jsonText(personalBests),
    jsonText(gymRecords),
    now
  )
  if (previousMode && previousMode !== mode) {
    db.prepare(`
      INSERT INTO mode_changes (id, user_id, from_mode, to_mode, at, open_plan_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(randomUUID(), userId, previousMode, mode, now, 0)
  }
  return db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(userId)
}

function writeMealItems(db, mealId, items) {
  db.prepare('DELETE FROM meal_items WHERE meal_record_id = ?').run(mealId)
  const insert = db.prepare(`
    INSERT INTO meal_items (
      id, client_item_id, meal_record_id, food_id, food_name, category, portion_size,
      portion_unit, confirmed, source, photo_confidence, uncertain, user_confirmed,
      model_energy_json, order_index
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  items.forEach((item, index) => {
    if (!item || typeof item !== 'object') return
    const foodName = stringOrNull(item.foodName, 80)
    if (!foodName) return
    const category = FOOD_CATEGORIES.includes(item.category) ? item.category : '其他'
    insert.run(
      randomUUID(),
      stringOrNull(item.id, 80),
      mealId,
      stringOrNull(item.foodId, 120),
      foodName,
      category,
      numberOrNull(item.portionSize),
      stringOrNull(item.portionUnit, 20),
      item.confirmed === false ? 0 : 1,
      item.source === 'photo' ? 'photo' : 'manual',
      numberOrNull(item.photoConfidence),
      item.uncertain === undefined ? null : (item.uncertain ? 1 : 0),
      item.userConfirmed === undefined ? null : (item.userConfirmed ? 1 : 0),
      item.modelEnergy ? jsonText(item.modelEnergy) : null,
      index
    )
  })
}

function writePlanItems(db, planId, items) {
  const insert = db.prepare(`
    INSERT INTO plan_items (
      id, client_item_id, plan_id, date, exercise_id, exercise_name, type, note,
      planned_duration, planned_distance, planned_sets, planned_reps, planned_hold_seconds,
      planned_target_minutes, locked, completed, alternatives_json, order_index
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  items.forEach((item, index) => {
    if (!item || typeof item !== 'object') return
    const date = isDate(item.date) ? item.date : null
    const name = stringOrNull(item.exerciseName, 120)
    if (!date || !name) return
    insert.run(
      randomUUID(),
      stringOrNull(item.id, 80),
      planId,
      date,
      stringOrNull(item.exerciseId, 80),
      name,
      stringOrNull(item.type, 40) ?? '其他',
      stringOrNull(item.note, 200),
      integerOrNull(item.plannedDuration),
      integerOrNull(item.plannedDistance),
      integerOrNull(item.plannedSets),
      integerOrNull(item.plannedReps),
      integerOrNull(item.plannedHoldSeconds),
      integerOrNull(item.plannedTargetMinutes),
      item.locked ? 1 : 0,
      item.completed ? 1 : 0,
      jsonText(Array.isArray(item.alternatives) ? item.alternatives : []),
      index
    )
  })
}

function sessionRowsForWeek(db, userId, start, end) {
  return db.prepare(`
    SELECT * FROM training_sessions
    WHERE user_id = ? AND deleted_at IS NULL AND date >= ? AND date <= ?
    ORDER BY date ASC, created_at ASC
  `).all(userId, start, end).map(sessionJson)
}

function mealRowsForWeek(db, userId, start, end) {
  return db.prepare(`
    SELECT * FROM meal_records
    WHERE user_id = ? AND deleted_at IS NULL AND date >= ? AND date <= ?
    ORDER BY date ASC, time ASC
  `).all(userId, start, end).map((row) => mealJson(row, readItems(db, 'meal_items', 'meal_record_id', row.id)))
}

function planItemsForWeek(db, userId, start, end) {
  const rows = db.prepare(`
    SELECT pi.* FROM plan_items pi
    JOIN plans p ON p.id = pi.plan_id
    WHERE p.user_id = ? AND p.deleted_at IS NULL AND pi.date >= ? AND pi.date <= ?
  `).all(userId, start, end)
  return rows.map((row) => planItemJson(row, row.plan_id))
}

function csvCell(value) {
  const text = String(value ?? '')
  const safe = /^[\s]*[=+@-]/.test(text) ? `'${text}` : text
  return `"${safe.replace(/"/g, '""')}"`
}

export function exportPayload(db, userId, format) {
  const profileRow = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(userId)
  const privacyRow = db.prepare('SELECT * FROM privacy_settings WHERE user_id = ?').get(userId)
  const sessions = db.prepare('SELECT * FROM training_sessions WHERE user_id = ? AND deleted_at IS NULL ORDER BY date ASC').all(userId).map(sessionJson)
  const meals = db.prepare('SELECT * FROM meal_records WHERE user_id = ? AND deleted_at IS NULL ORDER BY date ASC').all(userId)
    .map((row) => mealJson(row, readItems(db, 'meal_items', 'meal_record_id', row.id)))
  const plans = db.prepare('SELECT * FROM plans WHERE user_id = ? AND deleted_at IS NULL ORDER BY week_start ASC, version ASC').all(userId)
    .map((row) => planJson(row, readItems(db, 'plan_items', 'plan_id', row.id)))
  if (format === 'json') {
    return JSON.stringify({
      exportedAt: nowIso(),
      userId,
      profile: profileJson(profileRow),
      privacy: privacyJson(privacyRow),
      sessions,
      meals,
      plans
    }, null, 2)
  }
  const head = ['类别', '日期', '时间', '名称', '类型或类别', '时长分钟', '距离米', '次数', '组数', '单位', 'RPE', '负荷', '不适', '状态', '备注']
  const rows = [
    ...sessions.map((session) => [
      '训练', session.date, session.createdAt?.slice(11, 16) ?? '', session.exerciseName, session.type,
      session.actualDuration ?? '', session.actualDistance ?? '', session.actualReps ?? '', session.actualSets ?? '', '',
      session.rpe ?? '未记录',
      session.rpe === null || !session.actualDuration ? '未计入' : Math.round(session.actualDuration * session.rpe),
      session.discomfort ? '是' : '否', session.completionStatus, session.notes ?? ''
    ]),
    ...meals.flatMap((meal) => meal.items.map((item) => [
      '餐食', meal.date, meal.time, item.foodName, item.category,
      '', '', item.portionSize ?? '', '', item.portionUnit ?? '', '', '', '', meal.completeness,
      item.source === 'photo' ? '照片识别候选，已由用户确认' : ''
    ])),
    ...plans.flatMap((plan) => plan.items.map((item) => [
      '计划', item.date, '', item.exerciseName, item.type,
      item.plannedDuration ?? '', item.plannedDistance ?? '', item.plannedReps ?? '', item.plannedSets ?? '', '',
      '', '', '', item.completed ? '已完成' : '待完成', `v${plan.version}｜${plan.mode === 'public' ? '大众' : '运动员'}｜${plan.reason}`
    ]))
  ]
  return '\ufeff' + [head, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')
}

function wipeUser(db, userId, deleteUser) {
  transaction(db, () => {
    const mealIds = db.prepare('SELECT id FROM meal_records WHERE user_id = ?').all(userId).map((row) => row.id)
    for (const mealId of mealIds) db.prepare('DELETE FROM meal_items WHERE meal_record_id = ?').run(mealId)
    const planIds = db.prepare('SELECT id FROM plans WHERE user_id = ?').all(userId).map((row) => row.id)
    for (const planId of planIds) db.prepare('DELETE FROM plan_items WHERE plan_id = ?').run(planId)
    db.prepare('DELETE FROM meal_records WHERE user_id = ?').run(userId)
    db.prepare('DELETE FROM training_sessions WHERE user_id = ?').run(userId)
    db.prepare('DELETE FROM plan_adjustments WHERE user_id = ?').run(userId)
    db.prepare('DELETE FROM plans WHERE user_id = ?').run(userId)
    db.prepare('DELETE FROM profiles WHERE user_id = ?').run(userId)
    db.prepare('DELETE FROM privacy_settings WHERE user_id = ?').run(userId)
    db.prepare('DELETE FROM sync_state WHERE user_id = ?').run(userId)
    db.prepare('DELETE FROM mode_changes WHERE user_id = ?').run(userId)
    db.prepare('DELETE FROM export_jobs WHERE user_id = ?').run(userId)
    if (deleteUser) db.prepare('DELETE FROM refresh_tokens WHERE user_id = ?').run(userId)
    db.prepare('DELETE FROM confirm_tokens WHERE user_id = ?').run(userId)
    db.prepare('DELETE FROM idempotency_keys WHERE user_id = ?').run(userId)
    db.prepare('DELETE FROM audit_events WHERE user_id = ?').run(userId)
    if (deleteUser) db.prepare('DELETE FROM users WHERE id = ?').run(userId)
  })
}

function confirmation(db, userId, action, body) {
  const now = nowIso()
  const token = stringOrNull(body.confirmToken, 80)
  if (!token) {
    const fresh = randomUUID()
    const expires = new Date(Date.now() + 5 * 60 * 1000).toISOString()
    db.prepare('DELETE FROM confirm_tokens WHERE user_id = ? AND action = ?').run(userId, action)
    db.prepare('INSERT INTO confirm_tokens (token, user_id, action, expires_at) VALUES (?, ?, ?, ?)')
      .run(fresh, userId, action, expires)
    return { status: 202, body: { code: 'confirmation_required', confirmToken: fresh, expiresIn: 300 } }
  }
  const row = db.prepare('SELECT * FROM confirm_tokens WHERE token = ? AND user_id = ? AND action = ?').get(token, userId, action)
  if (!row || row.expires_at <= now) fail('forbidden', 403, '确认令牌无效或已过期')
  db.prepare('DELETE FROM confirm_tokens WHERE token = ?').run(token)
  return null
}

function createRateLimiter() {
  const buckets = new Map()
  return function allow(key, limit, windowMs) {
    const now = Date.now()
    const row = buckets.get(key)
    if (!row || row.reset <= now) {
      buckets.set(key, { count: 1, reset: now + windowMs })
      return true
    }
    row.count += 1
    return row.count <= limit
  }
}

export function createApiServer(options = {}) {
  const dbPath = options.dbPath ?? process.env.TWOPOLES_DB ?? DEFAULT_DB
  const db = openDatabase(dbPath)
  const secret = options.secret ?? process.env.AUTH_SECRET ?? 'twopoles-dev-secret-change-me'
  const secureCookies = options.secureCookies ?? process.env.COOKIE_SECURE === 'true'
  const allowedOrigins = options.corsOrigins ?? (process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean)
    : ['http://localhost:5173', 'http://127.0.0.1:5173'])
  const allow = createRateLimiter()
  let closing = false
  let exportRunning = false
  let exportWorker = null
  let exportTask = Promise.resolve()

  // 单 worker 顺序处理持久化作业；重启后继续 pending，清除后的作业不会被复活。
  function scheduleExports() {
    if (closing || exportRunning) return
    exportRunning = true
    exportTask = (async () => {
      try {
        while (!closing) {
          const job = db.prepare("SELECT * FROM export_jobs WHERE status = 'pending' ORDER BY created_at, id LIMIT 1").get()
          if (!job) break
          let temporary = null
          try {
            let source = resolve(dbPath)
            if (dbPath === ':memory:') {
              temporary = await mkdtemp(join(tmpdir(), 'twopoles-export-'))
              source = join(temporary, 'snapshot.sqlite')
              await backup(db, source)
            }
            if (closing) break
            const content = await new Promise((resolveResult, reject) => {
              const worker = new Worker(new URL('./export-worker.mjs', import.meta.url), {
                workerData: { dbPath: source, userId: job.user_id, format: job.format }
              })
              exportWorker = worker
              worker.once('message', resolveResult)
              worker.once('error', reject)
              worker.once('exit', (code) => { if (code !== 0 || closing) reject(new Error('导出进程已停止')) })
            })
            if (!closing) db.prepare("UPDATE export_jobs SET status = 'completed', content = ?, completed_at = ? WHERE id = ? AND status = 'pending'")
              .run(content, nowIso(), job.id)
          } catch (error) {
            if (!closing) db.prepare("UPDATE export_jobs SET status = 'failed', error = ?, completed_at = ? WHERE id = ? AND status = 'pending'")
              .run(String(error?.message ?? error).slice(0, 300), nowIso(), job.id)
          } finally {
            exportWorker = null
            if (temporary) {
              await Promise.all(['snapshot.sqlite', 'snapshot.sqlite-wal', 'snapshot.sqlite-shm']
                .map((name) => unlink(join(temporary, name)).catch(() => {})))
              await rmdir(temporary).catch(() => {})
            }
          }
        }
      } finally {
        exportRunning = false
      }
    })()
  }
  setImmediate(scheduleExports)

  function cors(req, res) {
    const origin = req.headers.origin
    if (origin && allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Vary', 'Origin')
      res.setHeader('Access-Control-Allow-Credentials', 'true')
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'content-type,authorization,idempotency-key,if-match')
  }

  function requireUser(req) {
    const user = userFromRequest(req, db, secret)
    if (!user) fail('unauthorized', 401, '请先登录')
    return user
  }

  function issueSession(res, user) {
    const accessToken = signAccessToken(user.id, secret)
    const refreshToken = createRefreshToken(db, user.id)
    return {
      status: 200,
      body: { userId: user.id, user: userJson(user), accessToken, expiresIn: ACCESS_TTL_SECONDS },
      headers: { 'Set-Cookie': refreshCookie(refreshToken, secureCookies) }
    }
  }

  async function route(req, res) {
    cors(req, res)
    res.setHeader('X-Content-Type-Options', 'nosniff')
    if (req.method === 'OPTIONS') return sendEmpty(res, 204)
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (!url.pathname.startsWith('/api/v1')) return sendJson(res, 404, { code: 'not_found', message: '接口不存在' })
    const path = url.pathname.slice('/api/v1'.length) || '/'
    const method = req.method ?? 'GET'
    const ip = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? 'local').split(',')[0].trim()
    const body = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) ? await readBody(req) : {}

    if (path === '/health') {
      return sendJson(res, 200, { ok: true, serverTime: nowIso() })
    }

    if (path.startsWith('/auth/')) {
      if (!allow(`auth:${ip}`, 30, 60_000)) fail('rate_limited', 429, '登录请求过于频繁，请稍后再试')
      if (path === '/auth/device' && method === 'POST') {
        const now = nowIso()
        const id = randomUUID()
        const identifier = `device:${id}`
        db.prepare('INSERT INTO users (id, type, identifier_hash, password_hash, created_at) VALUES (?, ?, ?, NULL, ?)')
          .run(id, 'anonymous', hashIdentifier(identifier, secret), now)
        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id)
        const result = issueSession(res, user)
        return sendJson(res, result.status, result.body, result.headers)
      }
      if (path === '/auth/register' && method === 'POST') {
        const identifier = normalizeIdentifier(body.identifier)
        assert(identifier, '请输入有效的邮箱或手机号')
        const password = typeof body.password === 'string' ? body.password : ''
        assert(password.length >= 8 && password.length <= 200, '密码至少 8 位')
        const exists = db.prepare('SELECT id FROM users WHERE identifier_hash = ?').get(hashIdentifier(identifier, secret))
        assert(!exists, '该账号已注册')
        const id = randomUUID()
        const now = nowIso()
        db.prepare('INSERT INTO users (id, type, identifier_hash, password_hash, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(id, 'registered', hashIdentifier(identifier, secret), hashPassword(password), now)
        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id)
        audit(db, id, 'auth.register')
        const result = issueSession(res, user)
        return sendJson(res, result.status, result.body, result.headers)
      }
      if (path === '/auth/login' && method === 'POST') {
        const identifier = normalizeIdentifier(body.identifier)
        const password = typeof body.password === 'string' ? body.password : ''
        assert(identifier && password, '请输入账号和密码')
        const user = db.prepare('SELECT * FROM users WHERE identifier_hash = ? AND deleted_at IS NULL')
          .get(hashIdentifier(identifier, secret))
        if (!user || !verifyPassword(password, user.password_hash)) fail('unauthorized', 401, '账号或密码不正确')
        const result = issueSession(res, user)
        return sendJson(res, result.status, result.body, result.headers)
      }
      if (path === '/auth/refresh' && method === 'POST') {
        const raw = parseCookies(req)[REFRESH_COOKIE]
        const rotated = rotateRefreshToken(db, raw)
        if (!rotated) {
          return sendJson(res, 401, { code: 'unauthorized', message: '登录已过期，请重新登录' }, {
            'Set-Cookie': clearRefreshCookie(secureCookies)
          })
        }
        const accessToken = signAccessToken(rotated.user.id, secret)
        return sendJson(res, 200, {
          userId: rotated.user.id,
          user: userJson(rotated.user),
          accessToken,
          expiresIn: ACCESS_TTL_SECONDS
        }, { 'Set-Cookie': refreshCookie(rotated.refreshToken, secureCookies) })
      }
      if (path === '/auth/bind' && method === 'POST') {
        const current = userFromRequest(req, db, secret)
        if (!current) return sendJson(res, 401, { code: 'unauthorized', message: '请先登录' })
        if (current.type !== 'anonymous') fail('validation_failed', 400, '只有设备账号可以绑定正式账号')
        const identifier = normalizeIdentifier(body.identifier)
        assert(identifier, '请输入有效的邮箱或手机号')
        const password = typeof body.password === 'string' ? body.password : ''
        assert(password.length >= 8 && password.length <= 200, '密码至少 8 位')
        const taken = db.prepare('SELECT id FROM users WHERE identifier_hash = ? AND id != ?')
          .get(hashIdentifier(identifier, secret), current.id)
        assert(!taken, '该账号已注册')
        db.prepare('UPDATE users SET type = ?, identifier_hash = ?, password_hash = ? WHERE id = ?')
          .run('registered', hashIdentifier(identifier, secret), hashPassword(password), current.id)
        audit(db, current.id, 'auth.bind')
        const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(current.id)
        return sendJson(res, 200, { user: userJson(updated) })
      }
      if (path === '/auth/logout' && method === 'POST') {
        revokeRefreshToken(db, parseCookies(req)[REFRESH_COOKIE])
        return sendEmpty(res, 204, { 'Set-Cookie': clearRefreshCookie(secureCookies) })
      }
      if (path === '/auth/delete-account' && method === 'POST') {
        const user = requireUser(req)
        const need = confirmation(db, user.id, 'delete-account', body)
        if (need) return sendJson(res, need.status, need.body)
        wipeUser(db, user.id, true)
        return sendEmpty(res, 204, { 'Set-Cookie': clearRefreshCookie(secureCookies) })
      }
      return sendJson(res, 404, { code: 'not_found', message: '接口不存在' })
    }

    if (path === '/data/wipe' && method === 'POST') {
      const user = requireUser(req)
      if (!allow(`wipe:${user.id}`, 5, 60_000)) fail('rate_limited', 429, '清除请求过于频繁')
      const need = confirmation(db, user.id, 'wipe', body)
      if (need) return sendJson(res, need.status, need.body)
      wipeUser(db, user.id, false)
      audit(db, user.id, 'data.wipe')
      return sendEmpty(res, 204)
    }

    const user = userFromRequest(req, db, secret)
    if (!user) fail('unauthorized', 401, '请先登录')

    if (path === '/profile') {
      if (method === 'GET') {
        const row = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(user.id)
        return sendJson(res, 200, { profile: profileJson(row) })
      }
      if (method === 'PUT') {
        const currentRow = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(user.id)
        const patch = body.profile && typeof body.profile === 'object' ? body.profile : body
        if (currentRow && isIso(patch.updatedAt) && patch.updatedAt < currentRow.updated_at) {
          return sendJson(res, 200, { profile: profileJson(currentRow) })
        }
        const row = writeProfile(db, user.id, patch, profileJson(currentRow))
        audit(db, user.id, 'profile.update', 'profile', user.id)
        return sendJson(res, 200, { profile: profileJson(row) })
      }
    }

    if (path === '/settings/privacy') {
      if (method === 'GET') {
        const row = db.prepare('SELECT * FROM privacy_settings WHERE user_id = ?').get(user.id)
        return sendJson(res, 200, { privacy: privacyJson(row) })
      }
      if (method === 'PUT') {
        const current = privacyJson(db.prepare('SELECT * FROM privacy_settings WHERE user_id = ?').get(user.id))
        const patch = body.privacy && typeof body.privacy === 'object' ? body.privacy : body
        if (current.updatedAt && isIso(patch.updatedAt) && patch.updatedAt < current.updatedAt) {
          return sendJson(res, 200, { privacy: current })
        }
        const merged = { ...current, ...patch }
        if (merged.exportFormat !== 'csv') merged.exportFormat = 'json'
        if (!Number.isFinite(Number(merged.dataRetentionDays))) merged.dataRetentionDays = 90
        merged.dataRetentionDays = Math.min(3650, Math.max(7, Math.round(Number(merged.dataRetentionDays))))
        merged.cameraEnabled = !!merged.cameraEnabled
        merged.saveVideoLocally = !!merged.saveVideoLocally
        merged.showEnergyEstimate = !!merged.showEnergyEstimate
        merged.saveFoodPhotoLocally = !!merged.saveFoodPhotoLocally
        const updatedAt = nowIso()
        db.prepare(`
          INSERT INTO privacy_settings (user_id, json, updated_at) VALUES (?, ?, ?)
          ON CONFLICT(user_id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at
        `).run(user.id, JSON.stringify(merged), updatedAt)
        return sendJson(res, 200, { privacy: { ...merged, updatedAt } })
      }
    }

    if (path === '/sessions' && method === 'GET') {
      const from = isDate(url.searchParams.get('from')) ? url.searchParams.get('from') : '0000-01-01'
      const to = isDate(url.searchParams.get('to')) ? url.searchParams.get('to') : '9999-12-31'
      const rows = db.prepare(`
        SELECT * FROM training_sessions
        WHERE user_id = ? AND deleted_at IS NULL AND date >= ? AND date <= ?
        ORDER BY date ASC, created_at ASC
      `).all(user.id, from, to)
      return sendJson(res, 200, { sessions: rows.map(sessionJson) })
    }

    if (path === '/sessions' && method === 'POST') {
      const idKey = String(req.headers['idempotency-key'] ?? '') || null
      const cached = idempotencyResult(db, user.id, idKey)
      if (cached) return sendJson(res, cached.status, cached.body)
      const raw = body.session && typeof body.session === 'object' ? body.session : body
      const clientId = stringOrNull(raw.clientId || raw.id, 100) ?? randomUUID()
      const existing = db.prepare('SELECT * FROM training_sessions WHERE user_id = ? AND client_id = ?').get(user.id, clientId)
      if (existing) {
        const result = { status: 200, body: { session: sessionJson(existing) } }
        saveIdempotency(db, user.id, idKey, method, path, result.status, result.body)
        return sendJson(res, result.status, result.body)
      }
      const date = isDate(raw.date) ? raw.date : null
      const exerciseName = stringOrNull(raw.exerciseName, 120)
      assert(date && exerciseName, '训练记录缺少日期或动作名')
      const rpe = raw.rpe === null || raw.rpe === undefined ? null : integerOrNull(raw.rpe)
      assert(rpe === null || (rpe >= 0 && rpe <= 10), 'RPE 必须在 0–10 之间或留空')
      const now = nowIso()
      const id = randomUUID()
      db.prepare(`
        INSERT INTO training_sessions (
          id, client_id, user_id, plan_item_id, date, exercise_name, type, actual_duration,
          actual_distance, actual_sets, actual_reps, completion_status, completion_reason,
          rpe, discomfort, notes, camera_used, manual_corrections, counted_reps,
          avg_confidence, calibrated_neutral, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, clientId, user.id, stringOrNull(raw.planItemId, 100), date, exerciseName,
        stringOrNull(raw.type, 40) ?? '其他', integerOrNull(raw.actualDuration),
        integerOrNull(raw.actualDistance), integerOrNull(raw.actualSets), integerOrNull(raw.actualReps),
        ['completed', 'partial', 'skipped'].includes(raw.completionStatus) ? raw.completionStatus : 'completed',
        stringOrNull(raw.completionReason, 300), rpe, bool(raw.discomfort) ? 1 : 0,
        stringOrNull(raw.notes, 1000), bool(raw.cameraUsed) ? 1 : 0,
        integerOrNull(raw.manualCorrections) ?? 0, integerOrNull(raw.countedReps),
        numberOrNull(raw.confidence), integerOrNull(raw.calibratedNeutral),
        stringOrNull(raw.createdAt, 40) ?? now, now
      )
      const row = db.prepare('SELECT * FROM training_sessions WHERE id = ?').get(id)
      const result = { status: 201, body: { session: sessionJson(row) } }
      saveIdempotency(db, user.id, idKey, method, path, result.status, result.body)
      return sendJson(res, result.status, result.body)
    }

    const sessionFeedback = /^\/sessions\/([^/]+)\/feedback$/.exec(path)
    if (sessionFeedback && method === 'PATCH') {
      const row = findSession(db, user.id, decodeURIComponent(sessionFeedback[1]))
      if (!row) fail('not_found', 404, '训练记录不存在')
      const rpe = body.rpe === null || body.rpe === undefined ? null : integerOrNull(body.rpe)
      assert(rpe === null || (rpe >= 0 && rpe <= 10), 'RPE 必须在 0–10 之间或留空')
      db.prepare(`
        UPDATE training_sessions SET
          actual_duration = COALESCE(?, actual_duration),
          actual_distance = COALESCE(?, actual_distance),
          rpe = ?,
          discomfort = ?,
          completion_reason = ?,
          notes = ?,
          updated_at = ?
        WHERE id = ?
      `).run(
        integerOrNull(body.duration), integerOrNull(body.distance), rpe,
        bool(body.discomfort) ? 1 : 0, stringOrNull(body.reason, 300), stringOrNull(body.notes, 1000),
        nowIso(), row.id
      )
      return sendJson(res, 200, { session: sessionJson(db.prepare('SELECT * FROM training_sessions WHERE id = ?').get(row.id)) })
    }

    const sessionPath = /^\/sessions\/([^/]+)$/.exec(path)
    if (sessionPath && method === 'DELETE') {
      const row = findSession(db, user.id, decodeURIComponent(sessionPath[1]))
      if (!row) fail('not_found', 404, '训练记录不存在')
      db.prepare('UPDATE training_sessions SET deleted_at = ?, updated_at = ? WHERE id = ?').run(nowIso(), nowIso(), row.id)
      return sendEmpty(res, 204)
    }

    if (path === '/meals' && method === 'GET') {
      const date = url.searchParams.get('date')
      const rows = date && isDate(date)
        ? db.prepare('SELECT * FROM meal_records WHERE user_id = ? AND date = ? AND deleted_at IS NULL ORDER BY time ASC').all(user.id, date)
        : db.prepare('SELECT * FROM meal_records WHERE user_id = ? AND deleted_at IS NULL ORDER BY date ASC, time ASC').all(user.id)
      return sendJson(res, 200, { meals: rows.map((row) => mealJson(row, readItems(db, 'meal_items', 'meal_record_id', row.id))) })
    }

    if (path === '/meals' && method === 'POST') {
      const idKey = String(req.headers['idempotency-key'] ?? '') || null
      const cached = idempotencyResult(db, user.id, idKey)
      if (cached) return sendJson(res, cached.status, cached.body)
      const raw = body.meal && typeof body.meal === 'object' ? body.meal : body
      const clientId = stringOrNull(raw.clientId || raw.id, 100) ?? randomUUID()
      const existing = db.prepare('SELECT * FROM meal_records WHERE user_id = ? AND client_id = ?').get(user.id, clientId)
      if (existing) {
        const result = { status: 200, body: { meal: readMeal(db, existing.id) } }
        saveIdempotency(db, user.id, idKey, method, path, result.status, result.body)
        return sendJson(res, result.status, result.body)
      }
      const date = isDate(raw.date) ? raw.date : null
      assert(date, '餐食记录缺少日期')
      const mealType = ['breakfast', 'lunch', 'dinner', 'snack'].includes(raw.mealType) ? raw.mealType : 'snack'
      const id = randomUUID()
      const now = nowIso()
      db.exec('BEGIN')
      try {
        db.prepare(`
          INSERT INTO meal_records (
            id, client_id, user_id, date, meal_type, time, completeness, analyzed,
            photo_thumb, photo_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          id, clientId, user.id, date, mealType, stringOrNull(raw.time, 10),
          ['complete', 'partial', 'unknown'].includes(raw.completeness) ? raw.completeness : 'unknown',
          raw.analyzed ? 1 : 0, stringOrNull(raw.photoThumb, 200000), stringOrNull(raw.photoId, 200),
          stringOrNull(raw.createdAt, 40) ?? now, now
        )
        writeMealItems(db, id, Array.isArray(raw.items) ? raw.items : [])
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
      const result = { status: 201, body: { meal: readMeal(db, id) } }
      saveIdempotency(db, user.id, idKey, method, path, result.status, result.body)
      return sendJson(res, result.status, result.body)
    }

    const mealPath = /^\/meals\/([^/]+)$/.exec(path)
    if (mealPath && method === 'PATCH') {
      const row = findMeal(db, user.id, decodeURIComponent(mealPath[1]))
      if (!row) fail('not_found', 404, '餐食记录不存在')
      const now = nowIso()
      db.exec('BEGIN')
      try {
        db.prepare(`
          UPDATE meal_records SET
            time = COALESCE(?, time),
            meal_type = COALESCE(?, meal_type),
            completeness = COALESCE(?, completeness),
            analyzed = ?,
            updated_at = ?
          WHERE id = ?
        `).run(
          stringOrNull(body.time, 10),
          ['breakfast', 'lunch', 'dinner', 'snack'].includes(body.mealType) ? body.mealType : null,
          ['complete', 'partial', 'unknown'].includes(body.completeness) ? body.completeness : null,
          body.analyzed ? 1 : 0, now, row.id
        )
        if (Array.isArray(body.items)) writeMealItems(db, row.id, body.items)
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
      return sendJson(res, 200, { meal: readMeal(db, row.id) })
    }

    if (mealPath && method === 'DELETE') {
      const row = findMeal(db, user.id, decodeURIComponent(mealPath[1]))
      if (!row) fail('not_found', 404, '餐食记录不存在')
      db.prepare('UPDATE meal_records SET deleted_at = ?, updated_at = ? WHERE id = ?').run(nowIso(), nowIso(), row.id)
      return sendEmpty(res, 204)
    }

    if (path === '/plans/current' && method === 'GET') {
      const week = mondayOf(url.searchParams.get('week') ?? isoLocal(new Date()))
      if (!week) fail('validation_failed', 400, 'week 参数不是有效日期')
      const mode = url.searchParams.get('mode') === 'athlete' ? 'athlete' : 'public'
      const plan = latestPlan(db, user.id, isoLocal(week), mode)
      return sendJson(res, 200, { plan })
    }

    if (path === '/plans' && method === 'POST') {
      const idKey = String(req.headers['idempotency-key'] ?? '') || null
      const cached = idempotencyResult(db, user.id, idKey)
      if (cached) return sendJson(res, cached.status, cached.body)
      const raw = body.plan && typeof body.plan === 'object' ? body.plan : body
      const clientId = stringOrNull(raw.clientId || raw.id, 120) ?? randomUUID()
      const existing = db.prepare('SELECT * FROM plans WHERE user_id = ? AND client_id = ?').get(user.id, clientId)
      if (existing) {
        const result = { status: 200, body: { plan: readPlan(db, existing.id) } }
        saveIdempotency(db, user.id, idKey, method, path, result.status, result.body)
        return sendJson(res, result.status, result.body)
      }
      const version = integerOrNull(raw.version) ?? 1
      const weekStart = mondayOf(raw.weekStartDate)
      assert(weekStart, '计划缺少有效的周起始日期')
      const weekStartIso = isoLocal(weekStart)
      const mode = raw.mode === 'athlete' ? 'athlete' : 'public'
      const sameVersion = db.prepare(`
        SELECT * FROM plans WHERE user_id = ? AND week_start = ? AND mode = ? AND version = ?
      `).get(user.id, weekStartIso, mode, version)
      if (sameVersion) {
        const latest = latestPlan(db, user.id, weekStartIso, mode)
        return sendJson(res, 409, {
          code: 'conflict',
          message: '计划版本冲突',
          detail: { latest, reason: 'same-version' }
        })
      }
      assert(Array.isArray(raw.items), '计划缺少 items')
      const id = randomUUID()
      const weekEndDate = isDate(raw.weekEndDate)
        ? raw.weekEndDate
        : isoLocal(weekDates(weekStart).at(-1))
      const now = nowIso()
      db.exec('BEGIN')
      try {
        const current = latestPlan(db, user.id, weekStartIso, mode)
        if (current) {
          const baseVersion = planBaseVersion(req, body)
          if (current.version !== baseVersion || version !== baseVersion + 1) {
            fail('conflict', 409, '计划已更新，请比较最新计划后再提交', { latest: current, currentVersion: current.version })
          }
        }
        db.prepare(`
          INSERT INTO plans (
            id, user_id, client_id, version, mode, week_start, week_end, reason,
            rules_version, source, locked, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          id, user.id, clientId, version, mode, weekStartIso, weekEndDate,
          stringOrNull(raw.reason, 500) ?? '本机计划同步', stringOrNull(raw.rulesVersion, 80) ?? 'plan-rules-v3',
          stringOrNull(raw.source, 20) ?? 'rules', raw.locked ? 1 : 0,
          stringOrNull(raw.createdAt, 40) ?? now, now
        )
        writePlanItems(db, id, raw.items)
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
      const result = { status: 201, body: { plan: readPlan(db, id) } }
      saveIdempotency(db, user.id, idKey, method, path, result.status, result.body)
      return sendJson(res, result.status, result.body)
    }

    const adjustPath = /^\/plans\/([^/]+)\/adjustments$/.exec(path)
      ?? (path === '/plans/adjustments' && typeof body.planId === 'string' ? [path, body.planId] : null)
    if (adjustPath && method === 'POST') {
      const baseVersion = planBaseVersion(req, body)
      const idKey = String(req.headers['idempotency-key'] ?? '') || null
      const cached = idempotencyResult(db, user.id, idKey)
      if (cached) return sendJson(res, cached.status, cached.body)
      const plan = findPlan(db, user.id, decodeURIComponent(adjustPath[1]))
      if (!plan) fail('not_found', 404, '计划不存在')
      const changes = Array.isArray(body.changes) ? body.changes : []
      const id = randomUUID()
      db.prepare(`
        INSERT INTO plan_adjustments (id, plan_id, user_id, base_version, created_at, reason, status, changes_json)
        VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
      `).run(id, plan.id, user.id, baseVersion, nowIso(), stringOrNull(body.reason, 500), JSON.stringify(changes))
      const result = { status: 201, body: { adjustment: { id, planId: plan.id, baseVersion, status: 'pending', changes } } }
      saveIdempotency(db, user.id, idKey, method, path, result.status, result.body)
      return sendJson(res, result.status, result.body)
    }

    const acceptPath = /^\/plans\/adjustments\/([^/]+)\/accept$/.exec(path)
    if (acceptPath && method === 'POST') {
      const baseVersion = planBaseVersion(req, body)
      const result = transaction(db, () => {
        const adjustment = db.prepare('SELECT * FROM plan_adjustments WHERE id = ? AND user_id = ?')
          .get(decodeURIComponent(acceptPath[1]), user.id)
        if (!adjustment) fail('not_found', 404, '调整不存在')
        const planRow = db.prepare('SELECT * FROM plans WHERE id = ? AND user_id = ?').get(adjustment.plan_id, user.id)
        if (!planRow) fail('not_found', 404, '计划不存在')
        if (adjustment.status === 'accepted') {
          const acceptedPlan = db.prepare('SELECT * FROM plans WHERE user_id = ? AND client_id = ?')
            .get(user.id, `adjustment:${adjustment.id}`)
          if (acceptedPlan) {
            return {
              adjustmentId: adjustment.id,
              newVersion: acceptedPlan.version,
              lockedPreserved: true,
              plan: readPlan(db, acceptedPlan.id)
            }
          }
        }
        const latestRow = db.prepare(`
          SELECT * FROM plans
          WHERE user_id = ? AND week_start = ? AND mode = ? AND deleted_at IS NULL
          ORDER BY version DESC LIMIT 1
        `).get(user.id, planRow.week_start, planRow.mode)
        if (!latestRow) fail('not_found', 404, '计划不存在')
        if (latestRow.version !== baseVersion || adjustment.base_version !== baseVersion) {
          fail('conflict', 409, '计划已被其他版本更新，请比较最新计划后重新提交',
            { latest: readPlan(db, latestRow.id), baseVersion, currentVersion: latestRow.version })
        }
        const changes = jsonParse(adjustment.changes_json, [])
        const items = readItems(db, 'plan_items', 'plan_id', latestRow.id)
        const byClientId = new Map(items.map((item) => [item.client_item_id || item.id, { ...item }]))
        for (const change of changes) {
          if (!change || change.type !== 'changed') continue
          const item = byClientId.get(String(change.itemId))
          if (!item) continue
          if (item.locked || item.completed) {
            continue
          }
          const patch = change.newValue && typeof change.newValue === 'object' ? change.newValue : {}
          if (patch.date !== undefined) item.date = isDate(patch.date) ? patch.date : item.date
          if (patch.exerciseName !== undefined) item.exercise_name = stringOrNull(patch.exerciseName, 120) ?? item.exercise_name
          if (patch.type !== undefined) item.type = stringOrNull(patch.type, 40) ?? item.type
          if (patch.note !== undefined) item.note = stringOrNull(patch.note, 200)
          if (patch.plannedDuration !== undefined) item.planned_duration = integerOrNull(patch.plannedDuration)
          if (patch.plannedDistance !== undefined) item.planned_distance = integerOrNull(patch.plannedDistance)
          if (patch.plannedSets !== undefined) item.planned_sets = integerOrNull(patch.plannedSets)
          if (patch.plannedReps !== undefined) item.planned_reps = integerOrNull(patch.plannedReps)
          if (patch.plannedHoldSeconds !== undefined) item.planned_hold_seconds = integerOrNull(patch.plannedHoldSeconds)
          if (patch.plannedTargetMinutes !== undefined) item.planned_target_minutes = integerOrNull(patch.plannedTargetMinutes)
        }
        const now = nowIso()
        const newPlanId = randomUUID()
        db.prepare(`
          INSERT INTO plans (
            id, user_id, client_id, version, mode, week_start, week_end, reason,
            rules_version, source, locked, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          newPlanId, user.id, `adjustment:${adjustment.id}`, latestRow.version + 1, latestRow.mode,
          latestRow.week_start, latestRow.week_end, `${latestRow.reason}（调整 ${adjustment.id}）`,
          latestRow.rules_version, latestRow.source, latestRow.locked, now, now
        )
        const insert = db.prepare(`
          INSERT INTO plan_items (
            id, client_item_id, plan_id, date, exercise_id, exercise_name, type, note,
            planned_duration, planned_distance, planned_sets, planned_reps, planned_hold_seconds,
            planned_target_minutes, locked, completed, alternatives_json, order_index
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        [...byClientId.values()].forEach((item, index) => {
          insert.run(
            randomUUID(), item.client_item_id || item.id, newPlanId, item.date, item.exercise_id,
            item.exercise_name, item.type, item.note, item.planned_duration, item.planned_distance,
            item.planned_sets, item.planned_reps, item.planned_hold_seconds, item.planned_target_minutes,
            item.locked, item.completed, item.alternatives_json, index
          )
        })
        db.prepare('UPDATE plan_adjustments SET status = ? WHERE id = ?').run('accepted', adjustment.id)
        return {
          adjustmentId: adjustment.id,
          newVersion: latestRow.version + 1,
          lockedPreserved: true,
          plan: readPlan(db, newPlanId)
        }
      })
      return sendJson(res, 200, result)
    }

    if (path === '/reports/weekly' && method === 'GET') {
      const start = mondayOf(url.searchParams.get('start') ?? isoLocal(new Date()))
      if (!start) fail('validation_failed', 400, 'start 参数不是有效日期')
      const mode = url.searchParams.get('mode') === 'athlete' ? 'athlete' : 'public'
      const plan = latestPlan(db, user.id, isoLocal(start), mode)
      const days = weekDates(start)
      const from = isoLocal(days[0])
      const to = isoLocal(days.at(-1))
      const report = buildWeeklyReport({
        start: from,
        userId: user.id,
        sessions: sessionRowsForWeek(db, user.id, from, to),
        meals: mealRowsForWeek(db, user.id, from, to),
        planItems: plan?.items ?? []
      })
      return sendJson(res, 200, { report })
    }

    if (path === '/sync' && method === 'GET') {
      const since = url.searchParams.get('since')
      const serverTime = nowIso()
      const profileRow = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(user.id)
      const privacyRow = db.prepare('SELECT * FROM privacy_settings WHERE user_id = ?').get(user.id)
      const profileChanged = !since || (profileRow && profileRow.updated_at > since)
      const privacyChanged = !since || (privacyRow && privacyRow.updated_at > since)
      const sessionRows = since
        ? db.prepare(`
            SELECT * FROM training_sessions
            WHERE user_id = ? AND (updated_at > ? OR deleted_at > ?)
            ORDER BY date ASC
          `).all(user.id, since, since)
        : db.prepare('SELECT * FROM training_sessions WHERE user_id = ? ORDER BY date ASC').all(user.id)
      const mealRows = since
        ? db.prepare(`
            SELECT * FROM meal_records
            WHERE user_id = ? AND (updated_at > ? OR deleted_at > ?)
            ORDER BY date ASC
          `).all(user.id, since, since)
        : db.prepare('SELECT * FROM meal_records WHERE user_id = ? ORDER BY date ASC').all(user.id)
      const plans = db.prepare('SELECT * FROM plans WHERE user_id = ? AND deleted_at IS NULL ORDER BY week_start ASC, version ASC').all(user.id)
        .map((row) => planJson(row, readItems(db, 'plan_items', 'plan_id', row.id)))
      const modeLog = db.prepare('SELECT * FROM mode_changes WHERE user_id = ? ORDER BY at ASC').all(user.id).map((row) => ({
        from: row.from_mode,
        to: row.to_mode,
        at: row.at,
        openPlanCount: row.open_plan_count ?? 0
      }))
      const deleted = {
        sessions: sessionRows.filter((row) => row.deleted_at).map((row) => ({ id: row.id, clientId: row.client_id })),
        meals: mealRows.filter((row) => row.deleted_at).map((row) => ({ id: row.id, clientId: row.client_id })),
        plans: []
      }
      db.prepare(`
        INSERT INTO sync_state (user_id, last_sync_at) VALUES (?, ?)
        ON CONFLICT(user_id) DO UPDATE SET last_sync_at = excluded.last_sync_at
      `).run(user.id, serverTime)
      return sendJson(res, 200, {
        serverTime,
        profile: profileChanged ? profileJson(profileRow) : null,
        privacy: privacyChanged ? privacyJson(privacyRow) : null,
        sessions: sessionRows.filter((row) => !row.deleted_at).map(sessionJson),
        meals: mealRows.filter((row) => !row.deleted_at).map((row) => mealJson(row, readItems(db, 'meal_items', 'meal_record_id', row.id))),
        plans,
        modeLog,
        deleted
      })
    }

    if (path === '/export' && method === 'GET') {
      const rows = db.prepare('SELECT * FROM export_jobs WHERE user_id = ? ORDER BY created_at DESC LIMIT 20').all(user.id)
      return sendJson(res, 200, {
        jobs: rows.map((row) => ({
          jobId: row.id,
          format: row.format,
          status: row.status,
          createdAt: row.created_at,
          completedAt: row.completed_at
        }))
      })
    }

    if (path === '/export' && method === 'POST') {
      if (!allow(`export:${user.id}`, 10, 60_000)) fail('rate_limited', 429, '导出请求过于频繁')
      const format = body.format === 'json' ? 'json' : 'csv'
      const id = randomUUID()
      const now = nowIso()
      db.prepare(`
        INSERT INTO export_jobs (id, user_id, format, status, content, error, created_at, completed_at)
        VALUES (?, ?, ?, 'pending', NULL, NULL, ?, NULL)
      `).run(id, user.id, format, now)
      setImmediate(scheduleExports)
      return sendJson(res, 202, { jobId: id, format, status: 'pending' })
    }

    const exportPath = /^\/export\/([^/]+)$/.exec(path)
    if (exportPath && method === 'GET') {
      const job = db.prepare('SELECT * FROM export_jobs WHERE id = ? AND user_id = ?').get(decodeURIComponent(exportPath[1]), user.id)
      if (!job) fail('not_found', 404, '导出任务不存在')
      return sendJson(res, 200, {
        jobId: job.id,
        format: job.format,
        status: job.status,
        downloadUrl: job.status === 'completed' ? `/api/v1/export/${job.id}/download` : null,
        error: job.error ?? undefined
      })
    }

    const downloadPath = /^\/export\/([^/]+)\/download$/.exec(path)
    if (downloadPath && method === 'GET') {
      const job = db.prepare('SELECT * FROM export_jobs WHERE id = ? AND user_id = ?').get(decodeURIComponent(downloadPath[1]), user.id)
      if (!job) fail('not_found', 404, '导出任务不存在')
      if (job.status !== 'completed' || !job.content) fail('not_found', 404, '导出文件尚未就绪')
      res.writeHead(200, {
        'Content-Type': job.format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="twopoles-${job.id.slice(0, 8)}.${job.format}"`,
        'Cache-Control': 'no-store'
      })
      return res.end(job.content)
    }

    return sendJson(res, 404, { code: 'not_found', message: '接口不存在' })
  }

  async function handler(req, res) {
    try {
      await route(req, res)
    } catch (error) {
      if (res.headersSent) return
      if (error instanceof HttpError) {
        return sendJson(res, error.status, { code: error.code, message: error.message, detail: error.detail })
      }
      console.error('[api] unhandled', error)
      sendJson(res, 500, { code: 'unknown', message: '服务器内部错误' })
    }
  }

  const server = createServer((req, res) => { void handler(req, res) })
  return {
    server,
    db,
    async close() {
      closing = true
      if (exportWorker) await exportWorker.terminate()
      await exportTask
      await new Promise((resolveClosed) => server.close(resolveClosed))
      db.close()
    }
  }
}
