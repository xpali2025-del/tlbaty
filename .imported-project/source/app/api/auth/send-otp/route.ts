import { NextResponse } from "next/server"
import { normalizeAndValidateLocalPhone } from "@/lib/phone"
import { isAuthConfigured, OTP_RESEND } from "@/lib/otp/config"
import { hasClient } from "@/lib/otp/store"
import { consumeSendAttempt } from "@/lib/otp/rate-limit"
import { createAndSendOtp } from "@/lib/otp/generate"
import { logAuthEvent } from "@/lib/otp/audit"
import { getClientContext } from "@/lib/otp/request-context"

export const runtime = "nodejs"

/**
 * إرسال رمز تسجيل الدخول.
 * لا نكشف إن كان الرقم مسجّلاً مسبقاً — الرد موحّد لمنع تعداد الحسابات.
 */
export async function POST(req: Request) {
  if (!isAuthConfigured() || !hasClient()) {
    return NextResponse.json({ ok: false, error: "AUTH_NOT_CONFIGURED" }, { status: 503 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: "INVALID_JSON" }, { status: 400 })
  }

  const phoneRaw = typeof body === "object" && body !== null ? (body as { phone?: unknown }).phone : ""
  const phone = normalizeAndValidateLocalPhone(phoneRaw)
  if (!phone) {
    return NextResponse.json({ ok: false, error: "INVALID_PHONE" }, { status: 400 })
  }

  const { ip, userAgent } = getClientContext(req)

  const allowed = await consumeSendAttempt(phone, ip)
  if (!allowed) {
    await logAuthEvent({ event: "rate_limited", phone, ip, userAgent, detail: "send" })
    return NextResponse.json({ ok: false, error: "RATE_LIMITED" }, { status: 429 })
  }

  const result = await createAndSendOtp({ phone, purpose: "login", ip, userAgent })

  if (!result.ok) {
    if (result.error === "RESEND_TOO_SOON") {
      return NextResponse.json(
        { ok: false, error: "RESEND_TOO_SOON", retryAfter: result.retryAfter },
        { status: 429 },
      )
    }
    return NextResponse.json({ ok: false, error: "SEND_FAILED" }, { status: 502 })
  }

  await logAuthEvent({ event: "otp_sent", phone, ip, userAgent, detail: result.provider })

  return NextResponse.json({ ok: true, resendAfter: OTP_RESEND })
}
