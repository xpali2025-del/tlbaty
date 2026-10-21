import { NextResponse } from "next/server"
import { maskPhone, normalizeInternationalPhone } from "@/lib/phone"
import { isAuthConfigured, OTP_RESEND } from "@/lib/otp/config"
import { getCustomerByPhone, updateCustomerPhone } from "@/lib/otp/store"
import { consumeSendAttempt, consumeVerifyAttempt } from "@/lib/otp/rate-limit"
import { createAndSendOtp } from "@/lib/otp/generate"
import { verifyOtp } from "@/lib/otp/verify"
import { resolveSession } from "@/lib/otp/session"
import { logAuthEvent } from "@/lib/otp/audit"
import { getClientContext } from "@/lib/otp/request-context"

export const runtime = "nodejs"

function cleanCode(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "").slice(0, 8)
}

/**
 * تغيير رقم هاتف العميل مع الاحتفاظ بنفس معرّف العميل وكل طلباته.
 * محمي بالجلسة، وتدفّق من خطوتين: step=send ثم step=verify.
 */
export async function POST(req: Request) {
  if (!isAuthConfigured()) {
    return NextResponse.json({ ok: false, error: "AUTH_NOT_CONFIGURED" }, { status: 503 })
  }

  // معرّف العميل يأتي من الجلسة على الخادم فقط — لا يُقبل من العميل.
  const resolved = await resolveSession().catch(() => null)
  if (!resolved) {
    return NextResponse.json({ ok: false, error: "AUTH_REQUIRED" }, { status: 401 })
  }
  const customer = resolved.customer

  let body: { step?: unknown; phone?: unknown; code?: unknown }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ ok: false, error: "INVALID_JSON" }, { status: 400 })
  }

  const newPhone = normalizeInternationalPhone(body.phone)
  if (!newPhone) {
    return NextResponse.json({ ok: false, error: "INVALID_PHONE" }, { status: 400 })
  }
  if (newPhone === customer.phone) {
    return NextResponse.json({ ok: false, error: "SAME_PHONE" }, { status: 400 })
  }

  const { ip, userAgent } = getClientContext(req)
  const step = body.step === "verify" ? "verify" : "send"

  // الرقم الجديد يجب ألا يكون مسجّلاً لعميل آخر.
  const existing = await getCustomerByPhone(newPhone)
  if (existing && existing.id !== customer.id) {
    return NextResponse.json({ ok: false, error: "PHONE_IN_USE" }, { status: 409 })
  }

  if (step === "send") {
    const allowed = await consumeSendAttempt(newPhone, ip)
    if (!allowed) {
      await logAuthEvent({ event: "rate_limited", phone: newPhone, customerId: customer.id, ip, userAgent, detail: "change_phone_send" })
      return NextResponse.json({ ok: false, error: "RATE_LIMITED" }, { status: 429 })
    }

    const result = await createAndSendOtp({ phone: newPhone, purpose: "change_phone", ip, userAgent })
    if (!result.ok) {
      if (result.error === "RESEND_TOO_SOON") {
        return NextResponse.json(
          { ok: false, error: "RESEND_TOO_SOON", retryAfter: result.retryAfter },
          { status: 429 },
        )
      }
      return NextResponse.json({ ok: false, error: "SEND_FAILED" }, { status: 502 })
    }

    await logAuthEvent({ event: "otp_sent", phone: newPhone, customerId: customer.id, ip, userAgent, detail: "change_phone" })
    return NextResponse.json({ ok: true, resendAfter: OTP_RESEND })
  }

  // step === verify
  const code = cleanCode(body.code)
  if (!code) {
    return NextResponse.json({ ok: false, error: "INVALID_CODE" }, { status: 400 })
  }

  const allowed = await consumeVerifyAttempt(newPhone)
  if (!allowed) {
    return NextResponse.json({ ok: false, error: "TOO_MANY_ATTEMPTS" }, { status: 429 })
  }

  const result = await verifyOtp({ phone: newPhone, purpose: "change_phone", code })
  if (!result.ok) {
    if (result.error === "EXPIRED") {
      await logAuthEvent({ event: "otp_expired", phone: newPhone, customerId: customer.id, ip, userAgent })
    } else if (result.error !== "NO_CODE") {
      await logAuthEvent({ event: "otp_failed", phone: newPhone, customerId: customer.id, ip, userAgent, detail: result.error })
    }
    const status = result.error === "TOO_MANY_ATTEMPTS" ? 429 : 400
    return NextResponse.json(
      {
        ok: false,
        error: result.error,
        ...(result.error === "INVALID_CODE" ? { remaining: result.remaining } : {}),
      },
      { status },
    )
  }

  // إعادة فحص التعارض قبل الكتابة (سباق نادر).
  const conflict = await getCustomerByPhone(newPhone)
  if (conflict && conflict.id !== customer.id) {
    return NextResponse.json({ ok: false, error: "PHONE_IN_USE" }, { status: 409 })
  }

  await updateCustomerPhone(customer.id, customer.phone, newPhone)
  await logAuthEvent({
    event: "phone_changed",
    phone: newPhone,
    customerId: customer.id,
    ip,
    userAgent,
    detail: `from ${customer.phone}`,
  })

  return NextResponse.json({ ok: true, phoneMasked: maskPhone(newPhone) })
}
