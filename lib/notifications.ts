import "server-only"

import { isDbConfigured } from "@/lib/db-cache"
import { and, count, desc, eq, gt, isNull, lte, or } from "drizzle-orm"
import { db } from "@/lib/db/client"
import { notifications } from "@/lib/db/store"
import { dbCached } from "@/lib/db-cache"
import { resolveOptionalImageUrl } from "@/lib/images"
import { sanitizeInternalLink } from "@/lib/notification-link"
import type {
  NotificationPriority,
  NotificationSummaryItem,
  PublicNotification,
} from "@/lib/notification-types"

// طبقة قراءة الإشعارات المعروضة للعملاء.
// المسودة والمؤرشف والمنتهي والمجدول للمستقبل لا تُعاد إطلاقاً (الفلترة في SQL).
// بلا DATABASE_URL تعيد قائمة فارغة بهدوء فلا يتعطل الموقع.

/** عدد الإشعارات في كل صفحة من شاشة العملاء. */
export const NOTIFICATIONS_PAGE_SIZE = 10

/** وسوم الكاش — تطابق ما تبطله إجراءات اللوحة. */
export const NOTIFICATION_TAGS = {
  list: "notifications:list",
  summary: "notifications:summary",
} as const

function normalizePriority(value: string | undefined): NotificationPriority {
  return value === "important" ? "important" : "normal"
}

/** الإشعار الظاهر الآن: منشور، وقت نشره حلّ، ولم ينتهِ. */
function visibleNow(now: Date) {
  return and(
    isNull(notifications.customerId),
    eq(notifications.status, "published"),
    lte(notifications.publishedAt, now),
    or(isNull(notifications.expiresAt), gt(notifications.expiresAt, now)),
  )
}

export type PublicNotificationsPage = {
  items: PublicNotification[]
  total: number
  hasMore: boolean
  /** هل قاعدة البيانات مهيأة؟ تستخدمه الواجهة لرسالة مناسبة. */
  configured: boolean
}

/**
 * صفحة من إشعارات العملاء. يرمي عند خطأ القاعدة ليعرض حدّ الخطأ زر إعادة المحاولة،
 * أما غياب الإعدادات فيعيد صفحة فارغة.
 */
export async function getPublicNotifications(
  page = 0,
  pageSize = NOTIFICATIONS_PAGE_SIZE,
): Promise<PublicNotificationsPage> {
  const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 0
  const safeSize = Number.isFinite(pageSize) && pageSize > 0 ? Math.min(50, Math.floor(pageSize)) : 10
  const start = safePage * safeSize
  const configured = isDbConfigured()

  // الدقيقة الحالية جزء من مفتاح الكاش حتى لا يتأخر ظهور المجدول/انتهاء الصلاحية أكثر من دقيقة.
  const minute = Math.floor(Date.now() / 60_000)

  const result = await dbCached({
    keyParts: ["notifications", "public", String(safePage), String(safeSize), String(minute)],
    tags: [NOTIFICATION_TAGS.list],
    fallback: { items: [] as PublicNotification[], total: 0 },
    load: async () => {
      const now = new Date()
      const where = visibleNow(now)
      const [rows, [{ total }]] = await Promise.all([
        db
          .select()
          .from(notifications)
          .where(where)
          .orderBy(desc(notifications.publishedAt), desc(notifications.createdAt))
          .limit(safeSize)
          .offset(start),
        db.select({ total: count() }).from(notifications).where(where),
      ])
      const items: PublicNotification[] = []
      for (const row of rows) {
        const title = row.title.trim()
        const body = (row.body ?? "").trim()
        if (!title || !body || !row.publishedAt) continue
        items.push({
          _id: row.id,
          title,
          body,
          imageUrl: resolveOptionalImageUrl(row.imageKey) ?? null,
          link: sanitizeInternalLink(row.link),
          priority: normalizePriority(row.priority),
          publishedAt: row.publishedAt.toISOString(),
        })
      }
      return { items, total: Number(total) }
    },
  })

  return { items: result.items, total: result.total, hasMore: start + safeSize < result.total, configured }
}

/** الاستعلام الخفيف لعدّاد الجرس — معرّفات وأوقات وأولويات فقط. */
export async function getNotificationsSummary(): Promise<NotificationSummaryItem[]> {
  const minute = Math.floor(Date.now() / 60_000)
  return dbCached({
    keyParts: ["notifications", "summary", String(minute)],
    tags: [NOTIFICATION_TAGS.summary],
    fallback: [] as NotificationSummaryItem[],
    load: async () => {
      const rows = await db
        .select({ id: notifications.id, publishedAt: notifications.publishedAt, priority: notifications.priority })
        .from(notifications)
        .where(visibleNow(new Date()))
        .orderBy(desc(notifications.publishedAt))
        .limit(200)
      return rows
        .filter((r) => r.publishedAt)
        .map((r) => ({
          _id: r.id,
          publishedAt: (r.publishedAt as Date).toISOString(),
          priority: normalizePriority(r.priority),
        }))
    },
  })
}

/** إشعارات هذا العميل الشخصية (تذكير السلة والرغبات…) الصالحة الآن، الأحدث أولاً. بلا كاش: تختلف من عميل لآخر. */
export async function getPersonalNotifications(customerId: string, limit = 20): Promise<PublicNotification[]> {
  if (!isDbConfigured()) return []
  const now = new Date()
  const rows = await db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.customerId, customerId),
        eq(notifications.status, "published"),
        lte(notifications.publishedAt, now),
        or(isNull(notifications.expiresAt), gt(notifications.expiresAt, now)),
      ),
    )
    .orderBy(desc(notifications.publishedAt))
    .limit(limit)
  return rows.flatMap((row) =>
    row.publishedAt && row.title.trim() && (row.body ?? "").trim()
      ? [
          {
            _id: row.id,
            title: row.title.trim(),
            body: (row.body ?? "").trim(),
            imageUrl: resolveOptionalImageUrl(row.imageKey) ?? null,
            link: sanitizeInternalLink(row.link),
            priority: normalizePriority(row.priority),
            publishedAt: row.publishedAt.toISOString(),
          },
        ]
      : [],
  )
}
