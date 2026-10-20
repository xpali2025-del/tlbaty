import "server-only"

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto"
import { client } from "@/sanity/client"

// ============================================
// إدارة مستخدمي لوحة التحكم (/manage)
// حسابات تسجيل الدخول تُخزَّن في قاعدة المحتوى، وكلمات المرور مُجزّأة بـ scrypt.
// هذا الملف server-only ولا يُستورد أبداً في كود العميل.
// ============================================

export type AdminUser = {
  _id: string
  username: string
  name?: string
  role: "admin" | "editor"
  active: boolean
}

// السجل الداخلي يتضمن التجزئة — لا يُرسل للعميل مطلقاً.
type StoredUser = AdminUser & { passwordHash?: string }

const USERS_QUERY = /* groq */ `*[_type == "manageUser"] | order(username asc){
  _id, username, name, "role": coalesce(role, "editor"), "active": coalesce(active, true)
}`

const USER_BY_NAME_QUERY = /* groq */ `*[_type == "manageUser" && lower(username) == $username][0]{
  _id, username, name, "role": coalesce(role, "editor"), "active": coalesce(active, true), passwordHash
}`

/** يُجزّئ كلمة المرور بـ scrypt مع ملح عشوائي. الصيغة: "salt:hash" (hex). */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex")
  const hash = scryptSync(password, salt, 64).toString("hex")
  return `${salt}:${hash}`
}

/** يتحقّق من كلمة المرور مقابل تجزئة مُخزّنة بأمان (ثابت الزمن). */
export function verifyPasswordHash(password: string, stored?: string): boolean {
  if (!stored || !stored.includes(":")) return false
  const [salt, hash] = stored.split(":")
  try {
    const expected = Buffer.from(hash, "hex")
    const actual = scryptSync(password, salt, 64)
    return expected.length === actual.length && timingSafeEqual(expected, actual)
  } catch {
    return false
  }
}

/** يعيد قائمة المستخدمين (بدون كلمات المرور) لعرضها في اللوحة. */
export async function getAdminUsers(): Promise<AdminUser[]> {
  if (!client) return []
  const rows = await client.fetch<StoredUser[]>(USERS_QUERY, {}, { cache: "no-store" })
  return rows.map(({ passwordHash: _hash, ...rest }) => rest)
}

/** يبحث عن مستخدم بالاسم (يشمل التجزئة) للتحقق عند تسجيل الدخول. */
export async function findUserByUsername(username: string): Promise<StoredUser | null> {
  if (!client) return null
  return client.fetch<StoredUser | null>(
    USER_BY_NAME_QUERY,
    { username: username.trim().toLowerCase() },
    { cache: "no-store" },
  )
}

/** يتحقّق من بيانات مستخدم مُخزّن ويعيد اسمه عند النجاح، أو null. */
export async function verifyStoredUser(username: string, password: string): Promise<string | null> {
  const user = await findUserByUsername(username)
  if (!user || user.active === false) return null
  if (!verifyPasswordHash(password, user.passwordHash)) return null
  return user.username
}
