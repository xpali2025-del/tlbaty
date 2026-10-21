import "server-only"

import { and, eq, lt, or } from "drizzle-orm"
import { db } from "@/lib/db/client"
import { authEvents, customerSessions, loginChallenges, otpCodes } from "@/lib/db/store"

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
