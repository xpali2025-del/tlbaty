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
 * إعادة إرسال الرمز — نفس منطق الإرسال مع احترام مؤقت إعادة الإرسال.
 * يقبل الغرض (login افتراضياً أو change_phone) لإعادة الإرسال في التدفق الصحيح.
 */
export async function POST(req: Request) {
  if (!isAuthConfigured() || !hasClient()) {
    return NextResponse.json({ ok: false, error: "AUTH_NOT_CONFIGURED" }, { status: 503 })
  }

  let body: { phone?: unknown; purpose?: unknown }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ ok: false, error: "INVALID_JSON" }, { status: 400 })
  }

  const phone = normalizeAndValidateLocalPhone(body.phone)
  if (!phone) {
    return NextResponse.json({ ok: false, error: "INVALID_PHONE" }, { status: 400 })
  }

  const purpose = body.purpose === "change_phone" ? "change_phone" : "login"
  const { ip, userAgent } = getClientContext(req)

  const allowed = await consumeSendAttempt(phone, ip)
  if (!allowed) {
    await logAuthEvent({ event: "rate_limited", phone, ip, userAgent, detail: "resend" })
    return NextResponse.json({ ok: false, error: "RATE_LIMITED" }, { status: 429 })
  }

  const result = await createAndSendOtp({ phone, purpose, ip, userAgent })

  if (!result.ok) {
    if (result.error === "RESEND_TOO_SOON") {
      return NextResponse.json(
        { ok: false, error: "RESEND_TOO_SOON", retryAfter: result.retryAfter },
        { status: 429 },
      )
    }
    return NextResponse.json({ ok: false, error: "SEND_FAILED" }, { status: 502 })
  }

  await logAuthEvent({ event: "otp_resent", phone, ip, userAgent, detail: result.provider })

  return NextResponse.json({ ok: true, resendAfter: OTP_RESEND })
}
