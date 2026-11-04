"use client"

import { useEffect, useSyncExternalStore } from "react"
import type { AdminProduct } from "@/lib/admin"
import { MemoryJobStore, SaveQueue, type SaveJob } from "./core"
import { isTransientSaveError } from "./errors"
import { IndexedDbJobStore } from "./idb-store"
import { PRODUCT_SCREEN, productExecutor, releaseProductJob } from "./product-job"

// طابور الحفظ الوحيد للوحة في هذا المتصفح. وحدة واحدة لعمر الصفحة: تبقى عملياته شغّالة حين يبدّل المدير الشاشة.

let queue: SaveQueue | null = null
// من يستلم المنتج المحفوظ ليدرجه في قائمة اللوحة (تضبطه اللوحة حين تُعرض).
let productSaved: (item: AdminProduct) => void = () => {}

export function getSaveQueue(): SaveQueue {
  if (!queue) {
    const store = typeof indexedDB !== "undefined" ? new IndexedDbJobStore() : new MemoryJobStore()
    queue = new SaveQueue({
      store,
      executors: { [PRODUCT_SCREEN]: productExecutor((item) => productSaved(item)) as never },
      isTransient: isTransientSaveError,
    })
    if (typeof window !== "undefined") window.addEventListener("online", () => queue?.online())
  }
  return queue
}

export function setProductSavedHandler(handler: (item: AdminProduct) => void) {
  productSaved = handler
}

/** إلغاء عملية: يحرّر معاينتها ويحذفها من الطابور. */
export function discardJob(job: SaveJob) {
  getSaveQueue().remove(job.id)
  if (job.screen === PRODUCT_SCREEN) releaseProductJob(job.id)
}

const EMPTY: readonly SaveJob[] = []

/** عمليات الحفظ القائمة (كل الشاشات، أو شاشة بعينها). */
export function useSaveJobs(screen?: string): readonly SaveJob[] {
  const q = typeof window === "undefined" ? null : getSaveQueue()
  const jobs = useSyncExternalStore(q?.subscribe ?? (() => () => {}), q?.getSnapshot ?? (() => EMPTY), () => EMPTY)
  return screen ? jobs.filter((j) => j.screen === screen) : jobs
}

/** يستأنف عمليات جلسة سابقة (بعد تحديث الصفحة)، ويحذّر المتصفح من إغلاق الصفحة وفيها عمليات لم تنته. */
export function useSaveQueueLifecycle() {
  const jobs = useSaveJobs()
  useEffect(() => {
    void getSaveQueue().resume()
  }, [])
  const unfinished = jobs.some((j) => j.state !== "conflict" && !(j.state === "failed" && !j.offline))
  useEffect(() => {
    if (!unfinished) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [unfinished])
}
