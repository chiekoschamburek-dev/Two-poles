// 动作分析的关键帧截图：只存本机 IndexedDB，不同步、不进导出。
const DB_NAME = 'twopoles_analysis_keyframes'
const STORE_NAME = 'keyframes'
const DB_VERSION = 1

function hasIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined'
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!hasIndexedDb()) {
      reject(new Error('当前环境不支持 IndexedDB'))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error || new Error('无法打开本机关键帧库'))
  })
}

function run<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode)
    let result: T
    const req = fn(tx.objectStore(STORE_NAME))
    req.onsuccess = () => { result = req.result }
    req.onerror = () => reject(req.error || new Error('本机关键帧操作失败'))
    tx.oncomplete = () => resolve(result)
    tx.onabort = () => reject(tx.error || new Error('本机关键帧操作被中止'))
  })
}

export async function saveAnalysisKeyframe(keyframeRef: string, blob: Blob): Promise<void> {
  if (!hasIndexedDb()) return
  const db = await openDb()
  try {
    await run(db, 'readwrite', store => store.put(blob, keyframeRef))
  } finally {
    db.close()
  }
}

export async function getAnalysisKeyframe(keyframeRef: string | undefined): Promise<Blob | null> {
  if (!keyframeRef || !hasIndexedDb()) return null
  const db = await openDb()
  try {
    const value = await run<unknown>(db, 'readonly', store => store.get(keyframeRef))
    return value instanceof Blob ? value : null
  } finally {
    db.close()
  }
}

export async function deleteAnalysisKeyframes(refs: string[]): Promise<void> {
  if (!refs.length || !hasIndexedDb()) return
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      for (const ref of refs) store.delete(ref)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error || new Error('删除本机关键帧失败'))
      tx.onabort = () => reject(tx.error || new Error('删除本机关键帧被中止'))
    })
  } finally {
    db.close()
  }
}

export async function clearAnalysisKeyframes(): Promise<void> {
  if (!hasIndexedDb()) return
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).clear()
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error || new Error('清空本机关键帧失败'))
      tx.onabort = () => reject(tx.error || new Error('清空本机关键帧被中止'))
    })
  } finally {
    db.close()
  }
}
