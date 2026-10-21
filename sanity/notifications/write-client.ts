import "server-only"

import { createClient, type SanityClient } from "next-sanity"
import {
  notificationsApiVersion,
  notificationsDataset,
  notificationsProjectId,
  getNotificationsConfigReport,
} from "./env"

// ============================================
// عميل الكتابة — مشروع الإشعارات فقط
//
// - "server-only" يمنع استيراده من المتصفح، فالتوكن لا يصل للعميل أبداً.
// - التوكن يُقرأ من SANITY_NOTIFICATIONS_API_TOKEN وحده. لا يُستخدم
//   SANITY_API_TOKEN (المحتوى) ولا SANITY_ORDERS_TOKEN (الطلبات) هنا.
// - useCdn: false لأن الكتابة والعمليات الإدارية يجب أن تمر على الـAPI مباشرة.
// - projectId/dataset من متغيرات الخادم فقط، ولا يُقبلان من العميل إطلاقاً.
// ============================================

const token = process.env.SANITY_NOTIFICATIONS_API_TOKEN?.trim()

export const notificationsWriteClient: SanityClient | null =
  notificationsProjectId && token
    ? createClient({
        projectId: notificationsProjectId,
        dataset: notificationsDataset,
        apiVersion: notificationsApiVersion,
        token,
        useCdn: false,
        perspective: "published",
      })
    : null

/**
 * يعيد عميل الكتابة أو يرمي رسالة إعداد واضحة تذكر أسماء المتغيرات
 * الناقصة فقط — دون أي قيمة أو جزء من التوكن.
 */
export function requireNotificationsWriteClient(): SanityClient {
  if (!notificationsWriteClient) {
    const { missing } = getNotificationsConfigReport()
    throw new Error(
      `مشروع الإشعارات غير مهيأ. أضف المتغيرات التالية ثم أعد المحاولة: ${missing.join(" و ")}.`,
    )
  }
  return notificationsWriteClient
}
