import "server-only"

import { and, eq, inArray, lt, ne, or, sql } from "drizzle-orm"
import { db } from "@/lib/db/client"
import { authEvents, customerSessions, loginChallenges, orderPaymentProofs, orders, otpCodes, siteSettings } from "@/lib/db/store"
import { deletePaymentProof } from "@/lib/storage/proofs"

const DAY = 86_400_000

/** مدة الاحتفاظ بسجل أحداث الدخول (يُستخدم أيضاً لحدود المعدّل، وأقصاها ساعات). */
export const AUTH_EVENTS_RETENTION_DAYS = 90

/**
 * حذف الصفوف المنتهية فقط: رموز OTP وتحديات الدخول المنتهية، وجلسات منتهية أو ملغاة،
 * وأحداث دخول أقدم من مدة الاحتفاظ. تُنفَّذ دورياً (cron) حتى لا تتضخم الجداول وتبطؤ الفهارس.
 */
export async function purgeExpiredAuthData(now = new Date()) {
  const graceCutoff = new Date(now.getTime() - DAY) // يوم سماح بعد الانتهاء لمراجعة المشكلات
  const eventsCutoff = new Date(now.getTime() - AUTH_EVENTS_RETENTION_DAYS * DAY)

  const [otps, challenges, sessions, events] = await Promise.all([
    db.delete(otpCodes).where(lt(otpCodes.expiresAt, graceCutoff)).returning({ id: otpCodes.id }),
    db.delete(loginChallenges).where(lt(loginChallenges.expiresAt, graceCutoff)).returning({ id: loginChallenges.id }),
    db
      .delete(customerSessions)
      .where(or(lt(customerSessions.expiresAt, graceCutoff), and(eq(customerSessions.revoked, true), lt(customerSessions.createdAt, graceCutoff))))
      .returning({ id: customerSessions.id }),
    db.delete(authEvents).where(lt(authEvents.at, eventsCutoff)).returning({ id: authEvents.id }),
  ])
  return { otpCodes: otps.length, loginChallenges: challenges.length, sessions: sessions.length, authEvents: events.length }
}

/** أقصى عدد إثباتات تُحذف في تشغيل واحد (حماية للمهمة والتخزين؛ الباقي يُحذف في التشغيل التالي). */
export const PROOF_PURGE_BATCH = 200

/**
 * يحذف صور إثبات الدفع القديمة حسب مدة الاحتفاظ في إعدادات الموقع (بلا مدة = لا حذف).
 * يشمل فقط الطلبات المنتهية (مسلَّمة/ملغاة/مُرجَعة) التي مضت المدة على انتهائها ولم يكن دفعها بانتظار التحقق.
 * يُحذف الملف من التخزين أولاً ثم صفه؛ فشل حذف ملف يُبقي صفه فيُعاد المحاولة لاحقاً (لا ملفات يتيمة ولا فقدان صف).
 * تبقى بيانات الحوالة النصية في الطلب للمراجعة.
 */
export async function purgeOldPaymentProofs(now = new Date()) {
  const [settings] = await db.select({ days: siteSettings.proofRetentionDays }).from(siteSettings).limit(1)
  const days = settings?.days ?? null
  if (!days) return { enabled: false, deleted: 0, failed: 0 }

  const cutoff = new Date(now.getTime() - days * DAY)
  const due = await db
    .select({ id: orderPaymentProofs.id, objectKey: orderPaymentProofs.objectKey })
    .from(orderPaymentProofs)
    .innerJoin(orders, eq(orders.id, orderPaymentProofs.orderId))
    .where(
      and(
        inArray(orders.status, ["delivered", "cancelled", "returned"]),
        ne(orders.paymentStatus, "pending_verification"),
        lt(sql`coalesce(${orders.deliveredAt}, ${orders.updatedAt})`, cutoff),
      ),
    )
    .limit(PROOF_PURGE_BATCH)

  let deleted = 0
  let failed = 0
  for (const row of due) {
    try {
      await deletePaymentProof(row.objectKey)
      await db.delete(orderPaymentProofs).where(eq(orderPaymentProofs.id, row.id))
      deleted += 1
    } catch {
      failed += 1
    }
  }
  return { enabled: true, deleted, failed }
}
