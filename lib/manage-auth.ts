import "server-only"

import { cookies } from "next/headers"
import { createHmac, timingSafeEqual } from "node:crypto"
import { findUserByUsername, verifyStoredUser } from "@/lib/manage-users"

// ============================================
// حماية لوحة /manage عبر جلسة موقّعة تربطها باسم المستخدم.
// - حساب المالك يُضبط عبر MANAGE_USERNAME (افتراضياً "odoo") و MANAGE_PASSWORD.
// - يمكن إضافة مستخدمين إضافيين من داخل اللوحة (يُخزَّنون بكلمات مرور مُجزّأة).
// - إذا لم تُضبط MANAGE_PASSWORD: اللوحة مفتوحة في التطوير فقط، ومغلقة تماماً في الإنتاج.
// - الجلسة تنتهي بعد 7 أيام، وتُوقَّع بسر منفصل عن كلمة المرور إن وُجد MANAGE_SESSION_SECRET (أو SESSION_SECRET).
// الكوكي HttpOnly وموقّعة بـ HMAC حتى لا يمكن تزويرها من المتصفح.
// ============================================

const COOKIE_NAME = "manage_session"

function getPassword(): string | null {
  const value = process.env.MANAGE_PASSWORD?.trim()
  return value ? value : null
}

/** اسم مستخدم المالك (افتراضياً "odoo"، ويمكن تغييره عبر MANAGE_USERNAME). */
function getUsername(): string {
  return process.env.MANAGE_USERNAME?.trim() || "odoo"
}

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7

/** الإنتاج بلا كلمة مرور: نرفض كل شيء بدل ترك اللوحة مفتوحة. */
function failClosed(): boolean {
  return getPassword() === null && process.env.NODE_ENV === "production"
}

/** السر المستخدم لتوقيع الجلسات. تغييره يُبطل كل الجلسات. */
function getSecret(): string {
  const dedicated = process.env.MANAGE_SESSION_SECRET?.trim() || process.env.SESSION_SECRET?.trim()
  if (dedicated && dedicated.length >= 16) return dedicated
  return getPassword() ?? "manage-dev-secret"
}

/** هل الحماية مفعّلة (أي تم ضبط كلمة مرور)؟ */
export function isManageProtected(): boolean {
  return getPassword() !== null
}

function signUser(username: string, expires: number): string {
  return createHmac("sha256", getSecret()).update(`user:${username}:${expires}`).digest("hex")
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

/** اسم المستخدم المعروض/المطلوب في نموذج تسجيل الدخول. */
export function getManageUsername(): string {
  return getUsername()
}

/** تحقّق من كلمة مرور المالك المُدخلة. */
export function verifyPassword(input: string): boolean {
  const password = getPassword()
  if (!password) return !failClosed()
  return safeEqual(input, password)
}

/**
 * تحقّق من بيانات الدخول ويعيد اسم المستخدم عند النجاح، أو null عند الفشل.
 * يفحص حساب المالك أولاً ثم المستخدمين المخزَّنين داخل اللوحة.
 */
export async function authenticate(username: string, password: string): Promise<string | null> {
  if (typeof username !== "string" || typeof password !== "string") return null
  const uname = username.trim()
  if (!uname) return null

  // وضع التطوير فقط: لا كلمة مرور مضبوطة => السماح بالدخول. في الإنتاج يُرفض كل دخول.
  if (!getPassword()) return failClosed() ? null : uname

  // حساب المالك من متغيرات البيئة.
  if (safeEqual(uname.toLowerCase(), getUsername().toLowerCase()) && verifyPassword(password)) {
    return getUsername()
  }

  // مستخدم مُخزّن داخل اللوحة.
  return verifyStoredUser(uname, password)
}

/** يضبط كوكي الجلسة بعد نجاح تسجيل الدخول لمستخدم محدّد. */
export async function createManageSession(username: string): Promise<void> {
  if (!getPassword()) return
  const store = await cookies()
  const expires = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS
  const token = `${Buffer.from(username).toString("base64url")}.${expires}.${signUser(username, expires)}`
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  })
}

/** يحذف كوكي الجلسة (تسجيل الخروج). */
export async function destroyManageSession(): Promise<void> {
  const store = await cookies()
  store.delete(COOKIE_NAME)
}

/** يعيد اسم المستخدم الحالي من كوكي الجلسة إن كانت صالحة وغير منتهية، أو null. */
export async function getManageSessionUser(): Promise<string | null> {
  if (failClosed()) return null
  if (!getPassword()) return getUsername()
  const store = await cookies()
  const token = store.get(COOKIE_NAME)?.value
  const parts = token?.split(".") ?? []
  if (parts.length !== 3) return null
  const [encoded, expiresRaw, sig] = parts
  const expires = Number(expiresRaw)
  if (!Number.isInteger(expires) || expires < Math.floor(Date.now() / 1000)) return null
  let username: string
  try {
    username = Buffer.from(encoded, "base64url").toString("utf8")
  } catch {
    return null
  }
  if (!username || !safeEqual(sig, signUser(username, expires))) return null
  // مستخدم مُخزَّن: يجب أن يبقى موجوداً ونشطاً (إيقافه يُنهي جلسته فوراً).
  if (username.toLowerCase() !== getUsername().toLowerCase()) {
    const stored = await findUserByUsername(username)
    if (!stored || stored.active === false) return null
  }
  return username
}

/** هل المستخدم الحالي مصرّح له بالدخول للوحة؟ */
export async function isManageAuthenticated(): Promise<boolean> {
  if (failClosed()) return false
  if (!getPassword()) return true
  return (await getManageSessionUser()) !== null
}

/** يرمي خطأً إذا لم يكن المستخدم مصرّحاً له — يُستدعى قبل كل عملية كتابة. */
export async function assertManageAuthenticated(): Promise<void> {
  if (!(await isManageAuthenticated())) {
    throw new Error("غير مصرّح. سجّل الدخول للوحة الإدارة أولاً.")
  }
}

// أسماء بديلة تستخدمها صفحات اللوحة.
export const isManageAuthed = isManageAuthenticated
export async function isManageConfigured(): Promise<boolean> {
  return isManageProtected()
}
