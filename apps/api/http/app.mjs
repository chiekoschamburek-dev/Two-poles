import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { Worker } from 'node:worker_threads'
import { backup } from 'node:sqlite'
import { mkdtemp, rmdir, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { openDatabase, transaction, nowIso, jsonParse } from '../db/index.mjs'
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
} from '../auth.mjs'
import { buildWeeklyReport, isoLocal, mondayOf, timeInZone, todayIso, weekDates } from '../report.mjs'
import { createHealthRoutes } from './routes/health.mjs'
import { createAuthRoutes } from './routes/auth.mjs'
import { createAccountRoutes } from './routes/account.mjs'
import { createSessionsRoutes } from './routes/sessions.mjs'
import { createAnalysesRoutes } from './routes/analyses.mjs'
import { createMealsRoutes } from './routes/meals.mjs'
import { createPlansRoutes } from './routes/plans.mjs'
import { createReportsRoutes } from './routes/reports.mjs'
import { createExportRoutes } from './routes/export.mjs'

const FOOD_CATEGORIES = ['谷薯类', '蔬菜类', '水果类', '蛋类', '奶类', '肉类', '豆类', '坚果类', '油脂类', '其他']
const DEFAULT_PRIVACY = {
  cameraEnabled: true,
  exportFormat: 'json',
  showEnergyEstimate: false,
  saveFoodPhotoLocally: true,
  saveMotionSeriesLocally: false
}
const MAX_BODY = 2 * 1024 * 1024
const EXPORT_TIMEOUT_MS = 60_000
const DEFAULT_DB = fileURLToPath(new URL('../data/twopoles.sqlite', import.meta.url))

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

/**
 * 专项的统一读法：新列 disciplines_json 优先；只有旧单选 discipline 的档案折成数组。
 * 返回空数组表示没填，不返回 null——前端与导出都不必再判两种形状。
 */
function disciplinesOfRow(row) {
  const list = jsonParse(row.disciplines_json, [])
  const cleaned = Array.isArray(list)
    ? list.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim())
    : []
  if (cleaned.length) return [...new Set(cleaned)]
  const legacy = typeof row.discipline === 'string' ? row.discipline.trim() : ''
  return legacy ? [legacy] : []
}

