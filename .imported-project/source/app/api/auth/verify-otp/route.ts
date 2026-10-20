import { NextResponse } from "next/server"
import { normalizeAndValidateLocalPhone } from "@/lib/phone"
import { isAuthConfigured } from "@/lib/otp/config"
import { hasClient, getCustomerByPhone, createCustomer, touchLastLogin } from "@/lib/otp/store"
import { consumeVerifyAttempt } from "@/lib/otp/rate-limit"
import { verifyOtp } from "@/lib/otp/verify"
import { createSession } from "@/lib/otp/session"
import { logAuthEvent } from "@/lib/otp/audit"
import { getClientContext } from "@/lib/otp/request-context"

export const runtime = "nodejs"

/** يقبل فقط مسارات داخلية آمنة لإعادة التوجيه بعد الدخول. */
function safeNext(value: unknown): string {
  if (typeof value !== "string") return "/"
  if (!value.startsWith("/") || value.startsWith("//")) return "/"
  return value.slice(0, 512)
}

/** ينظّف الرمز المُدخل إلى أرقام فقط. */
function cleanCode(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "").slice(0, 8)
}

export async function POST(req: Request) {
  if (!isAuthConfigured() || !hasClient()) {
    return NextResponse.json({ ok: false, error: "AUTH_NOT_CONFIGURED" }, { status: 503 })
  }

  let body: { phone?: unknown; code?: unknown; next?: unknown }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ ok: false, error: "INVALID_JSON" }, { status: 400 })
  }

  const phone = normalizeAndValidateLocalPhone(body.phone)
  if (!phone) {
    return NextResponse.json({ ok: false, error: "INVALID_PHONE" }, { status: 400 })
  }

  const code = cleanCode(body.code)
  if (!code) {
    return NextResponse.json({ ok: false, error: "INVALID_CODE" }, { status: 400 })
  }

  const { ip, userAgent } = getClientContext(req)

  // قفل مؤقت ضد التخمين المكثّف.
  const allowed = await consumeVerifyAttempt(phone)
  if (!allowed) {
    await logAuthEvent({ event: "rate_limited", phone, ip, userAgent, detail: "verify" })
    return NextResponse.json({ ok: false, error: "TOO_MANY_ATTEMPTS" }, { status: 429 })
  }

  const result = await verifyOtp({ phone, purpose: "login", code })

  if (!result.ok) {
    if (result.error === "EXPIRED") {
      await logAuthEvent({ event: "otp_expired", phone, ip, userAgent })
    } else if (result.error !== "NO_CODE") {
      await logAuthEvent({ event: "otp_failed", phone, ip, userAgent, detail: result.error })
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

  await logAuthEvent({ event: "otp_verified", phone, ip, userAgent })

  // إنشاء العميل عند غيابه، أو تحديث آخر تسجيل دخول إن كان موجوداً.
  let customer = await getCustomerByPhone(phone)
  if (!customer) {
    customer = await createCustomer(phone)
    await logAuthEvent({ event: "account_created", phone, customerId: customer.customerId, ip, userAgent })
  } else {
    if (customer.status === "blocked") {
      return NextResponse.json({ ok: false, error: "ACCOUNT_BLOCKED" }, { status: 403 })
    }
    await touchLastLogin(customer._id)
  }

  // جلسة آمنة على الخادم — التوكن في كوكي HttpOnly.
  await createSession({ customerId: customer.customerId, ip, userAgent })
  await logAuthEvent({ event: "login", phone, customerId: customer.customerId, ip, userAgent })

  return NextResponse.json({ ok: true, redirect: safeNext(body.next) })
}
