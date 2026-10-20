import "server-only"

import { notificationsFetch } from "@/sanity/notifications/client"
import { NOTIFICATION_TAGS } from "@/sanity/notifications/cache-tags"
import { notificationImageUrl } from "@/sanity/notifications/image"
import { sanitizeInternalLink } from "@/sanity/notifications/internal-link"
import {
  PUBLIC_NOTIFICATIONS,
  PUBLIC_NOTIFICATIONS_COUNT,
  NOTIFICATIONS_SUMMARY,
} from "@/sanity/notifications/queries"
import {
  type NotificationPriority,
  type NotificationSummaryItem,
  type PublicNotification,
} from "@/sanity/notifications/types"

// ============================================
// طبقة قراءة الإشعارات المعروضة للعملاء
//
// - تقرأ من مشروع الإشعارات المستقل فقط.
// - المسودة والمؤرشف والمنتهي والمجدول للمستقبل لا تُعاد إطلاقاً (فلترة GROQ).
// - عند غياب إعدادات المشروع تعيد قائمة فارغة بهدوء فلا يتعطل الموقع.
// ============================================

/** عدد الإشعارات في كل صفحة من شاشة العملاء. */
export const NOTIFICATIONS_PAGE_SIZE = 10

/** الشكل الخام القادم من GROQ قبل التنظيف. */
type RawNotification = {
  _id?: string
  title?: string
  body?: string
  imageUrl?: string | null
  link?: string | null
  priority?: string
  publishedAt?: string
}

type RawSummaryItem = {
  _id?: string
  publishedAt?: string
  priority?: string
}

function normalizePriority(value: string | undefined): NotificationPriority {
  return value === "important" ? "important" : "normal"
}

/**
 * تنظيف الإشعار قبل تسليمه للواجهة:
 * - النص والعنوان يُعادان كنص عادي (React يهرّبهما تلقائياً عند العرض).
 * - الرابط يمر على فلتر الروابط الداخلية؛ الرابط غير الصالح يصبح null
 *   فيُعرض الإشعار بلا رابط بدلاً من تعطيله.
 */
function toPublicNotification(raw: RawNotification): PublicNotification | null {
  const id = typeof raw._id === "string" ? raw._id : ""
  const title = typeof raw.title === "string" ? raw.title.trim() : ""
  const body = typeof raw.body === "string" ? raw.body.trim() : ""
  const publishedAt = typeof raw.publishedAt === "string" ? raw.publishedAt : ""

  if (!id || !title || !body || !publishedAt) return null

  return {
    _id: id,
    title,
    body,
    imageUrl: notificationImageUrl(raw.imageUrl, 640),
    link: sanitizeInternalLink(raw.link),
    priority: normalizePriority(raw.priority),
    publishedAt,
  }
}

export type PublicNotificationsPage = {
  items: PublicNotification[]
  total: number
  hasMore: boolean
  /** هل مشروع الإشعارات مهيأ للقراءة؟ تستخدمه الواجهة لرسالة مناسبة. */
  configured: boolean
}

/**
 * يجلب صفحة من إشعارات العملاء.
 * قد يرمي خطأ شبكة/Sanity ليعرض حدّ الخطأ زر إعادة المحاولة،
 * أما غياب الإعدادات فيعيد صفحة فارغة بهدوء.
 */
export async function getPublicNotifications(
  page = 0,
  pageSize = NOTIFICATIONS_PAGE_SIZE,
): Promise<PublicNotificationsPage> {
  const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 0
  const safeSize = Number.isFinite(pageSize) && pageSize > 0 ? Math.min(50, Math.floor(pageSize)) : 10
  const start = safePage * safeSize
  const now = new Date().toISOString()

  const [rawItems, total] = await Promise.all([
    notificationsFetch<RawNotification[]>({
      query: PUBLIC_NOTIFICATIONS,
      params: { now, start, end: start + safeSize },
      tags: [NOTIFICATION_TAGS.list],
      fallback: [],
    }),
    notificationsFetch<number>({
      query: PUBLIC_NOTIFICATIONS_COUNT,
      params: { now },
      tags: [NOTIFICATION_TAGS.list],
      fallback: 0,
    }),
  ])

  const items = rawItems.map(toPublicNotification).filter((n): n is PublicNotification => n !== null)

  return {
    items,
    total,
    hasMore: start + safeSize < total,
    configured: rawItems.length > 0 || total > 0 || isNotificationsConfiguredForRead(),
  }
}

/** فحص خفيف بلا كشف أي قيمة — للتمييز بين «لا إشعارات» و«غير مهيأ». */
function isNotificationsConfiguredForRead(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SANITY_NOTIFICATIONS_PROJECT_ID)
}

/**
 * الاستعلام الخفيف لعدّاد الجرس — معرّفات وأوقات وأولويات فقط.
 * لا صور ولا نصوص، فلا يثقل أي صفحة.
 */
export async function getNotificationsSummary(): Promise<NotificationSummaryItem[]> {
  const now = new Date().toISOString()

  const raw = await notificationsFetch<RawSummaryItem[]>({
    query: NOTIFICATIONS_SUMMARY,
    params: { now },
    tags: [NOTIFICATION_TAGS.summary],
    fallback: [],
  })

  return raw
    .filter((item): item is RawSummaryItem & { _id: string; publishedAt: string } =>
      typeof item._id === "string" && typeof item.publishedAt === "string",
    )
    .map((item) => ({
      _id: item._id,
      publishedAt: item.publishedAt,
      priority: normalizePriority(item.priority),
    }))
}
