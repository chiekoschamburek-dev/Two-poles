import { parentPort, workerData } from 'node:worker_threads'
import { DatabaseSync } from 'node:sqlite'
import { exportPayload } from './app.mjs'

const db = new DatabaseSync(workerData.dbPath, { readOnly: true })
try {
  // 各类数据使用同一个 SQLite 读快照，生成大文件不阻塞 HTTP 线程。
  db.exec('BEGIN')
  const content = exportPayload(db, workerData.userId, workerData.format)
  db.exec('COMMIT')
  parentPort.postMessage(content)
} finally {
  db.close()
}
