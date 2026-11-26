import { PROFILES_COLUMNS } from './schema.mjs'
import { transaction, jsonParse } from './tx.mjs'

/**
 * 重建 motion_analyses 表：SQLite 不能 DROP CHECK，动作/视角的 CHECK 要放宽只能重建。
 * 新库由 SCHEMA 直接建出最新结构；旧库在这里一次性搬数据，列缺失的用 NULL 补。
 */
const MOTION_ANALYSIS_COPY_COLUMNS = [
  'id', 'client_id', 'user_id', 'date', 'action', 'exercise_name', 'view', 'status',
  'low_confidence_reasons', 'findings', 'metrics', 'rep_count', 'gait_cycles', 'usable_ratio', 'evidence',
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
          evidence TEXT,
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
export function migrateMotionActionCheck(db) {
  const tableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'motion_analyses'").get()?.sql ?? ''
  if (!/CHECK\s*\(\s*action\s+IN/i.test(tableSql)) return
  rebuildMotionAnalysesTable(db)
}

/**
 * 旧库的 motion_analyses.view 只允许 side/front，V2 的斜侧（oblique）记录会被 CHECK 拒绝。
 * 幂等：view CHECK 已含 oblique（新库直接建出）时跳过。
 */
export function migrateMotionViewCheck(db) {
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

export function dropUnusedTablesOnce(db) {
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

export function migrateProfileDisciplines(db) {
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
export function backfillDisciplines(db) {
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
export function migrateRemoveMode(db) {
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

