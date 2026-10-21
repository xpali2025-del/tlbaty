import { NextResponse } from "next/server"
import { logAuthEvent } from "@/lib/otp/audit"
import { getClientContext } from "@/lib/otp/request-context"
import { destroyCurrentSession, resolveSession, revokeAllSessions } from "@/lib/otp/session"

export const runtime = "nodejs"

/** body.all === true: كل أجهزة الحساب؛ غير ذلك: الجلسة الحالية فقط. */
export async function POST(req: Request) {
  const { ip, userAgent } = getClientContext(req)
  let all = false
  try {
    all = ((await req.json()) as { all?: unknown })?.all === true
  } catch {
    // بلا جسم = خروج من هذا الجهاز فقط.
  }

  // نقرأ الجلسة قبل إبطالها لتسجيلها في التدقيق.
  const resolved = await resolveSession().catch(() => null)
  const customerId = resolved?.customer.id
  if (all && customerId) {
    await revokeAllSessions(customerId)
    await logAuthEvent({ event: "logout_all", customerId, ip, userAgent })
  } else {
    await destroyCurrentSession()
    await logAuthEvent({ event: "logout", customerId, ip, userAgent })
  }
  return NextResponse.json({ ok: true })
}
