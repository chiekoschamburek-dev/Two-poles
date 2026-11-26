import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * profiles 表的列定义。建新库（SCHEMA）与迁移时重建旧表都用这一份，
 * 免得出现"新库有列、迁移完没有"这类漂移。
 * disciplines_json：专项改为可多选后存数组；旧的单选 discipline 列保留为镜像（取第一项）。
 * age 上限 100：90 岁以上仍在规律活动的用户不该被档案拒绝（前端 AGE_RANGE 同口径）。
 */
const PROFILES_COLUMNS = `
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
  // 幂等 probe-and-ALTER：老库补 usable_ratio（可用帧占比），新库由 SCHEMA 直接建出
  const hasUsableRatio = () => db.prepare('PRAGMA table_info(motion_analyses)').all().some(column => column.name === 'usable_ratio')
  if (!hasUsableRatio()) {
    transaction(db, () => {
      if (!hasUsableRatio()) db.exec('ALTER TABLE motion_analyses ADD COLUMN usable_ratio REAL')
    })
  }
  migrateRemoveMode(db)
  migrateProfileDisciplines(db)
  backfillDisciplines(db)
  migrateMotionActionCheck(db)
  migrateMotionViewCheck(db)
  dropUnusedTablesOnce(db)
  return db
}

/**
 * 重建 motion_analyses 表：SQLite 不能 DROP CHECK，动作/视角的 CHECK 要放宽只能重建。
 * 新库由 SCHEMA 直接建出最新结构；旧库在这里一次性搬数据，列缺失的用 NULL 补。
 */
const MOTION_ANALYSIS_COPY_COLUMNS = [
  'id', 'client_id', 'user_id', 'date', 'action', 'exercise_name', 'view', 'status',
  'low_confidence_reasons', 'findings', 'metrics', 'rep_count', 'gait_cycles', 'usable_ratio',
  'session_id', 'rule_version', 'created_at', 'updated_at', 'deleted_at'
]

function rebuildMotionAnalysesTable(db) {
  const columns = new Set(db.prepare('PRAGMA table_info(motion_analyses)').all().map(column => column.name))
  const copyColumn = (name) => columns.has(name) ? name : 'NULL'
  db.exec('PRAGMA foreign_keys = OFF')
  try {
    transaction(db, () => {
      db.exec(`
        CREATE TABLE motion_analyses_new (
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
          session_id TEXT,
          rule_version TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          deleted_at TEXT,
          UNIQUE (user_id, client_id)
        )
      `)
      db.exec(`INSERT INTO motion_analyses_new (${MOTION_ANALYSIS_COPY_COLUMNS.join(', ')})
        SELECT ${MOTION_ANALYSIS_COPY_COLUMNS.map(copyColumn).join(', ')} FROM motion_analyses`)
      db.exec('DROP TABLE motion_analyses')
      db.exec('ALTER TABLE motion_analyses_new RENAME TO motion_analyses')
      db.exec('CREATE INDEX IF NOT EXISTS idx_motion_analyses_user_date ON motion_analyses(user_id, date)')
    })
  } finally {
    db.exec('PRAGMA foreign_keys = ON')
  }
}

/**
 * 旧库的 motion_analyses.action 带 CHECK(action IN ('squat','deadlift','running'))，
 * 新增分析模板会被数据库直接拒绝。SQLite 不能 DROP CHECK，只能重建表；
 * 新库由 SCHEMA 直接建出无 CHECK 版本，这里用 sqlite_master 的 SQL 做幂等探针。
 */
function migrateMotionActionCheck(db) {
  const tableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'motion_analyses'").get()?.sql ?? ''
  if (!/CHECK\s*\(\s*action\s+IN/i.test(tableSql)) return
  rebuildMotionAnalysesTable(db)
}

/**
 * 旧库的 motion_analyses.view 只允许 side/front，V2 的斜侧（oblique）记录会被 CHECK 拒绝。
 * 幂等：view CHECK 已含 oblique（新库直接建出）时跳过。
 */
function migrateMotionViewCheck(db) {
  const tableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'motion_analyses'").get()?.sql ?? ''
  const match = /CHECK\s*\(\s*view\s+IN\s*\(([^)]*)\)/i.exec(tableSql)
  if (!match || /oblique/i.test(match[1])) return
  rebuildMotionAnalysesTable(db)
}

/**
 * 早期设计里的目录/模板/规则版本表从未接入接口：代码里没有任何读写，留着只会让备份和
 * “哪些数据是真的”变模糊。只在第一次升级时清理一次（用 user_version 标记），
 * 避免将来重建同名表后被下一次启动静默删掉。
 */
const UNUSED_TABLES = ['template_items', 'templates', 'exercises', 'foods', 'mixed_foods', 'rule_versions', 'analysis_records', 'meal_analyses']
const DROP_UNUSED_TABLES_VERSION = 1

function dropUnusedTablesOnce(db) {
  const current = Number(db.prepare('PRAGMA user_version').get()?.user_version ?? 0)
  if (current >= DROP_UNUSED_TABLES_VERSION) return
  db.exec('PRAGMA foreign_keys = OFF')
  try {
    transaction(db, () => {
      for (const table of UNUSED_TABLES) db.exec(`DROP TABLE IF EXISTS ${table}`)
    })
  } finally {
    db.exec('PRAGMA foreign_keys = ON')
  }
  db.exec(`PRAGMA user_version = ${DROP_UNUSED_TABLES_VERSION}`)
}

/**
 * 专项改多选 + 年龄上限放宽：老库既没有 disciplines_json，CHECK 里也还卡着 age <= 90。
 * 两件都是表结构问题，沿用 migrateRemoveMode 的 probe-and-rebuild：只在确实缺列或
 * 还带旧 CHECK 时重建一次，重建时把旧的单选 discipline 折成数组，不丢用户填过的值。
 * 幂等：列已存在且 CHECK 已放宽时直接跳过。
 */
const LEGACY_AGE_CHECK = /age\s*<=\s*90/

function migrateProfileDisciplines(db) {
  const columns = db.prepare('PRAGMA table_info(profiles)').all().map(column => column.name)
  const tableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'profiles'").get()?.sql ?? ''
  if (columns.includes('disciplines_json') && !LEGACY_AGE_CHECK.test(tableSql)) return
  const rows = db.prepare('SELECT * FROM profiles').all()
  db.exec('PRAGMA foreign_keys = OFF')
  try {
    transaction(db, () => {
      db.exec('DROP TABLE IF EXISTS profiles_new')
      db.exec(`CREATE TABLE profiles_new (${PROFILES_COLUMNS})`)
      const insert = db.prepare(`INSERT INTO profiles_new (
        user_id, nickname, avatar_data_url, age, goal, experience, available_times_json, equipment_json,
        available_venues_json, restrictions_json, height, weight, discipline, disciplines_json,
        cycle_phase, cycle_start, cycle_end, goal_type, target_event, target_event_date, target_result,
        cycle_focus, personal_bests_json, gym_records_json, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      for (const row of rows) {
        insert.run(
          row.user_id,
          row.nickname ?? null,
          row.avatar_data_url ?? null,
          row.age,
          row.goal ?? null,
          row.experience ?? null,
          row.available_times_json ?? '[]',
          row.equipment_json ?? '[]',
          row.available_venues_json ?? '[]',
          row.restrictions_json ?? '[]',
          row.height ?? null,
          row.weight ?? null,
          row.discipline ?? null,
          JSON.stringify(legacyDisciplines(row.discipline)),
          row.cycle_phase ?? null,
          row.cycle_start ?? null,
          row.cycle_end ?? null,
          row.goal_type ?? null,
          row.target_event ?? null,
          row.target_event_date ?? null,
          row.target_result ?? null,
          row.cycle_focus ?? null,
          row.personal_bests_json ?? '[]',
          row.gym_records_json ?? '[]',
          row.updated_at
        )
      }
      db.exec('DROP TABLE profiles')
      db.exec('ALTER TABLE profiles_new RENAME TO profiles')
    })
  } finally {
    db.exec('PRAGMA foreign_keys = ON')
  }
}

