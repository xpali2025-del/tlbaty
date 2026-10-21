"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { Bell, BellOff, CheckCheck, ChevronLeft, Loader2, RefreshCw, Star } from "lucide-react"

import { SafeImage } from "@/components/safe-image"
import { useNotifications } from "@/components/notifications-provider"
import type { PublicNotification } from "@/sanity/notifications/types"

// ============================================
// شاشة الإشعارات للعملاء
//
// - الإشعارات الأولى تأتي من الخادم (SSR) فتظهر فوراً بلا وميض.
// - «عرض المزيد» يجلب الصفحة التالية من API خفيف.
// - علامة «جديد» وحالة القراءة تُحسبان من localStorage بعد التحميل فقط،
//   لذلك لا يحدث أي اختلاف بين HTML الخادم والمتصفح (بلا Hydration Error).
// ============================================

type Props = {
  initialItems: PublicNotification[]
  initialHasMore: boolean
  total: number
}

/** تنسيق وقت وتاريخ النشر بالعربية. */
function formatPublishedAt(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ""
  try {
    return new Intl.DateTimeFormat("ar-YE", {
      dateStyle: "medium",
      timeStyle: "short",
      numberingSystem: "latn",
    }).format(date)
  } catch {
    return date.toLocaleString("ar")
  }
}

export function NotificationsClient({ initialItems, initialHasMore, total }: Props) {
  const { isRead, markAsRead, markAllAsRead, hydrated, unreadCount } = useNotifications()

  const [items, setItems] = useState<PublicNotification[]>(initialItems)
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(initialHasMore)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadError, setLoadError] = useState(false)

  // مزامنة العناصر عند إعادة تحقق الخادم (بعد نشر إشعار جديد مثلاً).
  useEffect(() => {
    setItems(initialItems)
    setHasMore(initialHasMore)
    setPage(0)
  }, [initialItems, initialHasMore])

  const loadMore = useCallback(async () => {
    setLoadingMore(true)
    setLoadError(false)
    try {
      const next = page + 1
      const res = await fetch(`/api/notifications?page=${next}`)
      if (!res.ok) throw new Error("load_failed")
      const data = (await res.json()) as { items: PublicNotification[]; hasMore: boolean }
      // نمنع التكرار في حال تغيّر الترتيب بين الطلبين.
      setItems((prev) => {
        const seen = new Set(prev.map((item) => item._id))
        return [...prev, ...data.items.filter((item) => !seen.has(item._id))]
      })
      setHasMore(Boolean(data.hasMore))
      setPage(next)
    } catch {
      setLoadError(true)
    } finally {
      setLoadingMore(false)
    }
  }, [page])

  // حالة عدم وجود إشعارات
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border py-16 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
          <BellOff className="h-7 w-7 text-muted-foreground" aria-hidden="true" />
        </span>
        <p className="text-base font-bold">لا توجد إشعارات حالياً</p>
        <p className="max-w-xs text-sm text-muted-foreground">
          سنعرض هنا كل الأخبار والعروض الجديدة عند إضافتها.
        </p>
        <Link
          href="/"
          className="mt-2 flex min-h-11 items-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground"
        >
          العودة للتسوق
        </Link>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* شريط الحالة + تحديد الكل كمقروء */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {/* قبل الـ Hydration نعرض الإجمالي فقط لتفادي اختلاف HTML */}
          {hydrated && unreadCount > 0 ? (
            <>
              لديك <span className="font-bold text-foreground">{unreadCount}</span> إشعار غير مقروء
              من أصل {total}
            </>
          ) : (
            <>إجمالي الإشعارات: {total}</>
          )}
        </p>

        {hydrated && unreadCount > 0 && (
          <button
            type="button"
            onClick={markAllAsRead}
            className="flex min-h-11 items-center gap-1.5 rounded-xl border border-border px-3 text-xs font-bold transition-colors hover:border-primary/50 hover:bg-accent"
          >
            <CheckCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
            تحديد الكل كمقروء
          </button>
        )}
      </div>

      {/* قائمة الإشعارات */}
      <ul className="flex flex-col gap-3">
        {items.map((item) => {
          // قبل الـ Hydration نعتبر الكل مقروءاً فلا تظهر «جديد» على الخادم.
          const unread = hydrated && !isRead(item._id)

          return (
            <li
              key={item._id}
              className={`overflow-hidden rounded-2xl border transition-colors ${
                unread ? "border-primary/60 bg-primary/5" : "border-border bg-card"
              }`}
            >
              <article className="flex flex-col gap-3 p-3 sm:flex-row sm:p-4">
                {/* صورة الإشعار — محسّنة ومتجاوبة */}
                {item.imageUrl && (
                  <div className="relative aspect-[16/9] w-full shrink-0 overflow-hidden rounded-xl bg-muted sm:aspect-square sm:w-28">
                    <SafeImage
                      src={item.imageUrl}
                      alt={item.title}
                      fill
                      sizes="(max-width: 640px) 100vw, 112px"
                      className="object-cover"
                    />
                  </div>
                )}

                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  {/* العنوان + العلامات */}
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="min-w-0 break-words text-sm font-bold leading-snug sm:text-base">
                      {item.title}
                    </h2>
                    {unread && (
                      <span className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold text-primary-foreground">
                        جديد
                      </span>
                    )}
                    {item.priority === "important" && (
                      <span className="flex shrink-0 items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-600 dark:text-amber-400">
                        <Star className="h-3 w-3" aria-hidden="true" />
                        مهم
                      </span>
                    )}
                  </div>

                  {/* النص — يُعرض كنص آمن مع الحفاظ على فواصل الأسطر */}
                  <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground">
                    {item.body}
                  </p>

                  <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                    <time
                      dateTime={item.publishedAt}
                      className="text-xs text-muted-foreground"
                    >
                      {formatPublishedAt(item.publishedAt)}
                    </time>

                    <div className="flex items-center gap-2">
                      {unread && (
                        <button
                          type="button"
                          onClick={() => markAsRead(item._id)}
                          className="flex min-h-11 items-center rounded-xl px-2 text-xs font-bold text-muted-foreground transition-colors hover:text-foreground"
                        >
                          تعليم كمقروء
                        </button>
                      )}

                      {/* رابط داخلي متحقق منه على الخادم فقط */}
                      {item.link && (
                        <Link
                          href={item.link}
                          onClick={() => markAsRead(item._id)}
                          className="flex min-h-11 items-center gap-1 rounded-xl bg-primary px-3 text-xs font-bold text-primary-foreground transition-opacity hover:opacity-90"
                        >
                          عرض التفاصيل
                          <ChevronLeft className="h-4 w-4 shrink-0" aria-hidden="true" />
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              </article>
            </li>
          )
        })}
      </ul>

      {/* عرض المزيد */}
      {hasMore && (
        <div className="flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={loadMore}
            disabled={loadingMore}
            className="flex min-h-11 items-center gap-2 rounded-xl border border-border px-5 text-sm font-bold transition-colors hover:border-primary/50 hover:bg-accent disabled:opacity-60"
          >
            {loadingMore ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                جارٍ التحميل...
              </>
            ) : (
              <>
                <Bell className="h-4 w-4" aria-hidden="true" />
                عرض المزيد
              </>
            )}
          </button>

          {loadError && (
            <p className="flex items-center gap-1.5 text-xs text-destructive">
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              تعذّر تحميل المزيد، حاول مرة أخرى.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
