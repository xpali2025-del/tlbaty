import "server-only"
import { randomBytes } from "node:crypto"
import { and, desc, eq, gte, lt, sql } from "drizzle-orm"
import { db } from "@/lib/db/client"
import { customerPhoneHistory, customers, otpCodes } from "@/lib/db/store"
import type { OtpPurpose } from "./provider"

export type Customer = typeof customers.$inferSelect
export type Otp = typeof otpCodes.$inferSelect

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

/** معرّف عميل عام عشوائي ثابت: CUS_XXXXXXXXXXXX (12 خانة). */
export function generateCustomerId(): string {
  const bytes = randomBytes(12)
  let out = ""
  for (let i = 0; i < 12; i++) out += ALPHABET[bytes[i] % ALPHABET.length]
  return `CUS_${out}`
}

/** يبطل كل رموز OTP السابقة غير المستهلكة لرقم/غرض معيّن. */
export async function invalidatePreviousOtps(phone: string, purpose: OtpPurpose): Promise<void> {
  await db
    .update(otpCodes)
    .set({ consumed: true })
    .where(and(eq(otpCodes.phone, phone), eq(otpCodes.purpose, purpose), eq(otpCodes.consumed, false)))
}

export async function createOtp(input: {
  phone: string
  codeHash: string
  salt: string
  purpose: OtpPurpose
  expiresAt: Date
  provider: string
  ip: string
  userAgent: string
}): Promise<void> {
  await db.insert(otpCodes).values(input)
}

/** آخر رمز صالح (غير مستهلك) لرقم/غرض معيّن. */
export async function getActiveOtp(phone: string, purpose: OtpPurpose): Promise<Otp | null> {
  const [row] = await db
    .select()
    .from(otpCodes)
    .where(and(eq(otpCodes.phone, phone), eq(otpCodes.purpose, purpose), eq(otpCodes.consumed, false)))
    .orderBy(desc(otpCodes.createdAt))
    .limit(1)
  return row ?? null
}

/** آخر وقت إنشاء رمز لهذا الرقم/الغرض — لفرض مؤقت إعادة الإرسال. */
export async function getLastOtpCreatedAt(phone: string, purpose: OtpPurpose): Promise<Date | null> {
  const [row] = await db
    .select({ createdAt: otpCodes.createdAt })
    .from(otpCodes)
    .where(and(eq(otpCodes.phone, phone), eq(otpCodes.purpose, purpose)))
    .orderBy(desc(otpCodes.createdAt))
    .limit(1)
  return row?.createdAt ?? null
}

/**
 * يحجز محاولة تحقق واحدة قبل مقارنة الرمز، ذرّياً: يفشل (null) إن بلغ الحد أو استُهلك الرمز.
 * الحجز قبل المقارنة يمنع تجاوز الحد بطلبات متوازية (كلها كانت تقرأ العدّاد القديم ثم تقارن).
 */
export async function reserveOtpAttempt(id: string, max: number): Promise<number | null> {
  const [row] = await db
    .update(otpCodes)
    .set({ attempts: sql`${otpCodes.attempts} + 1` })
    .where(and(eq(otpCodes.id, id), eq(otpCodes.consumed, false), lt(otpCodes.attempts, max)))
    .returning({ attempts: otpCodes.attempts })
  return row?.attempts ?? null
}

/** يستهلك الرمز مرة واحدة فقط: تعيد true لأول مستهلك وfalse لأي طلب متزامن آخر. */
export async function consumeOtp(id: string, verified: boolean): Promise<boolean> {
  const rows = await db
    .update(otpCodes)
    .set({ verified, consumed: true })
    .where(and(eq(otpCodes.id, id), eq(otpCodes.consumed, false)))
    .returning({ id: otpCodes.id })
  return rows.length > 0
}

export async function getCustomerByPhone(phone: string): Promise<Customer | null> {
  const [row] = await db.select().from(customers).where(eq(customers.phone, phone)).limit(1)
  return row ?? null
}

export async function getCustomerById(id: string): Promise<Customer | null> {
  const [row] = await db.select().from(customers).where(eq(customers.id, id)).limit(1)
  return row ?? null
}

/** ينشئ العميل؛ عند سباق على الرقم نفسه يعيد الصف الذي أنشأه الطلب الآخر. */
export async function createCustomer(phone: string): Promise<Customer> {
  const [created] = await db
    .insert(customers)
    .values({ publicId: generateCustomerId(), phone, verified: true, status: "active", lastLoginAt: new Date() })
    .onConflictDoNothing({ target: customers.phone })
    .returning()
  if (created) return created
  const existing = await getCustomerByPhone(phone)
  if (!existing) throw new Error("CUSTOMER_CREATE_FAILED")
  return existing
}

export async function touchLastLogin(id: string): Promise<void> {
  await db.update(customers).set({ lastLoginAt: new Date() }).where(eq(customers.id, id))
}

/** عدد الرموز التي أُنشئت لهذا الرقم/الغرض خلال نافذة زمنية — لحساب الانتظار المتصاعد. */
export async function countRecentOtps(phone: string, purpose: OtpPurpose, windowMs: number): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(otpCodes)
    .where(
      and(eq(otpCodes.phone, phone), eq(otpCodes.purpose, purpose), gte(otpCodes.createdAt, new Date(Date.now() - windowMs))),
    )
  return row?.n ?? 0
}

/** يحدّث هاتف العميل مع بقاء معرّفه وكل طلباته، ويسجّل التغيير في السجل (ذرّياً). */
export async function updateCustomerPhone(customerId: string, from: string, to: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.update(customers).set({ phone: to }).where(eq(customers.id, customerId))
    await tx.insert(customerPhoneHistory).values({ customerId, fromPhone: from, toPhone: to })
  })
}
