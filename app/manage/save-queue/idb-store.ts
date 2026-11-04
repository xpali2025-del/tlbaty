import type { JobStore, SaveJob } from "./core"

// تخزين عمليات الحفظ في IndexedDB: يحفظ الملفات (File) أيضاً، فتكتمل العملية بعد تحديث الصفحة أو انقطاع الإنترنت.
// أي فشل في التخزين (وضع التصفح الخاص، مساحة ممتلئة) لا يعطّل الحفظ: يعمل الطابور في الذاكرة فقط.

const DB_NAME = "tajline-save-queue"
const STORE = "jobs"

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode)
        const request = work(tx.objectStore(STORE))
        tx.oncomplete = () => {
          db.close()
          resolve(request.result)
        }
        tx.onerror = tx.onabort = () => {
          db.close()
          reject(tx.error)
        }
      }),
  )
}

export class IndexedDbJobStore implements JobStore {
  async load(): Promise<SaveJob[]> {
    try {
      return (await run("readonly", (s) => s.getAll())) as SaveJob[]
    } catch {
      return []
    }
  }

  async put(job: SaveJob): Promise<void> {
    try {
      await run("readwrite", (s) => s.put(job))
    } catch {
      // التخزين الدائم غير متاح: تبقى العملية في الذاكرة
    }
  }

  async remove(id: string): Promise<void> {
    try {
      await run("readwrite", (s) => s.delete(id))
    } catch {
      // نفسه
    }
  }
}
