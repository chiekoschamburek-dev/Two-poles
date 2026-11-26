import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { SCHEMA } from './schema.mjs'
import {
  migrateRemoveMode, migrateProfileDisciplines, backfillDisciplines,
  migrateMotionActionCheck, migrateMotionViewCheck, dropUnusedTablesOnce
} from './migrations.mjs'

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
  // 六层证据 JSON（V2）：老库补列，新库由 SCHEMA 直接建出
  const hasEvidence = () => db.prepare('PRAGMA table_info(motion_analyses)').all().some(column => column.name === 'evidence')
  if (!hasEvidence()) {
    transaction(db, () => {
      if (!hasEvidence()) db.exec('ALTER TABLE motion_analyses ADD COLUMN evidence TEXT')
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

import { transaction, nowIso, jsonParse } from './tx.mjs'

export { transaction, nowIso, jsonParse }
