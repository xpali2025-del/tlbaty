import "server-only"

import { randomBytes } from "node:crypto"
import { ordersClient } from "@/sanity/orders/client"

// ============================================
// طبقة الوصول إلى قاعدة البيانات (Sanity) لمستندات المصادقة.
//
// كل الدوال خادمية. تعيد null / تفشل بهدوء عند غياب إعداد مشروع الطلبات
// حتى لا ينهار الموقع، لكن مسارات المصادقة تتحقق من الإعداد قبل الاستدعاء.
// ============================================

export type CustomerDoc = {
  _id: string
  customerId: string
  phone?: string
  verified?: boolean
  status?: string
  createdAt?: string
  lastLogin?: string
}

export type OtpDoc = {
  _id: string
  phone: string
  codeHash: string
  salt: string
  purpose: string
  expiresAt: string
  attempts: number
  verified: boolean
  consumed: boolean
}

export type SessionDoc = {
  _id: string
  sessionId: string
  customerId: string
  tokenHash: string
  expiresAt: string
  revoked?: boolean
}

/** يضمن وجود عميل Sanity أو يرفع خطأ إعداد واضح. */
export function requireClient() {
  if (!ordersClient) {
    throw new Error("ORDERS_NOT_CONFIGURED")
  }
  return ordersClient
}

export function hasClient(): boolean {
  return ordersClient !== null
}

// ---------- معرّف العميل ----------

// أبجدية Crockford Base32 (بلا أحرف ملتبسة I L O U) لمعرّف سهل القراءة.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

/** ينشئ معرّف عميل عشوائياً ثابتاً: CUS_XXXXXXXXXXXX (12 خانة). */
export function generateCustomerId(): string {
  const bytes = randomBytes(12)
  let out = ""
  for (let i = 0; i < 12; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length]
  }
  return `CUS_${out}`
}

// ---------- OTP ----------

/** يبطل كل رموز OTP السابقة غير المستهلكة لرقم/غرض معيّن. */
export async function invalidatePreviousOtps(phone: string, purpose: string): Promise<void> {
  const client = requireClient()
  const ids = await client.fetch<string[]>(
    `*[_type == "otpCode" && phone == $phone && purpose == $purpose && consumed != true]._id`,
    { phone, purpose },
  )
  if (ids.length === 0) return
  let tx = client.transaction()
  for (const id of ids) tx = tx.patch(id, (p) => p.set({ consumed: true }))
  await tx.commit({ visibility: "async" })
}

export async function createOtp(input: {
  phone: string
  codeHash: string
  salt: string
  purpose: string
  expiresAt: string
  provider: string
  ip: string
  userAgent: string
}): Promise<void> {
  const client = requireClient()
  await client.create({
    _type: "otpCode",
    ...input,
    attempts: 0,
    verified: false,
    consumed: false,
    createdAt: new Date().toISOString(),
  })
}

/** يجلب آخر رمز صالح (غير مستهلك) لرقم/غرض معيّن. */
export async function getActiveOtp(phone: string, purpose: string): Promise<OtpDoc | null> {
  const client = requireClient()
  return client.fetch<OtpDoc | null>(
    `*[_type == "otpCode" && phone == $phone && purpose == $purpose && consumed != true] | order(createdAt desc)[0]{
      _id, phone, codeHash, salt, purpose, expiresAt, attempts, verified, consumed
    }`,
    { phone, purpose },
  )
}

/** آخر وقت إرسال رمز لهذا الرقم/الغرض — لفرض مؤقت إعادة الإرسال. */
export async function getLastOtpCreatedAt(phone: string, purpose: string): Promise<string | null> {
  const client = requireClient()
  return client.fetch<string | null>(
    `*[_type == "otpCode" && phone == $phone && purpose == $purpose] | order(createdAt desc)[0].createdAt`,
    { phone, purpose },
  )
}

export async function incrementOtpAttempts(id: string, attempts: number): Promise<void> {
  const client = requireClient()
  await client.patch(id).set({ attempts }).commit({ visibility: "async" })
}

export async function consumeOtp(id: string): Promise<void> {
  const client = requireClient()
  await client.patch(id).set({ verified: true, consumed: true }).commit()
}

// ---------- العميل ----------

export async function getCustomerByPhone(phone: string): Promise<CustomerDoc | null> {
  const client = requireClient()
  return client.fetch<CustomerDoc | null>(
    `*[_type == "customer" && phone == $phone][0]{ _id, customerId, phone, verified, status, createdAt, lastLogin }`,
    { phone },
  )
}

export async function getCustomerById(customerId: string): Promise<CustomerDoc | null> {
  const client = requireClient()
  return client.fetch<CustomerDoc | null>(
    `*[_type == "customer" && customerId == $customerId][0]{ _id, customerId, phone, verified, status, createdAt, lastLogin }`,
    { customerId },
  )
}

export async function createCustomer(phone: string): Promise<CustomerDoc> {
  const client = requireClient()
  const now = new Date().toISOString()
  const customerId = generateCustomerId()
  const created = await client.create({
    _type: "customer",
    customerId,
    phone,
    verified: true,
    status: "active",
    createdAt: now,
    lastLogin: now,
  })
  return { _id: created._id, customerId, phone, verified: true, status: "active", createdAt: now, lastLogin: now }
}

export async function touchLastLogin(docId: string): Promise<void> {
  const client = requireClient()
  await client.patch(docId).set({ lastLogin: new Date().toISOString() }).commit({ visibility: "async" })
}

/** يحدّث رقم هاتف العميل مع الاحتفاظ بنفس معرّف العميل وكل طلباته. */
export async function updateCustomerPhone(docId: string, from: string, to: string): Promise<void> {
  const client = requireClient()
  await client
    .patch(docId)
    .set({ phone: to })
    .setIfMissing({ phoneHistory: [] })
    .append("phoneHistory", [
      { _key: randomBytes(4).toString("hex"), from, to, changedAt: new Date().toISOString() },
    ])
    .commit()
}

// ---------- عدّ الطلبات ----------

export async function countOrdersByCustomerId(customerId: string): Promise<number> {
  const client = requireClient()
  const n = await client.fetch<number>(`count(*[_type == "order" && customerId == $customerId])`, {
    customerId,
  })
  return typeof n === "number" ? n : 0
}
