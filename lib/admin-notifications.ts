import "server-only"

import { notificationsAdminReadClient } from "@/sanity/notifications/client"
import { getNotificationsConfigReport, type NotificationsConfigReport } from "@/sanity/notifications/env"
import { notificationImageUrl } from "@/sanity/notifications/image"
import { sanitizeInternalLink } from "@/sanity/notifications/internal-link"
import { ADMIN_NOTIFICATIONS } from "@/sanity/notifications/queries"
import {
  NOTIFICATION_STATUSES,
  type AdminNotification,
  type NotificationPriority,
  type NotificationStats,
  type NotificationStatus,
} from "@/sanity/notifications/types"

// ============================================
// طبقة قراءة الإشعارات للوحة /manage
//
// - تقرأ من مشروع الإشعارات المستقل بعميل بلا CDN (no-store)
//   حتى تعرض اللوحة آخر حالة فوراً بعد كل حفظ أو نشر.
// - تشمل المسودات والمؤرشف (بخلاف استعلام العملاء).
// - لا تلمس مشروع المحتوى ولا مشروع الطلبات إطلاقاً.
// ============================================

type RawAdminNotification = {
  _id?: string
  title?: string
  body?: string
  imageUrl?: string | null
  imageRef?: string | null
  link?: string | null
  status?: string
  priority?: string
  publishedAt?: string | null
  expiresAt?: string | null
  createdBy?: string | null
  createdAt?: string | null
  updatedAt?: string | null
}

function normalizeStatus(value: string | undefined): NotificationStatus {
  return NOTIFICATION_STATUSES.includes(value as NotificationStatus)
    ? (value as NotificationStatus)
    : "draft"
}

function normalizePriority(value: string | undefined): NotificationPriority {
  return value === "important" ? "important" : "normal"
}

function toAdminNotification(raw: RawAdminNotification): AdminNotification | null {
  const id = typeof raw._id === "string" ? raw._id : ""
  if (!id) return null

  return {
    _id: id,
    title: typeof raw.title === "string" ? raw.title : "",
    body: typeof raw.body === "string" ? raw.body : "",
    imageUrl: notificationImageUrl(raw.imageUrl, 320),
    imageRef: typeof raw.imageRef === "string" ? raw.imageRef : null,
    // نعرض الرابط في اللوحة فقط إن كان صالحاً، وإلا نعرض «رابط غير صالح».
    link: sanitizeInternalLink(raw.link),
    status: normalizeStatus(raw.status),
    priority: normalizePriority(raw.priority),
    publishedAt: raw.publishedAt ?? null,
    expiresAt: raw.expiresAt ?? null,
    createdBy: raw.createdBy ?? null,
    createdAt: raw.createdAt ?? null,
    updatedAt: raw.updatedAt ?? null,
  }
}

export type AdminNotificationsResult = {
  notifications: AdminNotification[]
  stats: NotificationStats
  config: NotificationsConfigReport
  /** خطأ قراءة (شبكة/صلاحيات) — تعرضه اللوحة مع زر إعادة المحاولة. */
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

  if (!notificationsAdminReadClient) {
    return { notifications: [], stats: emptyStats(), config, loadError: null }
  }

  try {
    const raw = await notificationsAdminReadClient.fetch<RawAdminNotification[]>(
      ADMIN_NOTIFICATIONS,
      {},
      { cache: "no-store" },
    )
    const notifications = raw
      .map(toAdminNotification)
      .filter((n): n is AdminNotification => n !== null)

    return { notifications, stats: buildStats(notifications), config, loadError: null }
  } catch (error) {
    // لا نطبع التوكن ولا أي إعداد حسّاس — رسالة الخطأ فقط.
    console.error("[v0] getAdminNotifications failed:", error instanceof Error ? error.message : error)
    return {
      notifications: [],
      stats: emptyStats(),
      config,
      loadError: "تعذّر جلب الإشعارات من مشروع الإشعارات. تحقّق من الاتصال وصلاحيات التوكن ثم أعد المحاولة.",
    }
  }
}