function profileJson(row) {
  if (!row) return null
  return {
    id: row.user_id,
    nickname: row.nickname ?? undefined,
    avatarDataUrl: row.avatar_data_url ?? undefined,
    age: row.age,
    goal: row.goal ?? '',
    experience: row.experience ?? '',
    availableTimes: jsonParse(row.available_times_json, []),
    equipment: jsonParse(row.equipment_json, []),
    availableVenues: jsonParse(row.available_venues_json, []),
    restrictions: jsonParse(row.restrictions_json, []),
    height: row.height ?? undefined,
    weight: row.weight ?? undefined,
    disciplines: disciplinesOfRow(row),
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
    ...(row.calibrated_neutral === null || row.calibrated_neutral === undefined ? {} : { calibratedNeutral: row.calibrated_neutral }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    _sync: 'synced'
  }
}

function analysisJson(row) {
  if (!row) return null
  return {
    id: row.id,
    serverId: row.id,
    clientId: row.client_id,
    userId: row.user_id,
    date: row.date,
    action: row.action,
    exerciseName: row.exercise_name,
    view: row.view,
    status: row.status,
    lowConfidenceReasons: jsonParse(row.low_confidence_reasons, []),
    findings: jsonParse(row.findings, []),
    metrics: jsonParse(row.metrics, []),
    repCount: row.rep_count ?? null,
    gaitCycles: row.gait_cycles ?? null,
    ...(row.usable_ratio === null || row.usable_ratio === undefined ? {} : { usableRatio: row.usable_ratio }),
    ...(row.evidence ? { evidence: row.evidence } : {}),
    sessionId: row.session_id ?? undefined,
    ruleVersion: row.rule_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    _sync: 'synced'
  }
}

/** 只保存有界、可序列化的小数组；超大或非对象条目直接丢弃，避免把服务端当图片桶 */
function boundedJsonArray(value, max) {
  if (!Array.isArray(value)) return []
  const out = []
  for (const item of value.slice(0, max)) {
    if (!item || typeof item !== 'object') continue
    let json = ''
    try {
      json = JSON.stringify(item)
    } catch {
      continue
    }
    if (json.length > 4000) continue
    out.push(item)
  }
  return out
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

/**
 * 餐食 JSON。缩略图不在这里返回：它是最大 120KB 的 base64，放进同步/导出/列表会让
 * 首屏同步变成几十 MB。需要时用 GET /meals/:id/thumb 单独取。
 */
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

function latestPlan(db, userId, weekStart) {
  const row = db.prepare(`
    SELECT * FROM plans
    WHERE user_id = ? AND week_start = ? AND deleted_at IS NULL
    ORDER BY version DESC LIMIT 1
  `).get(userId, weekStart)
  return row ? readPlan(db, row.id) : null
}

function audit(db, userId, action, targetType = null, targetId = null) {
  db.prepare(`
    INSERT INTO audit_events (user_id, actor_role, action, target_type, target_id, event_code, created_at)
    VALUES (?, 'user', ?, ?, ?, NULL, ?)
  `).run(userId, action, targetType, targetId, nowIso())
}

function idempotencyResult(db, userId, key, method, path) {
  if (!key) return null
  const row = db.prepare('SELECT * FROM idempotency_keys WHERE user_id = ? AND key = ?').get(userId, key)
  // 同一个 key 换了接口/方法就是另一件事，不能把上一个接口的响应体当成这次的结果
  if (!row || row.method !== method || row.path !== path) return null
  return { status: row.status, body: jsonParse(row.response_json, {}) }
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

function findAnalysis(db, userId, id) {
  return db.prepare(`
    SELECT * FROM motion_analyses
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
  assert(age !== null && age >= 12 && age <= 100, '年龄必须在 12–100 之间')
  const avatar = profile.avatarDataUrl ?? null
  if (avatar !== null) {
    const prefix = 'data:image/jpeg;base64,'
    const invalidAvatar = '头像需要是 180 KB 以内的 JPEG 图片'
    assert(typeof avatar === 'string' && avatar.length <= 180_000
      && /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(avatar), invalidAvatar)
    const bytes = Buffer.from(avatar.slice(prefix.length), 'base64')
    assert(bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9, invalidAvatar)
  }
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
  // 专项可多选：显式发数组就以数组为准（空数组＝清空）；只发旧的单选 discipline
  // 的客户端仍然收得下，折成只有一个元素的数组。档案 PUT 一直按整份覆盖处理，
  // 两个字段都不发与其它数组字段同一条规则：按空处理。
  const disciplines = stringArray(raw.disciplines, 30)
  const legacyDiscipline = stringOrNull(raw.discipline, 80)
  const disciplineList = Array.isArray(raw.disciplines)
    ? [...new Set(disciplines)]
    : (legacyDiscipline ? [legacyDiscipline] : [])

  db.prepare(`
    INSERT INTO profiles (
      user_id, nickname, avatar_data_url, age, goal, experience, available_times_json, equipment_json,
      available_venues_json, restrictions_json, height, weight,
      discipline, disciplines_json, cycle_phase, cycle_start, cycle_end, goal_type, target_event,
      target_event_date, target_result, cycle_focus, personal_bests_json,
      gym_records_json, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      nickname = excluded.nickname,
      avatar_data_url = excluded.avatar_data_url,
      age = excluded.age,
      goal = excluded.goal,
      experience = excluded.experience,
      available_times_json = excluded.available_times_json,
      equipment_json = excluded.equipment_json,
      available_venues_json = excluded.available_venues_json,
      restrictions_json = excluded.restrictions_json,
      height = excluded.height,
      weight = excluded.weight,
      discipline = excluded.discipline,
      disciplines_json = excluded.disciplines_json,
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
    avatar,
    age,
    stringOrNull(profile.goal, 200),
    stringOrNull(profile.experience, 200),
    jsonText(availableTimes),
    jsonText(equipment),
    jsonText(venues),
    jsonText(restrictions),
    height,
    weight,
    // 旧的单选列保留为镜像（取第一项），旧的读取方与导出仍能看懂
    disciplineList[0] ?? null,
    jsonText(disciplineList),
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
  let written = 0
  items.forEach((item, index) => {
    if (!item || typeof item !== 'object') return
    const date = isDate(item.date) ? item.date : null
    const name = stringOrNull(item.exerciseName, 120)
    if (!date || !name) return
    written += 1
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
  return written
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
  const analyses = db.prepare('SELECT * FROM motion_analyses WHERE user_id = ? AND deleted_at IS NULL ORDER BY date DESC, created_at DESC').all(userId).map(analysisJson)
  if (format === 'json') {
    return JSON.stringify({
      exportedAt: nowIso(),
      userId,
      profile: profileJson(profileRow),
      privacy: privacyJson(privacyRow),
      sessions,
      meals,
      plans,
      analyses
    }, null, 2)
  }
  const head = ['类别', '日期', '时间', '名称', '类型或类别', '时长分钟', '距离米', '次数', '组数', '单位', 'RPE', '负荷', '不适', '状态', '备注']
  const rows = [
    ...sessions.map((session) => [
      '训练', session.date, timeInZone(session.createdAt), session.exerciseName, session.type,
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
      '', '', '', item.completed ? '已完成' : '待完成', `v${plan.version}｜${plan.reason}`
    ])),
    ...analyses.map((analysis) => [
      '分析', analysis.date, '', analysis.exerciseName, analysis.action,
      '', '', '', '', '', '', '', '',
      analysis.status === 'low-confidence' ? '低置信度' : '完成',
      `视角 ${analysis.view === 'side' ? '侧面' : analysis.view === 'oblique' ? '斜侧' : '正面'}｜${analysis.findings.length} 项关注｜${analysis.ruleVersion}`
    ])
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
    db.prepare('DELETE FROM motion_analyses WHERE user_id = ?').run(userId)
    db.prepare('DELETE FROM plan_adjustments WHERE user_id = ?').run(userId)
    db.prepare('DELETE FROM adjustment_resolutions WHERE user_id = ?').run(userId)
    db.prepare('DELETE FROM plans WHERE user_id = ?').run(userId)
    db.prepare('DELETE FROM profiles WHERE user_id = ?').run(userId)
    db.prepare('DELETE FROM privacy_settings WHERE user_id = ?').run(userId)
    db.prepare('DELETE FROM sync_state WHERE user_id = ?').run(userId)
    db.prepare('DELETE FROM export_jobs WHERE user_id = ?').run(userId)
    if (deleteUser) db.prepare('DELETE FROM refresh_tokens WHERE user_id = ?').run(userId)
    db.prepare('DELETE FROM confirm_tokens WHERE user_id = ?').run(userId)
    db.prepare('DELETE FROM idempotency_keys WHERE user_id = ?').run(userId)
    db.prepare('DELETE FROM audit_events WHERE user_id = ?').run(userId)
    if (deleteUser) db.prepare('DELETE FROM users WHERE id = ?').run(userId)
  })
}

const RETENTION_DAYS = {
  revokedRefreshToken: 7,
  idempotency: 30,
  audit: 180,
  exportJob: 30,
  anonymousUser: 30
}

/**
 * 保留期清理：令牌、幂等键、审计日志、旧的导出作业和空壳匿名账号之前只增不删，
 * 会把主库与备份一起撑大。启动时跑一次、之后每 6 小时一次；返回值是各表实际删除的行数。
 */
export function pruneHistory(db, now = Date.now()) {
  const daysAgo = (days) => new Date(now - days * 86_400_000).toISOString()
  const nowString = new Date(now).toISOString()
  const counts = {
    refreshTokens: Number(db.prepare('DELETE FROM refresh_tokens WHERE expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)')
      .run(nowString, daysAgo(RETENTION_DAYS.revokedRefreshToken)).changes),
    idempotencyKeys: Number(db.prepare('DELETE FROM idempotency_keys WHERE created_at < ?')
      .run(daysAgo(RETENTION_DAYS.idempotency)).changes),
    auditEvents: Number(db.prepare('DELETE FROM audit_events WHERE created_at < ?')
      .run(daysAgo(RETENTION_DAYS.audit)).changes),
    exportJobs: Number(db.prepare("DELETE FROM export_jobs WHERE created_at < ? AND status <> 'pending'")
      .run(daysAgo(RETENTION_DAYS.exportJob)).changes),
    users: 0
  }
  // 只清理“没有任何数据”的匿名设备账号：/auth/device 每次调用都会建号，
  // 重装/清缓存会不断留下空壳；有训练或餐食的账号一律不动。
  const staleUsers = db.prepare(`
    SELECT id FROM users
    WHERE type = 'anonymous' AND deleted_at IS NULL AND created_at < ?
      AND NOT EXISTS (SELECT 1 FROM profiles WHERE user_id = users.id)
      AND NOT EXISTS (SELECT 1 FROM training_sessions WHERE user_id = users.id)
      AND NOT EXISTS (SELECT 1 FROM meal_records WHERE user_id = users.id)
      AND NOT EXISTS (SELECT 1 FROM plans WHERE user_id = users.id)
      AND NOT EXISTS (SELECT 1 FROM plan_adjustments WHERE user_id = users.id)
      AND NOT EXISTS (SELECT 1 FROM motion_analyses WHERE user_id = users.id)
  `).all(daysAgo(RETENTION_DAYS.anonymousUser))
  if (staleUsers.length) {
    transaction(db, () => {
      for (const { id } of staleUsers) {
        for (const table of ['refresh_tokens', 'confirm_tokens', 'idempotency_keys', 'audit_events', 'sync_state', 'export_jobs']) {
          db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(id)
        }
        db.prepare('DELETE FROM users WHERE id = ?').run(id)
        counts.users += 1
      }
    })
  }
  return counts
}

const PAGE_LIMIT_DEFAULT = 200
const PAGE_LIMIT_MAX = 500

/** 列表分页：默认 200 条、最多 500；nextOffset 为 null 表示没有更多 */
function pagination(url) {
  const rawLimit = Math.floor(Number(url.searchParams.get('limit')))
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, PAGE_LIMIT_MAX) : PAGE_LIMIT_DEFAULT
  const rawOffset = Math.floor(Number(url.searchParams.get('offset')))
  const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? rawOffset : 0
  return { limit, offset }
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
  let calls = 0
  return function allow(key, limit, windowMs) {
    const now = Date.now()
    // 限流键里含客户端可影响的 IP：过期桶不回收，长期就是一条内存增长路径。
    if (++calls % 256 === 0) {
      for (const [bucketKey, bucket] of buckets) {
        if (bucket.reset <= now) buckets.delete(bucketKey)
      }
    }
    const row = buckets.get(key)
    if (!row || row.reset <= now) {
      buckets.set(key, { count: 1, reset: now + windowMs })
      return true
    }
    row.count += 1
    return row.count <= limit
  }
}

const DEV_FALLBACK_SECRET = 'twopoles-dev-secret-change-me'

/**
 * AUTH_SECRET 解析：生产环境必须显式配置，缺省直接拒绝启动。
 * 默认值是公开的，拿它签名等于没有鉴权；宁可起不来，也不静默上线。
 * 测试/本地开发保留兜底值（内存库、本机调试都靠它）；options.secret 优先级最高。
 */
export function resolveAuthSecret(options = {}) {
  const provided = options.secret ?? process.env.AUTH_SECRET
  if (process.env.NODE_ENV === 'production' && (!provided || provided === DEV_FALLBACK_SECRET)) {
    throw new Error(
      '生产环境必须设置 AUTH_SECRET（例如 openssl rand -hex 32），当前缺失或仍是开发默认值；'
      + '拒绝启动，避免所有人共用公开的签名密钥。见 docs/engineering/deploy.md 的生产检查清单。'
    )
  }
  return provided ?? DEV_FALLBACK_SECRET
}

export function createApiServer(options = {}) {
  // 先解析密钥再开库：配置错误时不要留下半启动的数据库连接
  const secret = resolveAuthSecret(options)
  const dbPath = options.dbPath ?? process.env.TWOPOLES_DB ?? DEFAULT_DB
  const db = openDatabase(dbPath)
  /**
   * 账号标识哈希单独一把盐：轮换 AUTH_SECRET 只让 access token 失效，不会把所有人的
   * identifier_hash 一起换掉（那等于全员无法登录）。首次启用这项配置时要填当前的
   * AUTH_SECRET 值，之后保持不变；不配置就继续跟随 AUTH_SECRET（与旧库兼容）。
   */
  const identifierSecret = options.identifierSecret ?? process.env.IDENTIFIER_SECRET ?? secret
  const secureCookies = options.secureCookies ?? process.env.COOKIE_SECURE === 'true'
  const allowedOrigins = options.corsOrigins ?? (process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean)
    : ['http://localhost:5173', 'http://127.0.0.1:5173'])
  const allow = createRateLimiter()
  /**
   * 登录失败计数：只统计失败、成功即清零。正常用户反复登录不会被锁，
   * 攻击者也没法靠“成功登录”把别人挡在门外；窗口 60 秒，把定向锁死的代价限制在一分钟内。
   */
  const loginFailures = new Map()
  const LOGIN_FAILURE_LIMIT = 10
  const LOGIN_FAILURE_WINDOW_MS = 60_000
  function loginBlocked(identifier) {
    const row = loginFailures.get(identifier)
    if (!row) return false
    if (row.reset <= Date.now()) {
      loginFailures.delete(identifier)
      return false
    }
    return row.count >= LOGIN_FAILURE_LIMIT
  }
  function recordLoginFailure(identifier) {
    const now = Date.now()
    if (loginFailures.size > 1000) {
      for (const [key, row] of loginFailures) if (row.reset <= now) loginFailures.delete(key)
    }
    const row = loginFailures.get(identifier)
    if (!row || row.reset <= now) loginFailures.set(identifier, { count: 1, reset: now + LOGIN_FAILURE_WINDOW_MS })
    else row.count += 1
  }
  /**
   * 客户端 IP：默认沿用 X-Forwarded-For；部署在边缘函数/反代后面时用 TRUSTED_CLIENT_IP_HEADER
   * 指定由边缘写入的可信头（例如 ESA-Client-IP），此时不再回退到客户端能随便改的 XFF——
   * 否则「边缘已经覆盖 XFF」会退化成全体用户共用一个限流桶，或者被伪造头直接绕过。
   */
  const trustedIpHeader = String(options.clientIpHeader ?? process.env.TRUSTED_CLIENT_IP_HEADER ?? '').trim().toLowerCase()
  function clientIp(req) {
    if (trustedIpHeader) {
      const value = req.headers[trustedIpHeader]
      if (typeof value === 'string' && value.trim()) return value.split(',')[0].trim()
      return String(req.socket.remoteAddress ?? 'local')
    }
    return String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? 'local').split(',')[0].trim()
  }
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
            // 单个 worker 串行处理全部导出：没有超时看门狗时，一次挂起就等于全局导出队列永久停摆
            const content = await new Promise((resolveResult, reject) => {
              const worker = new Worker(new URL('../export-worker.mjs', import.meta.url), {
                workerData: { dbPath: source, userId: job.user_id, format: job.format }
              })
              exportWorker = worker
              const timer = setTimeout(() => {
                void worker.terminate().catch(() => {})
                reject(new Error('导出超时，已终止'))
              }, EXPORT_TIMEOUT_MS)
              const settle = (done, value) => {
                clearTimeout(timer)
                done(value)
              }
              worker.once('message', (value) => settle(resolveResult, value))
              worker.once('error', (error) => settle(reject, error))
              worker.once('exit', (code) => { if (code !== 0 || closing) settle(reject, new Error('导出进程已停止')) })
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
  // 保留期清理：启动先跑一次，之后每 6 小时；unref 不阻止进程退出
  try {
    pruneHistory(db)
  } catch (error) {
    console.error('[api] 保留期清理失败', error)
  }
  const pruneTimer = setInterval(() => {
    try {
      pruneHistory(db)
    } catch (error) {
      console.error('[api] 保留期清理失败', error)
    }
  }, 6 * 60 * 60 * 1000)
  pruneTimer.unref?.()

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
    const ip = clientIp(req)
    const body = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) ? await readBody(req) : {}
    // 请求级依赖：url 供分页/查询参数，user 供需要登录态的路由（未登录为 null，不抛错）
    const user = userFromRequest(req, db, secret)

    for (const handleRoute of routeHandlers) {
      const result = await handleRoute({ path, method, body, ip, url, user }, req, res)
      if (result !== false) return result
    }

    return sendJson(res, 404, { code: 'not_found', message: '接口不存在' })
  }

  /** 路由模块的依赖面：全部来自本闭包，按值传入（Map 与函数引用保持同一对象）。 */
  const api = {
    ACCESS_TTL_SECONDS,
    REFRESH_COOKIE,
    allow,
    analysisJson,
    assert,
    audit,
    bool,
    boundedJsonArray,
    buildWeeklyReport,
    clearRefreshCookie,
    confirmation,
    db,
    fail,
    findAnalysis,
    findMeal,
    findPlan,
    findSession,
    hashIdentifier,
    hashPassword,
    idempotencyResult,
    identifierSecret,
    integerOrNull,
    isDate,
    isIso,
    isoLocal,
    issueSession,
    join,
    jsonParse,
    latestPlan,
    loginBlocked,
    loginFailures,
    mealJson,
    mealRowsForWeek,
    mondayOf,
    normalizeIdentifier,
    nowIso,
    numberOrNull,
    pagination,
    parseCookies,
    planBaseVersion,
    planJson,
    privacyJson,
    profileJson,
    randomUUID,
    readItems,
    readMeal,
    readPlan,
    recordLoginFailure,
    refreshCookie,
    requireUser,
    revokeRefreshToken,
    rotateRefreshToken,
    saveIdempotency,
    scheduleExports,
    secret,
    secureCookies,
    sendEmpty,
    sendJson,
    sessionJson,
    sessionRowsForWeek,
    signAccessToken,
    stringOrNull,
    todayIso,
    transaction,
    userFromRequest,
    userJson,
    verifyPassword,
    weekDates,
    wipeUser,
    writeMealItems,
    writePlanItems,
    writeProfile,
  }

  const routeHandlers = [
    createHealthRoutes(api),
    createAuthRoutes(api),
    createAccountRoutes(api),
    createSessionsRoutes(api),
    createAnalysesRoutes(api),
    createMealsRoutes(api),
    createPlansRoutes(api),
    createReportsRoutes(api),
    createExportRoutes(api),
  ]

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
      clearInterval(pruneTimer)
      if (exportWorker) await exportWorker.terminate()
      await exportTask
      await new Promise((resolveClosed) => server.close(resolveClosed))
      db.close()
    }
  }
}
