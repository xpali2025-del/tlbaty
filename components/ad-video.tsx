"use client"

import Link from "next/link"
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { Pause, Play } from "lucide-react"

/**
 * فيديو إعلان صامت يعمل تلقائياً كصورة متحركة. القواعد:
 * - لا يُحمَّل ولا يعمل إلا عند اقترابه من الشاشة، ويتوقف عند خروجه منها.
 * - فيديو واحد فقط يعمل في كل لحظة (الأقرب لبدء التشغيل يوقف سابقه).
 * - مع «تقليل الحركة» أو «توفير البيانات» تبقى صورة الغلاف فقط مع زر تشغيل يدوي.
 * - زر الإيقاف/التشغيل أخ للرابط (لا داخله) فلا يفتح الإعلان عند الضغط عليه.
 */

// المشغّل الحالي: عند بدء فيديو جديد نوقف الذي قبله.
let current: { id: number; pause: () => void } | null = null
let nextId = 0

function claim(id: number, pause: () => void) {
  if (current && current.id !== id) current.pause()
  current = { id, pause }
}

// الفيديوهات الظاهرة فعلاً (≥40%) ودوال استئنافها: إذا أوقف فيديو آخر هذا الفيديو ثم غادر الأخير، نستأنف الظاهر.
const inView = new Map<number, () => void>()

function release(id: number) {
  if (current?.id === id) current = null
}

function resumeNext() {
  if (current) return
  const next = inView.values().next()
  if (!next.done) next.value()
}

function prefersLightMode(): boolean {
  if (typeof window === "undefined") return false
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return true
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
  return Boolean(connection?.saveData)
}

export function AdVideo({
  src,
  title,
  href,
  poster,
  className,
}: {
  src: string
  title: string
  href?: string
  /** صورة الغلاف (تُعرض قبل التشغيل وخلف الفيديو دائماً) */
  poster: ReactNode
  className?: string
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const idRef = useRef(-1)
  const visibleRef = useRef(false)
  // «يعمل» = المستخدم/النظام يريد التشغيل. الإيقاف اليدوي يبقى حتى يضغط المستخدم تشغيل.
  const [playing, setPlaying] = useState(false)
  const [armed, setArmed] = useState(false)
  const userPausedRef = useRef(false)
  const manualOnlyRef = useRef(false)

  const getId = useCallback(() => {
    if (idRef.current < 0) idRef.current = nextId++
    return idRef.current
  }, [])

  const pause = useCallback(() => {
    videoRef.current?.pause()
  }, [])

  const tryPlay = useCallback(() => {
    const video = videoRef.current
    if (!video || !visibleRef.current || userPausedRef.current || manualOnlyRef.current) return
    claim(getId(), pause)
    video.play().catch(() => setPlaying(false))
  }, [pause, getId])

  useEffect(() => {
    manualOnlyRef.current = prefersLightMode()
    const video = videoRef.current
    const root = video?.parentElement
    if (!video || !root || typeof IntersectionObserver === "undefined") return
    const observer = new IntersectionObserver(
      (entries) => {
        // قد تصل عدة سجلات دفعة واحدة؛ الأخير هو الحالة الحالية.
        const entry = entries[entries.length - 1]
        visibleRef.current = entry.isIntersecting
        const id = getId()
        if (entry.isIntersecting) {
          // نحمّل المصدر قبل الوصول إليه بقليل؛ التشغيل عند الظهور فعلاً.
          setArmed(true)
          if (entry.intersectionRatio >= 0.4) {
            inView.set(id, tryPlay)
            tryPlay()
          } else inView.delete(id)
        } else {
          inView.delete(id)
          video.pause()
          release(id)
          resumeNext()
        }
      },
      { rootMargin: "200px 0px", threshold: [0, 0.4] },
    )
    observer.observe(root)
    return () => {
      observer.disconnect()
      inView.delete(idRef.current)
      release(idRef.current)
      resumeNext()
    }
  }, [tryPlay, getId])

  // بعد إرفاق المصدر (armed) نحاول التشغيل فوراً (preload=none لا يحمّل قبل play()) ثم عند جاهزية البيانات.
  useEffect(() => {
    if (!armed) return
    const video = videoRef.current
    if (!video) return
    tryPlay()
    video.addEventListener("canplay", tryPlay)
    return () => video.removeEventListener("canplay", tryPlay)
  }, [armed, tryPlay])

  const toggle = () => {
    const next = !playing
    userPausedRef.current = !next
    if (next) {
      manualOnlyRef.current = false
      setArmed(true)
      visibleRef.current = true
      tryPlay()
    } else {
      pause()
    }
  }

  const frame = (
    <div className="relative w-full overflow-hidden rounded-2xl border border-border bg-secondary shadow-sm">
      <span className="absolute right-3 top-3 z-10 rounded-full bg-background/80 px-2.5 py-1 text-[11px] font-medium text-muted-foreground backdrop-blur">
        إعلان
      </span>
      <div className="relative aspect-[2/1] w-full sm:aspect-[5/2] lg:aspect-[851/315]">
        {poster}
        <video
          ref={videoRef}
          src={armed ? src : undefined}
          muted
          loop
          playsInline
          preload="none"
          aria-hidden="true"
          tabIndex={-1}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-200 ${playing ? "opacity-100" : "opacity-0"}`}
        />
      </div>
    </div>
  )

  return (
    <div className={`relative col-span-full ${className ?? ""}`}>
      {href ? (
        <Link prefetch={false} href={href} aria-label={title} className="block rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-primary">
          {frame}
        </Link>
      ) : (
        <div role="complementary" aria-label={title}>
          {frame}
        </div>
      )}
      {/* منطقة لمس ≥44px والأيقونة الظاهرة أصغر */}
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? "إيقاف الفيديو مؤقتاً" : "تشغيل الفيديو"}
        className="absolute bottom-0 left-0 z-20 flex h-11 w-11 items-center justify-center"
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-background/80 text-foreground shadow backdrop-blur">
          {playing ? <Pause className="h-4 w-4" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}
        </span>
      </button>
    </div>
  )
}
