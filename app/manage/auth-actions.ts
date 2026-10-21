"use server"

import { authenticate, createManageSession, destroyManageSession } from "@/lib/manage-auth"

/**
 * تسجيل الدخول للوحة الإدارة. يُعيد رسالة خطأ عند فشل التحقق، ولا يُعيد التوجيه
 * حتى تتولى الواجهة (login-form) الانتقال بعد نجاح العملية.
 * يتحقّق من حساب المالك أو أي مستخدم مُضاف من داخل اللوحة.
 */
export async function login(username: string, password: string): Promise<{ error?: string }> {
  const resolved = await authenticate(username, password)
  if (!resolved) {
    return { error: "اسم المستخدم أو كلمة المرور غير صحيحة" }
  }
  await createManageSession(resolved)
  return {}
}

/** تسجيل الخروج بحذف كوكي الجلسة. */
export async function logout(): Promise<void> {
  await destroyManageSession()
}
