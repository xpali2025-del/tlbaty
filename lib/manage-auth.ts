import "server-only"

import { cookies } from "next/headers"
import { createHash, createHmac, timingSafeEqual } from "node:crypto"
import { findUserByUsername, verifyStoredUser } from "@/lib/manage-users"
import { SCREENS, SCREEN_LABELS, type Screen } from "@/lib/permissions"

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

function signUser(username: string, expires: number, fingerprint: string): string {
  return createHmac("sha256", getSecret()).update(`user:${username}:${expires}:${fingerprint}`).digest("hex")
}

const fingerprint = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 16)

/** بصمة الحساب داخل الجلسة: تغيّر كلمة المرور أو حذف الحساب وإعادة إنشائه بالاسم نفسه تُبطل الجلسات القديمة. */
const ownerFingerprint = () => fingerprint(`owner:${getPassword() ?? ""}`)
const storedFingerprint = (id: string, passwordHash?: string) => fingerprint(`${id}:${passwordHash ?? ""}`)

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

  // حساب المالك من متغيرات البيئة. اسمه محجوز: فشل كلمة مرور المالك لا يسقط إلى مستخدم مخزَّن بالاسم نفسه.
  if (safeEqual(uname.toLowerCase(), getUsername().toLowerCase())) {
    return verifyPassword(password) ? getUsername() : null
  }

  // مستخدم مُخزّن داخل اللوحة.
  return verifyStoredUser(uname, password)
}

/** يضبط كوكي الجلسة بعد نجاح تسجيل الدخول لمستخدم محدّد. */
export async function createManageSession(username: string): Promise<void> {
  if (!getPassword()) return
  let fp: string
  if (username.toLowerCase() === getUsername().toLowerCase()) fp = ownerFingerprint()
  else {
    const stored = await findUserByUsername(username)
    if (!stored) throw new Error("المستخدم غير موجود")
    fp = storedFingerprint(stored._id, stored.passwordHash)
  }
  const store = await cookies()
  const expires = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS
  const token = `${Buffer.from(username).toString("base64url")}.${expires}.${fp}.${signUser(username, expires, fp)}`
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

export type ManageContext = {
  username: string
  /** حساب المالك (من متغيرات البيئة) أو وضع التطوير: كل الصلاحيات ولا يمكن تعديله من اللوحة. */
  isOwner: boolean
  permissions: Screen[]
  role: "owner" | "admin" | "manager" | "editor" | "operator"
}

function ownerContext(): ManageContext {
  return { username: getUsername(), isOwner: true, permissions: [...SCREENS], role: "owner" }
}

/** هوية المستخدم الحالي وصلاحياته من كوكي الجلسة (وقاعدة البيانات للمستخدمين المخزَّنين)، أو null. */
export async function getManageContext(): Promise<ManageContext | null> {
  if (failClosed()) return null
  if (!getPassword()) return ownerContext()
  const store = await cookies()
  const token = store.get(COOKIE_NAME)?.value
  const parts = token?.split(".") ?? []
  if (parts.length !== 4) return null
  const [encoded, expiresRaw, fp, sig] = parts
  const expires = Number(expiresRaw)
  if (!Number.isInteger(expires) || expires < Math.floor(Date.now() / 1000)) return null
  let username: string
  try {
    username = Buffer.from(encoded, "base64url").toString("utf8")
  } catch {
    return null
  }
  if (!username || !safeEqual(sig, signUser(username, expires, fp))) return null
  if (username.toLowerCase() === getUsername().toLowerCase()) return safeEqual(fp, ownerFingerprint()) ? ownerContext() : null
  // مستخدم مُخزَّن: يجب أن يبقى موجوداً ونشطاً، وتُقرأ صلاحياته من القاعدة في كل طلب
  // (تعديل الصلاحيات أو الإيقاف يسري فوراً بلا انتظار انتهاء الجلسة).
  const stored = await findUserByUsername(username)
  if (!stored || stored.active === false || !safeEqual(fp, storedFingerprint(stored._id, stored.passwordHash))) return null
  return { username: stored.username, isOwner: false, permissions: stored.permissions, role: stored.role }
}

/** يعيد اسم المستخدم الحالي إن كانت الجلسة صالحة، أو null. */
export async function getManageSessionUser(): Promise<string | null> {
  return (await getManageContext())?.username ?? null
}

/** هل المستخدم الحالي مصرّح له بالدخول للوحة؟ */
export async function isManageAuthenticated(): Promise<boolean> {
  return (await getManageContext()) !== null
}

/** يرمي خطأً إذا لم يكن المستخدم مسجّلاً دخوله. للإجراءات المشتركة بين كل المستخدمين فقط (مثل رفع الصور). */
export async function assertManageAuthenticated(): Promise<ManageContext> {
  const ctx = await getManageContext()
  if (!ctx) throw new Error("غير مصرّح. سجّل الدخول للوحة الإدارة أولاً.")
  return ctx
}

/** يرمي خطأً ما لم يملك المستخدم صلاحية الشاشة — يُستدعى في بداية كل إجراء كتابة. */
export async function assertManagePermission(screen: Screen): Promise<ManageContext> {
  const ctx = await assertManageAuthenticated()
  if (!ctx.permissions.includes(screen)) {
    throw new Error(`ليست لديك صلاحية: ${SCREEN_LABELS[screen]}`)
  }
  return ctx
}

/** هل يملك المستخدم الحالي صلاحية الشاشة؟ (للصفحات: إعادة توجيه بدل رمي خطأ). */
export async function hasManagePermission(screen: Screen): Promise<boolean> {
  return Boolean((await getManageContext())?.permissions.includes(screen))
}

// أسماء بديلة تستخدمها صفحات اللوحة.
export const isManageAuthed = isManageAuthenticated
export async function isManageConfigured(): Promise<boolean> {
  return isManageProtected()
}
