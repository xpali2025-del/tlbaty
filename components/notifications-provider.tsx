"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import useSWR from "swr"

import {
  loadReadIds,
  pruneReadIds,
  saveReadIds,
} from "@/lib/notifications-read-state"
import type { NotificationSummaryItem, PublicNotification } from "@/lib/notification-types"

// ============================================
// مزوّد حالة الإشعارات
//
// - يجلب الملخص الخفيف (معرفات فقط) مرة واحدة عند تحميل الواجهة.
// - SWR يعيد استخدام النتيجة عند التنقل بين الصفحات بدل تكرار الاستعلام.
// - لا Polling إطلاقاً: refreshInterval = 0 وبلا إعادة جلب عند التركيز.
// - حالة القراءة تُقرأ من localStorage بعد التحميل فقط (بلا Hydration Error).
// ============================================

type NotificationsContextValue = {
  /** عدد الإشعارات غير المقروءة على هذا الجهاز. */
  unreadCount: number
  /** هل اكتملت قراءة التخزين المحلي؟ قبلها لا نعرض أي عدّاد. */
  hydrated: boolean
  /** هل معرّف الإشعار مقروء؟ */
  isRead: (id: string) => boolean
  /** تعليم إشعار واحد كمقروء (عند فتحه). */
  markAsRead: (id: string) => void
  /** تعليم كل الإشعارات الصالحة الحالية كمقروءة. */
  markAllAsRead: () => void
  /** إعادة جلب الملخص يدوياً (بعد النشر مثلاً). */
  refreshSummary: () => void
  /** إشعارات العميل الشخصية (تذكير السلة/الرغبات مع كود الخصم)، فارغة لغير المسجّل. */
  personal: PublicNotification[]
}

const NotificationsContext = createContext<NotificationsContextValue | undefined>(undefined)

type SummaryResponse = { items: NotificationSummaryItem[] }

async function fetchSummary(url: string): Promise<SummaryResponse> {
  const res = await fetch(url)
  if (!res.ok) throw new Error("summary_failed")
  return (await res.json()) as SummaryResponse
}

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const [readIds, setReadIds] = useState<string[]>([])
  const [hydrated, setHydrated] = useState(false)

  // الملخص الخفيف — طلب واحد يُعاد استخدامه في كل الصفحات.
  const { data, mutate } = useSWR<SummaryResponse>("/api/notifications/summary", fetchSummary, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    refreshInterval: 0,
    // يمنع تكرار الطلب أثناء التنقل خلال خمس دقائق.
    dedupingInterval: 5 * 60 * 1000,
    keepPreviousData: true,
    // فشل الإشعارات لا يجوز أن يعطل الهيدر.
    onError: () => undefined,
    shouldRetryOnError: false,
  })

  // إشعارات العميل الشخصية: طلب خاص بلا كاش مشترك، فارغ لغير المسجّل.
  const { data: personalData, mutate: mutatePersonal } = useSWR<{ items: PublicNotification[] }>(
    "/api/notifications/mine",
    fetchSummary as unknown as (url: string) => Promise<{ items: PublicNotification[] }>,
    { revalidateOnFocus: false, revalidateOnReconnect: false, refreshInterval: 0, dedupingInterval: 5 * 60 * 1000, keepPreviousData: true, onError: () => undefined, shouldRetryOnError: false },
  )
  const personal = useMemo(() => personalData?.items ?? [], [personalData])

  // بعد تسجيل الدخول (من أي نافذة) نجلب إشعارات العميل فوراً.
  useEffect(() => {
    const reload = () => void mutatePersonal()
    window.addEventListener("tajline:logged-in", reload)
    return () => window.removeEventListener("tajline:logged-in", reload)
  }, [mutatePersonal])

  // العدّاد والتعليم كمقروء يشملان العامة والشخصية.
  const summaryItems = useMemo<NotificationSummaryItem[]>(
    () => [...(data?.items ?? []), ...personal.map((p) => ({ _id: p._id, publishedAt: p.publishedAt, priority: p.priority }))],
    [data, personal],
  )

  // قراءة التخزين المحلي بعد التحميل فقط.
  useEffect(() => {
    setReadIds(loadReadIds())
    setHydrated(true)
  }, [])

  // تنظيف دوري: نحذف معرفات الإشعارات التي لم تعد صالحة (محذوفة/منتهية/مؤرشفة).
  useEffect(() => {
    if (!hydrated || summaryItems.length === 0) return
    const validIds = summaryItems.map((item) => item._id)
    setReadIds((prev) => {
      const pruned = pruneReadIds(prev, validIds)
      if (pruned.length === prev.length) return prev
      saveReadIds(pruned)
      return pruned
    })
  }, [hydrated, summaryItems])

  const markAsRead = useCallback((id: string) => {
    if (!id) return
    setReadIds((prev) => {
      if (prev.includes(id)) return prev
      const next = [...prev, id]
      saveReadIds(next)
      return next
    })
  }, [])

  const markAllAsRead = useCallback(() => {
    setReadIds((prev) => {
      const next = Array.from(new Set([...prev, ...summaryItems.map((item) => item._id)]))
      if (next.length === prev.length) return prev
      saveReadIds(next)
      return next
    })
  }, [summaryItems])

  const readSet = useMemo(() => new Set(readIds), [readIds])

  const isRead = useCallback((id: string) => readSet.has(id), [readSet])

  // العدّاد = الإشعارات الصالحة غير الموجودة في قائمة القراءة المحلية.
  // نعرضه صفراً قبل الـ Hydration لتطابق الخادم مع المتصفح.
  const unreadCount = useMemo(() => {
    if (!hydrated) return 0
    return summaryItems.reduce((count, item) => (readSet.has(item._id) ? count : count + 1), 0)
  }, [hydrated, summaryItems, readSet])

  const refreshSummary = useCallback(() => {
    void mutate()
    void mutatePersonal()
  }, [mutate, mutatePersonal])

  const value = useMemo<NotificationsContextValue>(
    () => ({ unreadCount, hydrated, isRead, markAsRead, markAllAsRead, refreshSummary, personal }),
    [unreadCount, hydrated, isRead, markAsRead, markAllAsRead, refreshSummary, personal],
  )

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>
}

/**
 * قراءة حالة الإشعارات. تعيد قيماً محايدة إن لم يوجد المزوّد،
 * فلا يتعطل أي مكوّن يُستخدم خارج شجرة المزوّد.
 */
export function useNotifications(): NotificationsContextValue {
  const ctx = useContext(NotificationsContext)
  if (ctx) return ctx
  return {
    unreadCount: 0,
    hydrated: false,
    isRead: () => false,
    markAsRead: () => undefined,
    markAllAsRead: () => undefined,
    refreshSummary: () => undefined,
    personal: [],
  }
}
