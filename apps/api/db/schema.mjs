/**
 * profiles 表的列定义。建新库（SCHEMA）与迁移时重建旧表都用这一份，
 * 免得出现"新库有列、迁移完没有"这类漂移。
 * disciplines_json：专项改为可多选后存数组；旧的单选 discipline 列保留为镜像（取第一项）。
 * age 上限 100：90 岁以上仍在规律活动的用户不该被档案拒绝（前端 AGE_RANGE 同口径）。
 */
export const PROFILES_COLUMNS = `
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  nickname TEXT,
  avatar_data_url TEXT,
  age INTEGER NOT NULL CHECK(age >= 12 AND age <= 100),
  goal TEXT,
  experience TEXT,
  available_times_json TEXT NOT NULL DEFAULT '[]',
  equipment_json TEXT NOT NULL DEFAULT '[]',
  available_venues_json TEXT NOT NULL DEFAULT '[]',
  restrictions_json TEXT NOT NULL DEFAULT '[]',
  height REAL,
  weight REAL,
  discipline TEXT,
  disciplines_json TEXT NOT NULL DEFAULT '[]',
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
`

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('anonymous','registered')),
  identifier_hash TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS profiles (
${PROFILES_COLUMNS}
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
  action TEXT NOT NULL,
  exercise_name TEXT NOT NULL,
  view TEXT NOT NULL CHECK(view IN ('side','front','oblique')),
  status TEXT NOT NULL CHECK(status IN ('completed','low-confidence')),
  low_confidence_reasons TEXT NOT NULL DEFAULT '[]',
  findings TEXT NOT NULL DEFAULT '[]',
  metrics TEXT NOT NULL DEFAULT '[]',
  rep_count INTEGER,
  gait_cycles INTEGER,
  usable_ratio REAL,
  evidence TEXT,
  session_id TEXT,
  rule_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE (user_id, client_id)
);

-- 已处理的计划调整建议：跨设备共享，避免同一条建议在另一台设备上又弹一次。
-- status 只有 accepted / dismissed；按 updated_at 做 last-write-wins。
CREATE TABLE IF NOT EXISTS adjustment_resolutions (
  user_id TEXT NOT NULL REFERENCES users(id),
  resolution_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('accepted','dismissed')),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, resolution_key)
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_date ON training_sessions(user_id, date);
CREATE INDEX IF NOT EXISTS idx_meals_user_date ON meal_records(user_id, date);
CREATE INDEX IF NOT EXISTS idx_plans_user_week ON plans(user_id, week_start);
CREATE INDEX IF NOT EXISTS idx_adjustments_plan ON plan_adjustments(plan_id);
CREATE INDEX IF NOT EXISTS idx_motion_analyses_user_date ON motion_analyses(user_id, date);
CREATE INDEX IF NOT EXISTS idx_adjustment_resolutions_user ON adjustment_resolutions(user_id, updated_at);
`
