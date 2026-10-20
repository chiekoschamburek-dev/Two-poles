// 饮食照片原图的本地存储：localStorage 只放 256px 缩略图，原图放 IndexedDB。
// 照片不进入 JSON/CSV 导出；删除记录、清除全部数据时一起删除。
const DB_NAME = 'twopoles_meal_photos'
const STORE_NAME = 'photos'
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
    req.onerror = () => reject(req.error || new Error('无法打开本机照片库'))
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
    req.onerror = () => reject(req.error || new Error('本机照片操作失败'))
    tx.oncomplete = () => resolve(result)
    tx.onabort = () => reject(tx.error || new Error('本机照片操作被中止'))
  })
}

export async function saveMealPhoto(photoId: string, blob: Blob): Promise<void> {
  if (!hasIndexedDb()) return
  const db = await openDb()
  try {
    await run(db, 'readwrite', store => store.put(blob, photoId))
  } finally {
    db.close()
  }
}

export async function getMealPhoto(photoId: string | undefined): Promise<Blob | null> {
  if (!photoId || !hasIndexedDb()) return null
  const db = await openDb()
  try {
    const value = await run<unknown>(db, 'readonly', store => store.get(photoId))
    return value instanceof Blob ? value : null
  } finally {
    db.close()
  }
}

export async function deleteMealPhoto(photoId: string | undefined): Promise<void> {
  if (!photoId || !hasIndexedDb()) return
  const db = await openDb()
  try {
    await run(db, 'readwrite', store => store.delete(photoId))
  } finally {
    db.close()
  }
}

export async function clearMealPhotos(): Promise<void> {
  if (!hasIndexedDb()) return
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).clear()
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error || new Error('清空本机照片失败'))
      tx.onabort = () => reject(tx.error || new Error('清空本机照片被中止'))
    })
  } finally {
    db.close()
  }
}
