"use client"

import { useEffect, useState } from "react"
import { LOCAL_RELOAD, notifyLocalChanged } from "@/lib/customer-local-data"
import type { Product, RecentlyViewedItem } from "@/lib/types"
import {
  MAX_RECENTLY_VIEWED,
  RECENTLY_VIEWED_KEY,
  readRecentlyViewed,
  toRecentlyViewedItem,
} from "@/lib/recently-viewed"

/**
 * يسجّل المنتج ضمن «المعروضة مؤخرًا» عند فتح صفحة تفاصيله فقط.
 * يُستدعى داخل ProductDetail. لا يُستخدم في القوائم أو البطاقات.
 *
 * السلوك:
 * - ينفَّذ داخل useEffect على العميل فقط (لا يعمل أثناء SSR).
 * - ينقل المنتج إلى بداية القائمة ويزيل أي تكرار سابق.
 * - يحتفظ بآخر 20 منتجًا فقط.
 * - لا يكتب إلى localStorage إذا كان المنتج أول عنصر بالفعل (القائمة لم تتغير)،
 *   وهذا أيضًا يمنع الكتابة المكررة الناتجة عن React Strict Mode.
 */
export function useRecordRecentlyViewed(product: Product | null | undefined) {
  const productId = product?.id

  useEffect(() => {
    if (!product || !productId) return
    try {
      const current = readRecentlyViewed()
      // المنتج بالفعل في المقدمة => لا تغيير، لا كتابة (يمنع تكرار Strict Mode)
      if (current[0]?.id === productId) return

      const withoutCurrent = current.filter((item) => item.id !== productId)
      const next = [toRecentlyViewedItem(product), ...withoutCurrent].slice(0, MAX_RECENTLY_VIEWED)

      window.localStorage.setItem(RECENTLY_VIEWED_KEY, JSON.stringify(next))
      notifyLocalChanged()
    } catch {
      // بيانات تخزين تالفة أو تخزين غير متاح — نتجاهل بأمان
    }
    // نعتمد على المعرّف فقط حتى لا تتكرر الكتابة عند إعادة التصيير
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId])
}

/**
 * يقرأ قائمة «المعروضة مؤخرًا» للعرض في صفحتها.
 * يُرجع hydrated لتجنّب وميض الحالة الفارغة قبل قراءة localStorage.
 */
export function useRecentlyViewed(): {
  items: RecentlyViewedItem[]
  hydrated: boolean
} {
  const [items, setItems] = useState<RecentlyViewedItem[]>([])
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    setItems(readRecentlyViewed())
    setHydrated(true)
    const reload = () => setItems(readRecentlyViewed())
    window.addEventListener(LOCAL_RELOAD, reload)
    return () => window.removeEventListener(LOCAL_RELOAD, reload)
  }, [])

  return { items, hydrated }
}
