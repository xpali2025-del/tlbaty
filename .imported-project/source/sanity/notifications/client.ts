import "server-only"

import { createClient, type SanityClient } from "next-sanity"
import {
  isNotificationsReadConfigured,
  notificationsApiVersion,
  notificationsDataset,
  notificationsProjectId,
  notificationsUseCdn,
} from "./env"

// ============================================
// عميل قراءة الإشعارات — مشروع Sanity الثالث المستقل
//
// - بلا توكن إطلاقاً: يقرأ المحتوى المنشور العام فقط.
// - useCdn: true افتراضياً (قراءة عامة سريعة ورخيصة)، وكاش Next.js
//   يبطل عبر Tags فور النشر من اللوحة فلا يتأخر ظهور الإشعار.
// - perspective: "published" لتجاهل أي مسودات على مستوى Sanity.
// - يعيد null عند غياب الإعدادات، فتتصرف كل الاستدعاءات بأمان
//   (قائمة فارغة) ولا يتعطل الموقع ولا تظهر صفحة بيضاء.
// ============================================

export const notificationsClient: SanityClient | null = isNotificationsReadConfigured
  ? createClient({
      projectId: notificationsProjectId,
      dataset: notificationsDataset,
      apiVersion: notificationsApiVersion,
      useCdn: notificationsUseCdn,
      perspective: "published",
    })
  : null

/**
 * عميل قراءة إداري — بلا CDN حتى ترى اللوحة آخر حالة فوراً
 * بعد أي حفظ أو نشر أو أرشفة (بما في ذلك المسودات).
 */
export const notificationsAdminReadClient: SanityClient | null = isNotificationsReadConfigured
  ? createClient({
      projectId: notificationsProjectId,
      dataset: notificationsDataset,
      apiVersion: notificationsApiVersion,
      useCdn: false,
      perspective: "published",
    })
  : null

/**
 * جلب موحّد لإشعارات العملاء مع كاش Next.js وإبطال عبر Tags.
 * يرجع القيمة الافتراضية عند غياب الإعدادات فقط، أما أخطاء الشبكة
 * فتُرمى ليتعامل معها حدّ الخطأ في الصفحة (مع زر إعادة المحاولة).
 */
export async function notificationsFetch<T>(options: {
  query: string
  params?: Record<string, unknown>
  tags?: string[]
  fallback: T
}): Promise<T> {
  const { query, params = {}, tags = [], fallback } = options

  if (!notificationsClient) return fallback

  return notificationsClient.fetch<T>(query, params, {
    cache: "force-cache",
    next: { tags },
  })
}
