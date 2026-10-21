"use client"

import { useEffect } from "react"
import { dataHash, planSync, type CustomerData } from "@/lib/customer-data"
import {
  LOCAL_CHANGED,
  LOGGED_IN,
  notifyLocalReload,
  readLocalData,
  readMeta,
  writeLocalData,
  writeMeta,
} from "@/lib/customer-local-data"

// مزامنة سلة العميل ورغباته وعناوينه ومشاهداته مع حسابه، ليجدها على أي جهاز.
//
// - للمسجّلين فقط؛ الزائر يبقى على المتصفح ولا يلمس الخادم.
// - قراءة واحدة عند فتح الموقع (أو بعد الدخول)، بلا استعلام دوري.
// - الكتابة مؤجّلة ثانيتين بعد آخر تعديل (عشرون نقرة = كتابة واحدة)، وتُرسَل فوراً عند مغادرة الصفحة والخروج.
// - الواجهة تعتمد على localStorage فوراً، فلا ينتظر العميل الخادم في أي نقرة.

const DEBOUNCE_MS = 2000

let flushImpl: (() => Promise<void>) | null = null

/** يُرسل أي تعديلات معلّقة الآن (يُستدعى قبل تسجيل الخروج حتى لا تضيع آخر تعديلات العميل). */
export async function flushCustomerSync(): Promise<void> {
  await flushImpl?.()
}

export function CustomerSync() {
  useEffect(() => {
    let customerId: string | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    let pushing: Promise<void> | null = null

    const push = (data: CustomerData): Promise<void> => {
      pushing = (async () => {
        try {
          const res = await fetch("/api/account/data", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ data }),
            keepalive: true, // يكتمل حتى لو أُغلقت الصفحة
          })
          if (res.status === 401) {
            customerId = null // انتهت الجلسة: نتوقف عن الدفع حتى يسجّل دخوله
            return
          }
          if (!res.ok) return // سنعيد المحاولة عند التعديل التالي
          const body = (await res.json()) as { updatedAt?: string }
          if (customerId) writeMeta({ customerId, syncedAt: body.updatedAt ?? new Date().toISOString(), hash: dataHash(data) })
        } catch {
          // لا اتصال: يبقى المحلي ويُدفَع عند أول تعديل لاحق
        }
      })()
      return pushing
    }

    const flush = async () => {
      if (timer) clearTimeout(timer)
      timer = null
      if (pushing) await pushing
      if (!customerId) return
      const local = readLocalData()
      const meta = readMeta()
      if (meta?.customerId === customerId && dataHash(local) === meta.hash) return
      await push(local)
    }
    flushImpl = flush

    const schedule = () => {
      if (!customerId) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => void flush(), DEBOUNCE_MS)
    }

    const pull = async () => {
      let body: { customerId?: string; data?: CustomerData; updatedAt?: string | null } | null = null
      try {
        const res = await fetch("/api/account/data", { cache: "no-store" })
        if (!res.ok) {
          customerId = null
          return
        }
        body = await res.json()
      } catch {
        return
      }
      if (!body?.customerId || !body.data) return
      customerId = body.customerId
      const local = readLocalData()
      const plan = planSync({ customerId, meta: readMeta(), server: { data: body.data, updatedAt: body.updatedAt ?? null }, local })
      if (plan.action === "apply-server") {
        writeLocalData(plan.data)
        writeMeta({ customerId, syncedAt: body.updatedAt ?? new Date().toISOString(), hash: dataHash(plan.data) })
        notifyLocalReload()
      } else if (plan.action === "merge") {
        writeLocalData(plan.data)
        notifyLocalReload()
        await push(plan.data)
      } else if (plan.action === "push-local") {
        await push(local)
      } else if (!readMeta()) {
        writeMeta({ customerId, syncedAt: body.updatedAt ?? new Date().toISOString(), hash: dataHash(local) })
      }
    }

    void pull()
    const onVisible = () => document.visibilityState === "hidden" && void flush()
    window.addEventListener(LOCAL_CHANGED, schedule)
    window.addEventListener(LOGGED_IN, pull)
    window.addEventListener("pagehide", flush)
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      window.removeEventListener(LOCAL_CHANGED, schedule)
      window.removeEventListener(LOGGED_IN, pull)
      window.removeEventListener("pagehide", flush)
      document.removeEventListener("visibilitychange", onVisible)
      if (timer) clearTimeout(timer)
      flushImpl = null
    }
  }, [])

  return null
}
