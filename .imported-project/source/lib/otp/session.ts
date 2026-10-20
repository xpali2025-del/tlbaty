import "server-only"

import { cookies } from "next/headers"
import { randomBytes } from "node:crypto"
import { SESSION_COOKIE, SESSION_EXPIRE_DAYS } from "./config"
import { createSessionToken, hashSessionToken } from "./hash"
import { getCustomerById, requireClient, type CustomerDoc } from "./store"

// ============================================
// إدارة جلسة العميل — كوكي HttpOnly + مستند جلسة في Sanity.
//
// الكوكي يحمل التوكن الخام فقط؛ قاعدة البيانات تحفظ بصمته (HMAC).
// يدعم عدة أجهزة (عدة جلسات لعميل واحد) وإلغاء جلسة واحدة أو الكل.
// ============================================

const MS_PER_DAY = 24 * 60 * 60 * 1000

function cookieMaxAgeSeconds(): number {
  return SESSION_EXPIRE_DAYS * 24 * 60 * 60
}

/** ينشئ جلسة جديدة ويضبط كوكي HttpOnly Secure SameSite=Lax. */
export async function createSession(input: {
  customerId: string
  ip: string
  userAgent: string
}): Promise<void> {
  const client = requireClient()
  const token = createSessionToken()
  const tokenHash = hashSessionToken(token)
  const now = Date.now()
  const sessionId = `ses_${randomBytes(10).toString("hex")}`

  await client.create({
    _type: "customerSession",
    sessionId,
    customerId: input.customerId,
    tokenHash,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + SESSION_EXPIRE_DAYS * MS_PER_DAY).toISOString(),
    lastActivity: new Date(now).toISOString(),
    ip: input.ip,
    userAgent: input.userAgent.slice(0, 300),
    revoked: false,
  })

  const store = await cookies()
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: cookieMaxAgeSeconds(),
  })
}

type ResolvedSession = { customer: CustomerDoc; sessionDocId: string }

/** يقرأ الجلسة الحالية من الكوكي ويعيد العميل المرتبط بها إن كانت صالحة. */
export async function resolveSession(): Promise<ResolvedSession | null> {
  const store = await cookies()
  const token = store.get(SESSION_COOKIE)?.value
  if (!token) return null

  let client
  try {
    client = requireClient()
  } catch {
    return null
  }

  const tokenHash = hashSessionToken(token)
  const session = await client.fetch<{
    _id: string
    customerId: string
    expiresAt: string
    revoked?: boolean
  } | null>(
    `*[_type == "customerSession" && tokenHash == $h][0]{ _id, customerId, expiresAt, revoked }`,
    { h: tokenHash },
  )

  if (!session || session.revoked) return null
  if (new Date(session.expiresAt).getTime() < Date.now()) return null

  const customer = await getCustomerById(session.customerId)
  if (!customer || customer.status === "blocked") return null

  return { customer, sessionDocId: session._id }
}

/** يعيد العميل الحالي أو null — للاستخدام في الصفحات والمسارات المحمية. */
export async function getCurrentCustomer(): Promise<CustomerDoc | null> {
  const resolved = await resolveSession()
  return resolved?.customer ?? null
}

/** يحدّث آخر نشاط للجلسة (أفضل جهد، لا يعطّل الطلب عند الفشل). */
export async function touchSession(sessionDocId: string): Promise<void> {
  try {
    const client = requireClient()
    await client.patch(sessionDocId).set({ lastActivity: new Date().toISOString() }).commit({ visibility: "async" })
  } catch {
    // نتجاهل الفشل.
  }
}

/** يلغي الجلسة الحالية ويحذف الكوكي (تسجيل خروج من هذا الجهاز). */
export async function destroyCurrentSession(): Promise<void> {
  const store = await cookies()
  const token = store.get(SESSION_COOKIE)?.value

  if (token) {
    try {
      const client = requireClient()
      const tokenHash = hashSessionToken(token)
      const id = await client.fetch<string | null>(
        `*[_type == "customerSession" && tokenHash == $h][0]._id`,
        { h: tokenHash },
      )
      if (id) await client.patch(id).set({ revoked: true }).commit()
    } catch {
      // نتجاهل الفشل — سنحذف الكوكي على أي حال.
    }
  }

  store.delete(SESSION_COOKIE)
}

/** يلغي كل جلسات العميل (تسجيل خروج من جميع الأجهزة). */
export async function revokeAllSessions(customerId: string): Promise<void> {
  const client = requireClient()
  const ids = await client.fetch<string[]>(
    `*[_type == "customerSession" && customerId == $cid && revoked != true]._id`,
    { cid: customerId },
  )
  if (ids.length > 0) {
    let tx = client.transaction()
    for (const id of ids) tx = tx.patch(id, (p) => p.set({ revoked: true }))
    await tx.commit()
  }
  const store = await cookies()
  store.delete(SESSION_COOKIE)
}
