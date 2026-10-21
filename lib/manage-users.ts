import "server-only"

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto"
import { asc, sql } from "drizzle-orm"
import { db } from "@/lib/db/client"
import { isDbConfigured } from "@/lib/db-cache"
import { manageUsers } from "@/lib/db/store"
import { normalizePermissions, type Role, type Screen } from "@/lib/permissions"

// ============================================
// إدارة مستخدمي لوحة التحكم (/manage)
// حسابات تسجيل الدخول تُخزَّن في قاعدة المحتوى، وكلمات المرور مُجزّأة بـ scrypt.
// هذا الملف server-only ولا يُستورد أبداً في كود العميل.
// ============================================

export type AdminUser = {
  _id: string
  username: string
  name?: string
  role: Role
  permissions: Screen[]
  active: boolean
}

// السجل الداخلي يتضمن التجزئة — لا يُرسل للعميل مطلقاً.
type StoredUser = AdminUser & { passwordHash?: string }

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

const toAdminUser = (u: typeof manageUsers.$inferSelect): AdminUser => ({
  _id: u.id,
  username: u.username,
  name: u.name ?? undefined,
  role: u.role,
  permissions: normalizePermissions(u.permissions),
  active: u.active,
})

/** يعيد قائمة المستخدمين (بدون كلمات المرور) لعرضها في اللوحة. */
export async function getAdminUsers(): Promise<AdminUser[]> {
  if (!isDbConfigured()) return []
  const rows = await db.select().from(manageUsers).orderBy(asc(manageUsers.username))
  return rows.map(toAdminUser)
}

/** يبحث عن مستخدم بالاسم (يشمل التجزئة) للتحقق عند تسجيل الدخول. المقارنة غير حساسة لحالة الأحرف. */
export async function findUserByUsername(username: string): Promise<StoredUser | null> {
  if (!isDbConfigured()) return null
  const [row] = await db
    .select()
    .from(manageUsers)
    .where(sql`lower(${manageUsers.username}) = ${username.trim().toLowerCase()}`)
    .limit(1)
  return row ? { ...toAdminUser(row), passwordHash: row.passwordHash } : null
}

// تجزئة وهمية: عند غياب المستخدم نُجري scrypt أيضاً حتى لا يكشف زمن الاستجابة وجود الاسم.
const DUMMY_HASH = hashPassword("dummy-password-for-timing")
export function verifyDummyPassword(password: string): void {
  verifyPasswordHash(password, DUMMY_HASH)
}

/** يتحقّق من بيانات مستخدم مُخزّن ويعيد اسمه عند النجاح، أو null. */
export async function verifyStoredUser(username: string, password: string): Promise<string | null> {
  const user = await findUserByUsername(username)
  if (!user) {
    verifyDummyPassword(password)
    return null
  }
  if (user.active === false) return null
  if (!verifyPasswordHash(password, user.passwordHash)) return null
  return user.username
}
