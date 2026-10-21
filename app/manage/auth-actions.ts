"use server"

import { headers } from "next/headers"
import { authenticate, createManageSession, destroyManageSession } from "@/lib/manage-auth"
import { hitRateLimit } from "@/lib/rate-limit-memory"

/**
 * تسجيل الدخول للوحة الإدارة. يُعيد رسالة خطأ عند فشل التحقق، ولا يُعيد التوجيه
 * حتى تتولى الواجهة (login-form) الانتقال بعد نجاح العملية.
 * يتحقّق من حساب المالك أو أي مستخدم مُضاف من داخل اللوحة.
 */
export async function login(username: string, password: string): Promise<{ error?: string }> {
  // كبح التخمين: محاولات محدودة لكل عنوان ولكل اسم مستخدم (في الذاكرة لكل نسخة خادم).
  const h = await headers()
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown"
  const name = typeof username === "string" ? username.trim().toLowerCase().slice(0, 64) : ""
  if (hitRateLimit(`manage-login:ip:${ip}`, 20, 15 * 60_000) || hitRateLimit(`manage-login:user:${name}`, 8, 15 * 60_000)) {
    return { error: "محاولات كثيرة. انتظر 15 دقيقة ثم أعد المحاولة." }
  }
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
