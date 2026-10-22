import "server-only"

import { desc, isNull } from "drizzle-orm"
import { db } from "@/lib/db/client"
import { notifications } from "@/lib/db/store"
import { resolveOptionalImageUrl } from "@/lib/images"
import { sanitizeInternalLink } from "@/lib/notification-link"
import type {
  AdminNotification,
  NotificationStats,
} from "@/lib/notification-types"

// طبقة قراءة الإشعارات للوحة /manage: تشمل المسودات والمؤرشف وبلا كاش.

export type NotificationsConfigReport = {
  ready: boolean
  readReady: boolean
  missing: string[]
}

export function getNotificationsConfigReport(): NotificationsConfigReport {
  const ready = Boolean(process.env.DATABASE_URL)
  return { ready, readReady: ready, missing: ready ? [] : ["DATABASE_URL"] }
}

type Row = typeof notifications.$inferSelect

function toAdminNotification(row: Row): AdminNotification {
  return {
    _id: row.id,
    title: row.title,
    body: row.body ?? "",
    imageUrl: resolveOptionalImageUrl(row.imageKey) ?? null,
    imageRef: row.imageKey,
    // نعرض الرابط في اللوحة فقط إن كان صالحاً.
    link: sanitizeInternalLink(row.link),
    status: row.status,
    priority: row.priority,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export type AdminNotificationsResult = {
  notifications: AdminNotification[]
  stats: NotificationStats
  config: NotificationsConfigReport
  /** خطأ قراءة — تعرضه اللوحة مع زر إعادة المحاولة. */
  loadError: string | null
}

function emptyStats(): NotificationStats {
  return { total: 0, published: 0, draft: 0, archived: 0 }
}

function buildStats(items: AdminNotification[]): NotificationStats {
  return items.reduce<NotificationStats>((acc, item) => {
    acc.total += 1
    if (item.status === "published") acc.published += 1
    else if (item.status === "draft") acc.draft += 1
    else if (item.status === "archived") acc.archived += 1
    return acc
  }, emptyStats())
}

/**
 * يجلب كل الإشعارات للوحة الإدارة مع الإحصاءات وتقرير الإعدادات.
 * لا يرمي أبداً — يعيد loadError ليعرضه المكوّن بلا صفحة بيضاء.
 */
export async function getAdminNotifications(): Promise<AdminNotificationsResult> {
  const config = getNotificationsConfigReport()
  if (!config.ready) {
    return { notifications: [], stats: emptyStats(), config, loadError: null }
  }

  try {
    const rows = await db
      .select()
      .from(notifications)
      .where(isNull(notifications.customerId))
      .orderBy(desc(notifications.publishedAt), desc(notifications.createdAt))
    const items = rows.map(toAdminNotification)
    return { notifications: items, stats: buildStats(items), config, loadError: null }
  } catch (error) {
    console.error("getAdminNotifications failed:", error instanceof Error ? error.message : error)
    return {
      notifications: [],
      stats: emptyStats(),
      config,
      loadError: "تعذّر جلب الإشعارات من قاعدة البيانات. تحقّق من الاتصال ثم أعد المحاولة.",
    }
  }
}

/** نتيجة فارغة لمن لا يملك صلاحية الإشعارات (لا استعلام ولا بيانات). */
export const EMPTY_ADMIN_NOTIFICATIONS: AdminNotificationsResult = {
  notifications: [],
  stats: { total: 0, published: 0, draft: 0, archived: 0 },
  config: { ready: true, readReady: true, missing: [] },
  loadError: null,
}
