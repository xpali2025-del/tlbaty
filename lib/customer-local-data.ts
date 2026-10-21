// طبقة التخزين المحلي لبيانات العميل (localStorage) + أحداث التنسيق بينها وبين المزامنة.
// المزودات (السلة، الرغبات، العناوين، المشاهَدات) تكتب/تقرأ مفاتيحها كما كانت، وتُعلِم المزامنة عبر الأحداث.

import { EMPTY_CUSTOMER_DATA, type CustomerData, type SyncMeta } from "@/lib/customer-data"

export const LOCAL_KEYS = {
  cart: "taraf_cart",
  wishlist: "taraf_wishlist",
  addresses: "tagelin_saved_addresses",
  recentlyViewed: "taraf_recently_viewed",
} as const

const META_KEY = "tajline_sync_meta"

/** غُيّر شيء محلياً (تُطلقه المزودات بعد الكتابة). */
export const LOCAL_CHANGED = "tajline:local-changed"
/** المزامنة غيّرت التخزين المحلي: على المزودات إعادة القراءة. */
export const LOCAL_RELOAD = "tajline:local-reload"
/** سجّل العميل دخوله دون تحميل صفحة جديدة (نافذة الدخول في الدفع). */
export const LOGGED_IN = "tajline:logged-in"

const isBrowser = () => typeof window !== "undefined"

function readList(key: string): Record<string, unknown>[] {
  if (!isBrowser()) return []
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(key) ?? "[]")
    return Array.isArray(parsed) ? parsed.filter((x): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x)) : []
  } catch {
    return []
  }
}

export function readLocalData(): CustomerData {
  return {
    cart: readList(LOCAL_KEYS.cart),
    wishlist: readList(LOCAL_KEYS.wishlist),
    addresses: readList(LOCAL_KEYS.addresses),
    recentlyViewed: readList(LOCAL_KEYS.recentlyViewed),
  }
}

export function writeLocalData(data: CustomerData): void {
  if (!isBrowser()) return
  try {
    for (const k of Object.keys(LOCAL_KEYS) as (keyof typeof LOCAL_KEYS)[]) {
      window.localStorage.setItem(LOCAL_KEYS[k], JSON.stringify(data[k]))
    }
  } catch {
    // مساحة التخزين ممتلئة أو محظورة: نترك ما هو موجود.
  }
}

export function notifyLocalChanged(): void {
  if (isBrowser()) window.dispatchEvent(new Event(LOCAL_CHANGED))
}
export function notifyLocalReload(): void {
  if (isBrowser()) window.dispatchEvent(new Event(LOCAL_RELOAD))
}
export function notifyLoggedIn(): void {
  if (isBrowser()) window.dispatchEvent(new Event(LOGGED_IN))
}

export function readMeta(): SyncMeta | null {
  if (!isBrowser()) return null
  try {
    const m: unknown = JSON.parse(window.localStorage.getItem(META_KEY) ?? "null")
    const o = m as Record<string, unknown> | null
    return o && typeof o.customerId === "string" && typeof o.syncedAt === "string" && typeof o.hash === "string"
      ? { customerId: o.customerId, syncedAt: o.syncedAt, hash: o.hash }
      : null
  } catch {
    return null
  }
}

export function writeMeta(meta: SyncMeta): void {
  if (!isBrowser()) return
  try {
    window.localStorage.setItem(META_KEY, JSON.stringify(meta))
  } catch {
    // لا شيء
  }
}

/** يمسح بيانات العميل من هذا الجهاز (عند الخروج) فلا يراها المستخدم التالي على جهاز مشترك. */
export function clearLocalData(): void {
  if (!isBrowser()) return
  try {
    for (const key of Object.values(LOCAL_KEYS)) window.localStorage.removeItem(key)
    window.localStorage.removeItem(META_KEY)
  } catch {
    // لا شيء
  }
  notifyLocalReload()
}

export { EMPTY_CUSTOMER_DATA }
