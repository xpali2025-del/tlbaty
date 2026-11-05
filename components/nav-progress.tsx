"use client"

import { useEffect, useRef, useState } from "react"
import { usePathname } from "next/navigation"

/**
 * شريط تقدّم رفيع أعلى الشاشة أثناء انتقال لم تجهز صفحته بعد (صفحة ديناميكية أو غير مجلوبة مسبقاً).
 * الصفحة الحالية تبقى ظاهرة كما هي حتى تصل الجديدة (لا هيكل انتظار ولا شاشة بيضاء)، والشريط وحده يدلّ على أن النقرة وصلت.
 * لا يظهر إن وصلت الصفحة خلال 120ms (الجلب المسبق).
 */
export function NavProgress() {
  const pathname = usePathname()
  const [state, setState] = useState<"idle" | "running" | "done">("idle")
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const guard = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const pending = useRef(false)

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const anchor = (event.target as Element | null)?.closest?.("a")
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return
      const url = new URL(anchor.href, window.location.href)
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return
      pending.current = true
      clearTimeout(timer.current)
      clearTimeout(guard.current)
      timer.current = setTimeout(() => pending.current && setState("running"), 120)
      guard.current = setTimeout(() => { pending.current = false; setState("idle") }, 10_000) // لا يبقى معلّقاً إن فشل الانتقال
    }
    document.addEventListener("click", onClick, true)
    return () => {
      document.removeEventListener("click", onClick, true)
      clearTimeout(timer.current)
      clearTimeout(guard.current)
    }
  }, [])

  // وصلت الصفحة الجديدة
  useEffect(() => {
    if (!pending.current) return
    pending.current = false
    clearTimeout(timer.current)
    clearTimeout(guard.current)
    setState((s) => (s === "running" ? "done" : "idle"))
    const t = setTimeout(() => setState("idle"), 250)
    return () => clearTimeout(t)
  }, [pathname])

  if (state === "idle") return null
  return (
    <div
      aria-hidden="true"
      data-testid="nav-progress"
      className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-[3px]"
    >
      <div
        className="h-full bg-primary"
        style={{
          width: state === "done" ? "100%" : "80%",
          opacity: state === "done" ? 0 : 1,
          // ينمو من الصفر إلى 80% بحركة CSS (nav-progress في globals.css)، وعند الوصول يكتمل ويختفي
          animation: state === "running" ? "nav-progress 2.5s cubic-bezier(0.1, 0.8, 0.2, 1)" : undefined,
          transition: state === "done" ? "width 120ms ease-out, opacity 200ms 120ms" : undefined,
        }}
      />
    </div>
  )
}
