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
  age INTEGER NOT NULL CHECK(age >= 12 AND age <= 90),
  goal TEXT,
  experience TEXT,
  available_times_json TEXT NOT NULL DEFAULT '[]',
  equipment_json TEXT NOT NULL DEFAULT '[]',
  available_venues_json TEXT NOT NULL DEFAULT '[]',
  restrictions_json TEXT NOT NULL DEFAULT '[]',
  mode TEXT NOT NULL DEFAULT 'public' CHECK(mode IN ('public','athlete')),
  mode_changed_at TEXT,
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

CREATE TABLE IF NOT EXISTS mode_changes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  from_mode TEXT CHECK(from_mode IN ('public','athlete')),
  to_mode TEXT CHECK(to_mode IN ('public','athlete')),
  at TEXT NOT NULL,
  open_plan_count INTEGER
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
  mode TEXT,
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
  mode TEXT NOT NULL CHECK(mode IN ('public','athlete')),
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
  UNIQUE (user_id, week_start, mode, version)
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

CREATE INDEX IF NOT EXISTS idx_sessions_user_date ON training_sessions(user_id, date);
CREATE INDEX IF NOT EXISTS idx_meals_user_date ON meal_records(user_id, date);
CREATE INDEX IF NOT EXISTS idx_plans_user_week ON plans(user_id, week_start, mode);
CREATE INDEX IF NOT EXISTS idx_adjustments_plan ON plan_adjustments(plan_id);
`

export function openDatabase(path = ':memory:') {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL;')
  db.exec('PRAGMA foreign_keys = ON;')
  db.exec(SCHEMA)
  return db
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
