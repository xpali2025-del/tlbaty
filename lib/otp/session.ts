import "server-only"
import { cookies } from "next/headers"
import { and, eq, ne } from "drizzle-orm"
import { db } from "@/lib/db/client"
import { customerSessions, customers } from "@/lib/db/store"
import { SESSION_COOKIE, SESSION_EXPIRE_DAYS } from "./config"
import { createSessionToken, hashSessionToken } from "./hash"
import type { Customer } from "./store"

const MS_PER_DAY = 24 * 60 * 60 * 1000
const cookieMaxAge = SESSION_EXPIRE_DAYS * 24 * 60 * 60

/** ينشئ جلسة جديدة ويضبط كوكي HttpOnly SameSite=Lax. التوكن الخام لا يُخزَّن في القاعدة. */
export async function createSession(input: { customerId: string; ip: string; userAgent: string }): Promise<void> {
  const token = createSessionToken()
  await db.insert(customerSessions).values({
    customerId: input.customerId,
    tokenHash: hashSessionToken(token),
    expiresAt: new Date(Date.now() + SESSION_EXPIRE_DAYS * MS_PER_DAY),
    ip: input.ip,
    userAgent: input.userAgent.slice(0, 300),
  })
  ;(await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: cookieMaxAge,
  })
}

type ResolvedSession = { customer: Customer; sessionId: string }

/** يقرأ الجلسة من الكوكي ويعيد العميل إن كانت صالحة وغير ملغاة ولم تنتهِ والعميل غير محظور. */
export async function resolveSession(): Promise<ResolvedSession | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  if (!token) return null
  let tokenHash: string
  try {
    tokenHash = hashSessionToken(token)
  } catch {
    return null
  }
  const [row] = await db
    .select({ session: customerSessions, customer: customers })
    .from(customerSessions)
    .innerJoin(customers, eq(customers.id, customerSessions.customerId))
    .where(eq(customerSessions.tokenHash, tokenHash))
    .limit(1)
  if (!row || row.session.revoked) return null
  if (row.session.expiresAt.getTime() < Date.now()) return null
  if (row.customer.status === "blocked") return null
  return { customer: row.customer, sessionId: row.session.id }
}

export async function getCurrentCustomer(): Promise<Customer | null> {
  return (await resolveSession())?.customer ?? null
}

/** يحدّث آخر نشاط (أفضل جهد). */
export async function touchSession(sessionId: string): Promise<void> {
  try {
    await db.update(customerSessions).set({ lastActivityAt: new Date() }).where(eq(customerSessions.id, sessionId))
  } catch {
    // لا نعطّل الطلب.
  }
}

/** تسجيل خروج من هذا الجهاز. */
export async function destroyCurrentSession(): Promise<void> {
  const jar = await cookies()
  const token = jar.get(SESSION_COOKIE)?.value
  if (token) {
    try {
      await db.update(customerSessions).set({ revoked: true }).where(eq(customerSessions.tokenHash, hashSessionToken(token)))
    } catch {
      // نحذف الكوكي في كل الأحوال.
    }
  }
  jar.delete(SESSION_COOKIE)
}

/** تسجيل خروج من كل الأجهزة. */
export async function revokeAllSessions(customerId: string): Promise<void> {
  await db
    .update(customerSessions)
    .set({ revoked: true })
    .where(and(eq(customerSessions.customerId, customerId), eq(customerSessions.revoked, false)))
  ;(await cookies()).delete(SESSION_COOKIE)
}

/** يُنهي كل جلسات العميل ما عدا الحالية (بعد تغيير الرقم: من فقد رقمه أو جهازه لا تبقى جلسته مفتوحة). */
export async function revokeOtherSessions(customerId: string, keepSessionId: string): Promise<number> {
  const revoked = await db
    .update(customerSessions)
    .set({ revoked: true })
    .where(and(eq(customerSessions.customerId, customerId), ne(customerSessions.id, keepSessionId), eq(customerSessions.revoked, false)))
    .returning({ id: customerSessions.id })
  return revoked.length
}
