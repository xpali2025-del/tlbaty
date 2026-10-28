import "server-only"
import { and, eq, gte, inArray, sql } from "drizzle-orm"
import { db } from "@/lib/db/client"
import { authEvents, loginChallenges, otpCodes } from "@/lib/db/store"

// تحديد المعدل مبني على جداول المصادقة نفسها (بلا Redis): يعمل على Serverless
// لأن الحالة في قاعدة البيانات لا في ذاكرة العملية.

const HOUR = 3_600_000
const MAX_SENDS_PER_PHONE = 5
const MAX_SENDS_PER_IP = 15
const MAX_FAILED_VERIFY_PER_PHONE = 10
const VERIFY_WINDOW = 15 * 60_000

const since = (ms: number) => new Date(Date.now() - ms)

/** هل يُسمح بمحاولة إرسال جديدة لهذا الرقم/الـIP؟ (5 لكل رقم و15 لكل IP في الساعة؛ حد الـIP يشمل الإرسال وإعادة الإرسال). */
export async function consumeSendAttempt(phone: string, ip: string): Promise<boolean> {
  const [{ perPhone }] = await db
    .select({ perPhone: sql<number>`count(*)::int` })
    .from(otpCodes)
    .where(and(eq(otpCodes.phone, phone), gte(otpCodes.createdAt, since(HOUR))))
  if (perPhone >= MAX_SENDS_PER_PHONE) return false

  if (ip && ip !== "unknown") {
    const [{ perIp }] = await db
      .select({ perIp: sql<number>`count(*)::int` })
      .from(authEvents)
      .where(and(eq(authEvents.ip, ip), inArray(authEvents.event, ["otp_sent", "otp_resent"]), gte(authEvents.at, since(HOUR))))
    if (perIp >= MAX_SENDS_PER_IP) return false
  }
  return true
}

/** قفل مؤقت للرقم بعد 10 محاولات تحقق فاشلة خلال 15 دقيقة. */
export async function consumeVerifyAttempt(phone: string): Promise<boolean> {
  const [{ failed }] = await db
    .select({ failed: sql<number>`count(*)::int` })
    .from(authEvents)
    .where(and(eq(authEvents.phone, phone), eq(authEvents.event, "otp_failed"), gte(authEvents.at, since(VERIFY_WINDOW))))
  return failed < MAX_FAILED_VERIFY_PER_PHONE
}

const MAX_CHALLENGES_PER_IP = 20

/** حد لعدد طلبات "الدخول بنقرة واتساب" من IP واحد في الساعة. */
export async function consumeChallengeStart(ip: string): Promise<boolean> {
  if (!ip || ip === "unknown") return true
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(loginChallenges)
    .where(and(eq(loginChallenges.ip, ip), gte(loginChallenges.createdAt, since(HOUR))))
  return n < MAX_CHALLENGES_PER_IP
}
