import { NextResponse } from "next/server"
import { isAuthConfigured, OTP_RESEND } from "@/lib/otp/config"
import { logAuthEvent } from "@/lib/otp/audit"
import { createAndSendOtp } from "@/lib/otp/generate"
import { consumeSendAttempt } from "@/lib/otp/rate-limit"
import { getClientContext } from "@/lib/otp/request-context"
import { normalizeInternationalPhone } from "@/lib/phone"

export const runtime = "nodejs"

/** إرسال رمز تسجيل الدخول. الرد موحّد ولا يكشف إن كان الرقم مسجّلاً (منع تعداد الحسابات). */
export async function POST(req: Request) {
  if (!isAuthConfigured()) {
    return NextResponse.json({ ok: false, error: "AUTH_NOT_CONFIGURED" }, { status: 503 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: "INVALID_JSON" }, { status: 400 })
  }
  const phoneRaw = typeof body === "object" && body !== null ? (body as { phone?: unknown }).phone : ""
  const phone = normalizeInternationalPhone(phoneRaw)
  if (!phone) return NextResponse.json({ ok: false, error: "INVALID_PHONE" }, { status: 400 })

  const { ip, userAgent } = getClientContext(req)
  if (!(await consumeSendAttempt(phone, ip))) {
    await logAuthEvent({ event: "rate_limited", phone, ip, userAgent, detail: "send" })
    return NextResponse.json({ ok: false, error: "RATE_LIMITED" }, { status: 429 })
  }

  const result = await createAndSendOtp({ phone, purpose: "login", ip, userAgent })
  if (!result.ok) {
    if (result.error === "RESEND_TOO_SOON") {
      return NextResponse.json({ ok: false, error: "RESEND_TOO_SOON", retryAfter: result.retryAfter }, { status: 429 })
    }
    return NextResponse.json({ ok: false, error: "SEND_FAILED" }, { status: 502 })
  }

  await logAuthEvent({ event: "otp_sent", phone, ip, userAgent, detail: result.provider })
  return NextResponse.json({ ok: true, resendAfter: OTP_RESEND })
}
