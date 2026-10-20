import "server-only"

import { ordersClient } from "@/sanity/orders/client"

// ============================================
// سجل تدقيق المصادقة — يكتب حدثاً لكل عملية حساسة.
// الكتابة "أفضل جهد": فشل التسجيل لا يعطّل تسجيل الدخول إطلاقاً.
// ============================================

export type AuthEvent =
  | "otp_sent"
  | "otp_resent"
  | "otp_verified"
  | "otp_failed"
  | "otp_expired"
  | "rate_limited"
  | "account_created"
  | "login"
  | "logout"
  | "logout_all"
  | "phone_changed"

export async function logAuthEvent(input: {
  event: AuthEvent
  phone?: string
  customerId?: string
  ip?: string
  userAgent?: string
  detail?: string
}): Promise<void> {
  if (!ordersClient) return
  try {
    await ordersClient.create(
      {
        _type: "authEvent",
        event: input.event,
        phone: input.phone ?? "",
        customerId: input.customerId ?? "",
        ip: input.ip ?? "",
        userAgent: (input.userAgent ?? "").slice(0, 300),
        detail: input.detail ?? "",
        at: new Date().toISOString(),
      },
      { visibility: "async" },
    )
  } catch {
    // لا نكشف تفاصيل ولا نعطّل التدفق عند فشل التدقيق.
  }
}
