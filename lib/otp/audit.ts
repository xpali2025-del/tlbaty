import "server-only"
import { db } from "@/lib/db/client"
import { authEvents } from "@/lib/db/store"

export type AuthEvent = (typeof authEvents.$inferInsert)["event"]

/** تسجيل حدث مصادقة. أفضل جهد: لا يعطّل الطلب عند الفشل. */
export async function logAuthEvent(input: {
  event: AuthEvent
  phone?: string
  customerId?: string
  ip?: string
  userAgent?: string
  detail?: string
}): Promise<void> {
  try {
    await db.insert(authEvents).values({
      event: input.event,
      phone: input.phone,
      customerId: input.customerId,
      ip: input.ip,
      userAgent: input.userAgent?.slice(0, 300),
      detail: input.detail,
    })
  } catch {
    // التدقيق لا يجب أن يكسر تسجيل الدخول.
  }
}