/** 迁移可能先于写入发生：只要还只有单选 discipline、数组为空，就补进去（幂等） */
function backfillDisciplines(db) {
  const rows = db.prepare(`
    SELECT user_id, discipline, disciplines_json FROM profiles
    WHERE discipline IS NOT NULL AND trim(discipline) <> ''
  `).all()
  if (!rows.length) return
  const update = db.prepare('UPDATE profiles SET disciplines_json = ? WHERE user_id = ?')
  transaction(db, () => {
    for (const row of rows) {
      const current = jsonParse(row.disciplines_json, [])
      if (Array.isArray(current) && current.length) continue
      update.run(JSON.stringify(legacyDisciplines(row.discipline)), row.user_id)
    }
  })
}

function legacyDisciplines(value) {
  return typeof value === 'string' && value.trim() ? [value.trim()] : []
}

// 旧库去掉大众/运动员分类：档案与计划重建掉 mode 列，mode_changes 整表删除。
// 计划按 (user, week) 保留档案当前模式那一组的全部版本，另一模式的计划连同条目/调整一并删除。
// 幂等：列已不存在时直接跳过。
function migrateRemoveMode(db) {
  const columnsOf = (table) => db.prepare(`PRAGMA table_info(${table})`).all().map(column => column.name)
  db.exec('DROP TABLE IF EXISTS mode_changes')
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
        // 重建用与新库同一份列定义；disciplines_json 有默认值，SELECT 里不带它也不会报错，
        // 旧值随后由 backfillDisciplines() 从单选 discipline 折进数组。
        db.exec(`CREATE TABLE profiles_new (${PROFILES_COLUMNS})`)
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
