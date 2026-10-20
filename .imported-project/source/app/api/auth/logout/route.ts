import { NextResponse } from "next/server"
import { destroyCurrentSession, resolveSession, revokeAllSessions } from "@/lib/otp/session"
import { logAuthEvent } from "@/lib/otp/audit"
import { getClientContext } from "@/lib/otp/request-context"

export const runtime = "nodejs"

/**
 * تسجيل الخروج.
 * body.all === true ← إلغاء جميع جلسات الحساب (كل الأجهزة).
 * غير ذلك ← إلغاء الجلسة الحالية وحذف الكوكي فقط.
 */
export async function POST(req: Request) {
  const { ip, userAgent } = getClientContext(req)

  let all = false
  try {
    const body = (await req.json()) as { all?: unknown }
    all = body?.all === true
  } catch {
    // بلا جسم = خروج من هذا الجهاز فقط.
  }

  // نقرأ الجلسة قبل إبطالها لتسجيلها في التدقيق.
  const resolved = await resolveSession().catch(() => null)
  const customerId = resolved?.customer.customerId

  if (all && customerId) {
    await revokeAllSessions(customerId)
    await logAuthEvent({ event: "logout_all", customerId, ip, userAgent })
  } else {
    await destroyCurrentSession()
    await logAuthEvent({ event: "logout", customerId, ip, userAgent })
  }

  return NextResponse.json({ ok: true })
}
