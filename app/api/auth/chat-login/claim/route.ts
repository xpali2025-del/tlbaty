import { NextResponse } from "next/server"
import { claimChallenge, isClaimable, isWorkerAuthorized, TOKEN_PATTERN } from "@/lib/otp/chat-login"
import { isAuthConfigured } from "@/lib/otp/config"
import { logAuthEvent } from "@/lib/otp/audit"
import { issueOtpForReply } from "@/lib/otp/generate"
import { consumeSendAttempt } from "@/lib/otp/rate-limit"
import { normalizeInternationalPhone } from "@/lib/phone"
import { isLoginCountryAllowed } from "@/lib/otp/countries"

export const runtime = "nodejs"

/**
 * تستدعيه خدمة واتساب فقط (Bearer) عندما يراسل العميل رقمك برمز الطلب.
 * الرقم هنا هو رقم المُرسِل كما أثبته واتساب، فلا يمكن انتحاله من المتصفح.
 * الرد يحمل نص الرسالة التي سترسلها الخدمة للعميل داخل المحادثة نفسها.
 */
export async function POST(req: Request) {
  if (!isWorkerAuthorized(req)) return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 })
  if (!isAuthConfigured()) return NextResponse.json({ ok: false, error: "AUTH_NOT_CONFIGURED" }, { status: 503 })

  let body: { phone?: unknown; token?: unknown }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ ok: false, error: "INVALID_JSON" }, { status: 400 })
  }
  const phone = typeof body.phone === "string" ? body.phone : ""
  const token = typeof body.token === "string" ? body.token.toUpperCase() : ""
  if (!phone || normalizeInternationalPhone(phone) !== phone) return NextResponse.json({ ok: false, error: "INVALID_PHONE" }, { status: 400 })
  if (!TOKEN_PATTERN.test(token)) return NextResponse.json({ ok: false, error: "INVALID_TOKEN" }, { status: 400 })
  // دولة الرقم غير مفعّلة للدخول: نرفض قبل أي إرسال (العامل لا يرد على المرسل عند أي خطأ).
  if (!(await isLoginCountryAllowed(phone))) return NextResponse.json({ ok: false, error: "COUNTRY_NOT_ALLOWED" }, { status: 403 })

  // رمز غير معروف أو مستخدم أو منتهٍ: نرفض قبل أن نستهلك حصة الإرسال لهذا الرقم.
  if (!(await isClaimable(token))) {
    return NextResponse.json({ ok: false, error: "UNKNOWN_OR_USED_TOKEN" }, { status: 404 })
  }

  const ctx = { ip: "worker", userAgent: "whatsapp-worker" }
  if (!(await consumeSendAttempt(phone, "unknown"))) {
    await logAuthEvent({ event: "rate_limited", phone, ...ctx, detail: "claim" })
    return NextResponse.json({ ok: false, error: "RATE_LIMITED" }, { status: 429 })
  }

  // نتحقق من الانتظار قبل ربط التحدّي، فلا يُحرَق الرمز إن كان العميل ما زال في فترة الانتظار.
  const issued = await issueOtpForReply({ phone, purpose: "login", ...ctx })
  if (!issued.ok) {
    return NextResponse.json({ ok: false, error: issued.error, retryAfter: issued.retryAfter }, { status: 429 })
  }

  const claimed = await claimChallenge(token, phone)
  if (!claimed) {
    return NextResponse.json({ ok: false, error: "UNKNOWN_OR_USED_TOKEN" }, { status: 404 })
  }
  await logAuthEvent({ event: "otp_sent", phone, ...ctx, detail: "whatsapp-reply" })
  return NextResponse.json({ ok: true, text: issued.message })
}
