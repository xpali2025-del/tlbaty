"use client"

import { useEffect, useSyncExternalStore } from "react"
import type { AdminProduct } from "@/lib/admin"
import { MemoryJobStore, SaveQueue, type SaveJob } from "./core"
import { isTransientSaveError } from "./errors"
import { IndexedDbJobStore } from "./idb-store"
import { releaseLive } from "./job-runtime"
import { PRODUCT_SCREEN, productExecutor } from "./product-job"
import { SCREEN_SPECS, screenExecutor, type ScreenSpec } from "./screens"

// طابور الحفظ الوحيد للوحة في هذا المتصفح. وحدة واحدة لعمر الصفحة: تبقى عملياته شغّالة حين يبدّل المدير الشاشة.

let queue: SaveQueue | null = null
// من يستلم المنتج المحفوظ ليدرجه في قائمة اللوحة (تضبطه اللوحة حين تُعرض).
let productSaved: (item: AdminProduct) => void = () => {}

export function getSaveQueue(): SaveQueue {
  if (!queue) {
    const store = typeof indexedDB !== "undefined" ? new IndexedDbJobStore() : new MemoryJobStore()
    queue = new SaveQueue({
      store,
      executors: {
        [PRODUCT_SCREEN]: productExecutor((item) => productSaved(item)) as never,
        ...Object.fromEntries(Object.values(SCREEN_SPECS).map((spec) => [spec.screen, screenExecutor(spec as unknown as ScreenSpec<{ _id: string }>)])),
      },
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
  releaseLive(job.id)
}

/** وصلت بيانات جديدة لشاشة من الخادم: تزول عملياتها المحفوظة بعد لحظة (تزيد اللوحة ذلك عند كل إعادة تحميل). */
export function notifyScreenData(screen: string) {
  getSaveQueue().notifyData(screen)
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
  const unfinished = jobs.some((j) => j.state !== "conflict" && j.state !== "saved" && !(j.state === "failed" && !j.offline))
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

export type InstantRow<T> = { item: T; job?: SaveJob<T> }

/**
 * قائمة شاشة بحفظ فوري = عناصر الخادم، وفوقها ما يُحفظ الآن: المعدَّل يظهر بتعديله، والجديد في أول القائمة، وعلى كلٍّ عملية تصف حالته.
 * `isSame` يطابق عنصراً من الخادم بعملية محفوظة انتهت وبقي عرضها (مثلاً: لا يظهر الجديد مرتين لحظة وصول بيانات الخادم).
 */
export function useInstantRows<T extends { _id: string }>(screen: string, items: readonly T[]): InstantRow<T>[] {
  const jobs = useSaveJobs(screen) as readonly SaveJob<T>[]
  const latest = new Map<string, SaveJob<T>>()
  for (const job of jobs) latest.set(job.entityId, job)
  const known = new Set(items.map((i) => i._id))
  const fresh = [...latest.values()].filter((j) => !known.has(j.entityId)).reverse().map((job) => ({ item: job.optimistic, job }))
  return [...fresh, ...items.map((item) => ({ item: latest.get(item._id)?.optimistic ?? item, job: latest.get(item._id) }))]
}
