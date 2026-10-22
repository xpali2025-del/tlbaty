"use client"

import { useCallback, useEffect, useState } from "react"

const CHANGE_EVENT = "tajline:urlchange"

/**
 * قيمة بارامتر في الرابط بدل useSearchParams.
 * useSearchParams في صفحة ثابتة يجبر Next على ترك HTML الخادم فارغاً (Suspense fallback) ثم رسم المنتجات
 * بعد تحميل JS كاملاً: LCP متأخر وقفزة تخطيط في الفوتر. هنا الرسم الأول على الخادم كامل (القيمة null)،
 * ثم تُقرأ القيمة من الرابط بعد التحميل، ويُحدَّث الرابط بـ replaceState دون جولة خادم.
 */
export function useUrlParam(name: string): [string | null, (next: string | null) => void] {
  const [value, setValue] = useState<string | null>(null)

  useEffect(() => {
    const read = () => setValue(new URLSearchParams(window.location.search).get(name))
    read()
    window.addEventListener("popstate", read)
    window.addEventListener(CHANGE_EVENT, read)
    return () => {
      window.removeEventListener("popstate", read)
      window.removeEventListener(CHANGE_EVENT, read)
    }
  }, [name])

  const set = useCallback(
    (next: string | null) => {
      const params = new URLSearchParams(window.location.search)
      if (next === null) params.delete(name)
      else params.set(name, next)
      const qs = params.toString()
      window.history.replaceState(window.history.state, "", qs ? `${window.location.pathname}?${qs}` : window.location.pathname)
      window.dispatchEvent(new Event(CHANGE_EVENT))
    },
    [name],
  )

  return [value, set]
}
