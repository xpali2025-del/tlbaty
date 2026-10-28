import { NextResponse } from "next/server"
import { normalizeInternationalPhone } from "@/lib/phone"
import { isLoginCountryAllowed } from "@/lib/otp/countries"
import { isAuthConfigured, OTP_RESEND } from "@/lib/otp/config"
import { consumeSendAttempt } from "@/lib/otp/rate-limit"
import { createAndSendOtp } from "@/lib/otp/generate"
import { logAuthEvent } from "@/lib/otp/audit"
import { getClientContext } from "@/lib/otp/request-context"
import { resolveSession } from "@/lib/otp/session"
import { getCustomerByPhone } from "@/lib/otp/store"

export const runtime = "nodejs"

/**
 * إعادة إرسال الرمز — نفس منطق الإرسال مع احترام مؤقت إعادة الإرسال.
 * يقبل الغرض (login افتراضياً أو change_phone) لإعادة الإرسال في التدفق الصحيح.
 */
export async function POST(req: Request) {
  if (!isAuthConfigured()) {
    return NextResponse.json({ ok: false, error: "AUTH_NOT_CONFIGURED" }, { status: 503 })
  }

  let body: { phone?: unknown; purpose?: unknown }
  try {
    const parsed: unknown = await req.json()
    if (typeof parsed !== "object" || parsed === null) throw new Error("not an object")
    body = parsed as typeof body
  } catch {
    return NextResponse.json({ ok: false, error: "INVALID_JSON" }, { status: 400 })
  }

  const phone = normalizeInternationalPhone(body.phone)
  if (!phone) {
    return NextResponse.json({ ok: false, error: "INVALID_PHONE" }, { status: 400 })
  }
  if (!(await isLoginCountryAllowed(phone))) {
    return NextResponse.json({ ok: false, error: "COUNTRY_NOT_ALLOWED" }, { status: 403 })
  }

  const purpose = body.purpose === "change_phone" ? ("change_phone" as const) : ("login" as const)
  // رمز تغيير الرقم بنفس شروط /api/auth/change-phone: صاحب جلسة، والرقم ليس رقمه الحالي ولا مسجّلاً لعميل آخر.
  // وإلا أمكن إرسال رسائل لأي رقم (حتى أرقام عملاء آخرين) بهذا الغرض.
  if (purpose === "change_phone") {
    const resolved = await resolveSession().catch(() => null)
    if (!resolved) return NextResponse.json({ ok: false, error: "AUTH_REQUIRED" }, { status: 401 })
    if (phone === resolved.customer.phone) return NextResponse.json({ ok: false, error: "SAME_PHONE" }, { status: 400 })
    const existing = await getCustomerByPhone(phone)
    if (existing && existing.id !== resolved.customer.id) return NextResponse.json({ ok: false, error: "PHONE_IN_USE" }, { status: 409 })
  }
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
