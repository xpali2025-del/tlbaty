import { isRole, normalizePermissions, ROLE_PRESETS, type Role } from "@/lib/permissions"
import { bool, json, str } from "./form"

/**
 * قواعد مستخدم اللوحة التي لا تحتاج جلسة ولا قاعدة بيانات. حجز اسم المالك وصلاحيات المنفّذ
 * وتفرّد الاسم تبقى في الخادم. `isNew`: المستخدم الجديد يحتاج كلمة مرور، والتعديل يتركها فارغة.
 */
export function parseUserForm(form: FormData, opts: { isNew: boolean }) {
  const username = str(form, "username")
  const password = str(form, "password")
  const name = str(form, "name")
  const roleRaw = str(form, "role")
  const role: Role = isRole(roleRaw) ? roleRaw : "editor"
  const permissions = normalizePermissions(json<unknown>(form, "permissions", ROLE_PRESETS[role]))
  const active = bool(form, "active")

  if (!username) throw new Error("اسم المستخدم مطلوب")
  if (!/^[a-zA-Z0-9._-]{3,}$/.test(username)) {
    throw new Error("اسم المستخدم يجب أن يكون 3 أحرف على الأقل (أحرف/أرقام إنجليزية بدون مسافات)")
  }
  if (opts.isNew) {
    if (!password || password.length < 6) throw new Error("كلمة المرور مطلوبة (6 أحرف على الأقل)")
  } else if (password && password.length < 6) {
    throw new Error("كلمة المرور يجب أن تكون 6 أحرف على الأقل")
  }
  return { username, password, name: name ?? null, role, permissions, active }
}
