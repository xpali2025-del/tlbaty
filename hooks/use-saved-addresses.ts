"use client"

import { useCallback, useEffect, useState } from "react"

// ============================================
// إدارة العناوين المحفوظة للعميل
// التخزين محلي فقط (localStorage) على الجهاز/المتصفح الحالي.
// لا يوجد حساب عميل ولا API عام لاسترجاع العناوين.
// نرسل فقط العنوان المختار مع الطلب الحالي إلى الخادم.
// ============================================

export const SAVED_ADDRESSES_KEY = "tagelin_saved_addresses"

/** تسميات جاهزة للعنوان؛ الحقل اختياري فالعناوين القديمة بلا تسمية تبقى صالحة. */
export const ADDRESS_LABELS = ["المنزل", "العمل", "أخرى"] as const
export const MAX_ADDRESS_LABEL = 30
/** سقف الخادم لعناوين الحساب (lib/customer-data-server.ts) — تجاوزه يرفض المزامنة كلها. */
export const MAX_SAVED_ADDRESSES = 20

export type SavedAddress = {
  id: string
  /** تسمية العنوان (المنزل/العمل/أخرى أو نص حر قصير). */
  label?: string
  customerName: string
  phone: string
  city: string
  address: string
  latitude: number
  longitude: number
  accuracy: number
  locationCapturedAt: string
  createdAt: string
  updatedAt: string
}

// بيانات العنوان دون الحقول التي يولّدها النظام (id/createdAt/updatedAt)
export type SavedAddressInput = Omit<SavedAddress, "id" | "createdAt" | "updatedAt">

/** توليد معرّف فريد آمن مع بديل عند غياب crypto.randomUUID. */
function safeUUID(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID()
    }
  } catch {
    // تجاهل — ننتقل إلى البديل
  }
  return `addr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** إحداثيات صالحة ضمن النطاق الجغرافي المسموح. */
export function isValidCoords(lat: unknown, lng: unknown): boolean {
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180 &&
    // نرفض 0,0 لأنها غالباً قيمة افتراضية غير حقيقية
    !(lat === 0 && lng === 0)
  )
}

/** التحقق من بنية العنوان المحفوظ قبل استخدامه. */
function isValidSavedAddress(value: unknown): value is SavedAddress {
  if (!value || typeof value !== "object") return false
  const a = value as Record<string, unknown>
  return (
    typeof a.id === "string" &&
    typeof a.customerName === "string" &&
    typeof a.phone === "string" &&
    typeof a.city === "string" &&
    typeof a.address === "string" &&
    isValidCoords(a.latitude, a.longitude) &&
    typeof a.accuracy === "number" &&
    typeof a.locationCapturedAt === "string" &&
    typeof a.createdAt === "string" &&
    typeof a.updatedAt === "string"
  )
}

import { LOCAL_RELOAD, notifyLocalChanged } from "@/lib/customer-local-data"

export function useSavedAddresses() {
  const [addresses, setAddresses] = useState<SavedAddress[]>([])
  // hydrated يمنع وميض النموذج الفارغ وأخطاء الترطيب:
  // نبقى فارغين على الخادم وأول رسم للعميل، ثم نقرأ localStorage.
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    const load = (): void => {
      try {
        const raw = window.localStorage.getItem(SAVED_ADDRESSES_KEY)
        const parsed = raw ? JSON.parse(raw) : []
        if (Array.isArray(parsed)) setAddresses(parsed.filter(isValidSavedAddress))
      } catch {
        // تجاهل بيانات تالفة — لا نمسح ما قد يكون موجوداً
      }
    }
    load()
    setHydrated(true)
    // المزامنة (أو تسجيل الخروج) غيّرت التخزين المحلي: نعيد القراءة.
    window.addEventListener(LOCAL_RELOAD, load)
    return () => window.removeEventListener(LOCAL_RELOAD, load)
  }, [])

  // نكتب إلى localStorage فقط عند الإضافة/التعديل/الحذف (لا أثناء الترطيب).
  const commit = useCallback((updater: (prev: SavedAddress[]) => SavedAddress[]) => {
    setAddresses((prev) => {
      const next = updater(prev)
      try {
        window.localStorage.setItem(SAVED_ADDRESSES_KEY, JSON.stringify(next))
        notifyLocalChanged()
      } catch {
        // تجاهل — قد تكون مساحة التخزين ممتلئة أو محظورة
      }
      return next
    })
  }, [])

  const addAddress = useCallback(
    (input: SavedAddressInput): SavedAddress => {
      const now = new Date().toISOString()
      const created: SavedAddress = {
        ...input,
        id: safeUUID(),
        createdAt: now,
        updatedAt: now,
      }
      commit((prev) => [created, ...prev])
      return created
    },
    [commit],
  )

  const updateAddress = useCallback(
    (id: string, input: SavedAddressInput) => {
      const now = new Date().toISOString()
      commit((prev) =>
        prev.map((a) => (a.id === id ? { ...a, ...input, id, createdAt: a.createdAt, updatedAt: now } : a)),
      )
    },
    [commit],
  )

  const removeAddress = useCallback(
    (id: string) => {
      commit((prev) => prev.filter((a) => a.id !== id))
    },
    [commit],
  )

  return { addresses, hydrated, addAddress, updateAddress, removeAddress }
}
