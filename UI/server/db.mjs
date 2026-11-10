import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('anonymous','registered')),
  identifier_hash TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  nickname TEXT,
  avatar_data_url TEXT,
  age INTEGER NOT NULL CHECK(age >= 12 AND age <= 90),
  goal TEXT,
  experience TEXT,
  available_times_json TEXT NOT NULL DEFAULT '[]',
  equipment_json TEXT NOT NULL DEFAULT '[]',
  available_venues_json TEXT NOT NULL DEFAULT '[]',
  restrictions_json TEXT NOT NULL DEFAULT '[]',
  height REAL,
  weight REAL,
  discipline TEXT,
  cycle_phase TEXT,
  cycle_start TEXT,
  cycle_end TEXT,
  goal_type TEXT,
  target_event TEXT,
  target_event_date TEXT,
  target_result TEXT,
  cycle_focus TEXT,
  personal_bests_json TEXT NOT NULL DEFAULT '[]',
  gym_records_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS exercises (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  equipment_json TEXT NOT NULL DEFAULT '[]',
  venues_json TEXT NOT NULL DEFAULT '[]',
  minutes INTEGER NOT NULL,
  sets INTEGER,
  reps INTEGER,
  intensity TEXT CHECK(intensity IN ('低','中','高')),
  jump_free INTEGER,
  knee_friendly INTEGER,
  spine_friendly INTEGER,
  howto TEXT,
  reason TEXT,
  camera_json TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','retired')),
  source TEXT NOT NULL,
  catalog_version TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  name TEXT,
  note TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS template_items (
  template_id TEXT NOT NULL REFERENCES templates(id),
  exercise_id TEXT REFERENCES exercises(id),
  day_offset INTEGER,
  order_index INTEGER NOT NULL,
  planned_minutes INTEGER,
  PRIMARY KEY (template_id, order_index)
);

CREATE TABLE IF NOT EXISTS foods (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  energy_kcal_per_100g REAL,
  note TEXT,
  verified INTEGER NOT NULL DEFAULT 0 CHECK(verified IN (0,1)),
  revised_at TEXT
);

CREATE TABLE IF NOT EXISTS mixed_foods (
  name TEXT PRIMARY KEY,
  note TEXT
);

CREATE TABLE IF NOT EXISTS rule_versions (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('diet','report','plan','food','exercise')),
  version TEXT NOT NULL,
  published_at TEXT,
  notes_json TEXT,
  UNIQUE (kind, version)
);

CREATE TABLE IF NOT EXISTS analysis_records (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  kind TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  rule_version TEXT,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS meal_analyses (
  id TEXT PRIMARY KEY,
  meal_record_id TEXT NOT NULL REFERENCES meal_records(id),
  category_coverage_json TEXT NOT NULL DEFAULT '[]',
  missing_categories_json TEXT NOT NULL DEFAULT '[]',
  unknown_items_json TEXT NOT NULL DEFAULT '[]',
  has_nutrition_estimate INTEGER NOT NULL DEFAULT 0,
  estimate_refs_json TEXT,
  rule_version TEXT,
  limitations_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  client_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  week_start TEXT NOT NULL,
  week_end TEXT,
  reason TEXT NOT NULL,
  rules_version TEXT NOT NULL,
  source TEXT,
  locked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE (user_id, client_id),
  UNIQUE (user_id, week_start, version)
);

CREATE TABLE IF NOT EXISTS plan_items (
  id TEXT PRIMARY KEY,
  client_item_id TEXT,
  plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  exercise_id TEXT,
  exercise_name TEXT NOT NULL,
  type TEXT,
  note TEXT,
  planned_duration INTEGER,
  planned_distance INTEGER,
  planned_sets INTEGER,
  planned_reps INTEGER,
  planned_hold_seconds INTEGER,
  planned_target_minutes INTEGER,
  locked INTEGER NOT NULL DEFAULT 0,
  completed INTEGER NOT NULL DEFAULT 0,
  alternatives_json TEXT NOT NULL DEFAULT '[]',
  order_index INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS plan_adjustments (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES plans(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  base_version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','rejected')),
  changes_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS training_sessions (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  plan_item_id TEXT,
  date TEXT NOT NULL,
  exercise_name TEXT NOT NULL,
  type TEXT,
  actual_duration INTEGER,
  actual_distance INTEGER,
  actual_sets INTEGER,
  actual_reps INTEGER,
  completion_status TEXT CHECK(completion_status IN ('completed','partial','skipped')),
  completion_reason TEXT,
  rpe INTEGER CHECK(rpe BETWEEN 0 AND 10 OR rpe IS NULL),
  discomfort INTEGER NOT NULL DEFAULT 0 CHECK(discomfort IN (0,1)),
  notes TEXT,
  camera_used INTEGER NOT NULL DEFAULT 0 CHECK(camera_used IN (0,1)),
  manual_corrections INTEGER NOT NULL DEFAULT 0,
  counted_reps INTEGER,
  avg_confidence REAL,
  calibrated_neutral INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE (user_id, client_id)
);

CREATE TABLE IF NOT EXISTS meal_records (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  date TEXT NOT NULL,
  meal_type TEXT NOT NULL CHECK(meal_type IN ('breakfast','lunch','dinner','snack')),
  time TEXT,
  completeness TEXT CHECK(completeness IN ('complete','partial','unknown')),
  analyzed INTEGER NOT NULL DEFAULT 0 CHECK(analyzed IN (0,1)),
  photo_thumb TEXT,
  photo_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE (user_id, client_id)
);

CREATE TABLE IF NOT EXISTS meal_items (
  id TEXT PRIMARY KEY,
  client_item_id TEXT,
  meal_record_id TEXT NOT NULL REFERENCES meal_records(id) ON DELETE CASCADE,
  food_id TEXT,
  food_name TEXT NOT NULL,
  category TEXT NOT NULL,
  portion_size REAL,
  portion_unit TEXT,
  confirmed INTEGER NOT NULL DEFAULT 0 CHECK(confirmed IN (0,1)),
  source TEXT NOT NULL DEFAULT 'manual' CHECK(source IN ('manual','photo')),
  photo_confidence REAL,
  uncertain INTEGER,
  user_confirmed INTEGER,
  model_energy_json TEXT,
  order_index INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS privacy_settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_state (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  last_sync_at TEXT
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  user_id TEXT NOT NULL,
  key TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  status INTEGER NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, key)
);

CREATE TABLE IF NOT EXISTS export_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  format TEXT NOT NULL CHECK(format IN ('json','csv')),
  status TEXT NOT NULL CHECK(status IN ('pending','completed','failed')),
  content TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS confirm_tokens (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  actor_role TEXT CHECK(actor_role IN ('user','admin','system')),
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  event_code TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS motion_analyses (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  date TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('squat','deadlift','running')),
  exercise_name TEXT NOT NULL,
  view TEXT NOT NULL CHECK(view IN ('side','front')),
  status TEXT NOT NULL CHECK(status IN ('completed','low-confidence')),
  low_confidence_reasons TEXT NOT NULL DEFAULT '[]',
  findings TEXT NOT NULL DEFAULT '[]',
  metrics TEXT NOT NULL DEFAULT '[]',
  rep_count INTEGER,
  gait_cycles INTEGER,
  session_id TEXT,
  rule_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE (user_id, client_id)
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_date ON training_sessions(user_id, date);
CREATE INDEX IF NOT EXISTS idx_meals_user_date ON meal_records(user_id, date);
CREATE INDEX IF NOT EXISTS idx_plans_user_week ON plans(user_id, week_start);
CREATE INDEX IF NOT EXISTS idx_adjustments_plan ON plan_adjustments(plan_id);
CREATE INDEX IF NOT EXISTS idx_motion_analyses_user_date ON motion_analyses(user_id, date);
`

export function openDatabase(path = ':memory:') {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL;')
  db.exec('PRAGMA foreign_keys = ON;')
  db.exec(SCHEMA)
  const hasAvatarColumn = () => db.prepare('PRAGMA table_info(profiles)').all().some(column => column.name === 'avatar_data_url')
  if (!hasAvatarColumn()) {
    transaction(db, () => {
      if (!hasAvatarColumn()) db.exec('ALTER TABLE profiles ADD COLUMN avatar_data_url TEXT')
    })
  }
  migrateRemoveMode(db)
  return db
}

// 旧库去掉大众/运动员分类：档案与计划重建掉 mode 列，mode_changes 整表删除。
// 计划按 (user, week) 保留档案当前模式那一组的全部版本，另一模式的计划连同条目/调整一并删除。
// 幂等：列已不存在时直接跳过。
function migrateRemoveMode(db) {
  const columnsOf = (table) => db.prepare(`PRAGMA table_info(${table})`).all().map(column => column.name)
  db.exec('DROP TABLE IF EXISTS mode_changes')
  if (columnsOf('templates').includes('mode')) db.exec('ALTER TABLE templates DROP COLUMN mode')
  const plansHaveMode = columnsOf('plans').includes('mode')
  const profilesHaveMode = columnsOf('profiles').includes('mode')
  if (!plansHaveMode && !profilesHaveMode) return
  db.exec('PRAGMA foreign_keys = OFF')
  try {
    transaction(db, () => {
      const preferred = new Map()
      if (profilesHaveMode) {
        for (const row of db.prepare('SELECT user_id, mode FROM profiles').all()) {
          preferred.set(row.user_id, row.mode === 'athlete' ? 'athlete' : 'public')
        }
      }
      if (plansHaveMode) {
        const rows = db.prepare('SELECT * FROM plans').all()
        const groups = new Map()
        for (const plan of rows) {
          const key = `${plan.user_id}\u0000${plan.week_start}`
          let group = groups.get(key)
          if (!group) {
            group = { userId: plan.user_id, byMode: new Map() }
            groups.set(key, group)
          }
          let list = group.byMode.get(plan.mode)
          if (!list) {
            list = []
            group.byMode.set(plan.mode, list)
          }
          list.push(plan)
        }
        const dropIds = []
        for (const group of groups.values()) {
          let chosen = group.byMode.get(preferred.get(group.userId) ?? 'public')
          if (!chosen) {
            let best = null
            for (const list of group.byMode.values()) {
              const max = Math.max(...list.map(plan => plan.version))
              if (!best || max > best.max) best = { list, max }
            }
            chosen = best.list
          }
          const keep = new Set(chosen.map(plan => plan.id))
          for (const list of group.byMode.values()) {
            for (const plan of list) if (!keep.has(plan.id)) dropIds.push(plan.id)
          }
        }
        const dropSet = new Set(dropIds)
        for (const id of dropIds) {
          db.prepare('DELETE FROM plan_items WHERE plan_id = ?').run(id)
          db.prepare('DELETE FROM plan_adjustments WHERE plan_id = ?').run(id)
        }
        db.exec(`CREATE TABLE plans_new (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id),
          client_id TEXT NOT NULL,
          version INTEGER NOT NULL,
          week_start TEXT NOT NULL,
          week_end TEXT,
          reason TEXT NOT NULL,
          rules_version TEXT NOT NULL,
          source TEXT,
          locked INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          deleted_at TEXT,
          UNIQUE (user_id, client_id),
          UNIQUE (user_id, week_start, version)
        )`)
        const insert = db.prepare(`INSERT INTO plans_new (
          id, user_id, client_id, version, week_start, week_end, reason,
          rules_version, source, locked, created_at, updated_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        for (const plan of rows) {
          if (dropSet.has(plan.id)) continue
          insert.run(
            plan.id, plan.user_id, plan.client_id, plan.version, plan.week_start, plan.week_end,
            plan.reason, plan.rules_version, plan.source, plan.locked, plan.created_at, plan.updated_at, plan.deleted_at
          )
        }
        db.exec('DROP TABLE plans')
        db.exec('ALTER TABLE plans_new RENAME TO plans')
        db.exec('CREATE INDEX IF NOT EXISTS idx_plans_user_week ON plans(user_id, week_start)')
      }
      if (profilesHaveMode) {
        db.exec(`CREATE TABLE profiles_new (
          user_id TEXT PRIMARY KEY REFERENCES users(id),
          nickname TEXT,
          avatar_data_url TEXT,
          age INTEGER NOT NULL CHECK(age >= 12 AND age <= 90),
          goal TEXT,
          experience TEXT,
          available_times_json TEXT NOT NULL DEFAULT '[]',
          equipment_json TEXT NOT NULL DEFAULT '[]',
          available_venues_json TEXT NOT NULL DEFAULT '[]',
          restrictions_json TEXT NOT NULL DEFAULT '[]',
          height REAL,
          weight REAL,
          discipline TEXT,
          cycle_phase TEXT,
          cycle_start TEXT,
          cycle_end TEXT,
          goal_type TEXT,
          target_event TEXT,
          target_event_date TEXT,
          target_result TEXT,
          cycle_focus TEXT,
          personal_bests_json TEXT NOT NULL DEFAULT '[]',
          gym_records_json TEXT NOT NULL DEFAULT '[]',
          updated_at TEXT NOT NULL
        )`)
        db.exec(`INSERT INTO profiles_new (
          user_id, nickname, avatar_data_url, age, goal, experience, available_times_json, equipment_json,
          available_venues_json, restrictions_json, height, weight, discipline, cycle_phase, cycle_start, cycle_end,
          goal_type, target_event, target_event_date, target_result, cycle_focus, personal_bests_json, gym_records_json, updated_at
        ) SELECT
          user_id, nickname, avatar_data_url, age, goal, experience, available_times_json, equipment_json,
          available_venues_json, restrictions_json, height, weight, discipline, cycle_phase, cycle_start, cycle_end,
          goal_type, target_event, target_event_date, target_result, cycle_focus, personal_bests_json, gym_records_json, updated_at
        FROM profiles`)
        db.exec('DROP TABLE profiles')
        db.exec('ALTER TABLE profiles_new RENAME TO profiles')
      }
    })
  } finally {
    db.exec('PRAGMA foreign_keys = ON')
  }
}

export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export function nowIso() {
  return new Date().toISOString()
}

export function jsonParse(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}
