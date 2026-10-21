import { NextResponse } from "next/server"
import { isAuthConfigured } from "@/lib/otp/config"
import { logAuthEvent } from "@/lib/otp/audit"
import { consumeVerifyAttempt } from "@/lib/otp/rate-limit"
import { getClientContext } from "@/lib/otp/request-context"
import { completeLogin } from "@/lib/otp/login"
import { verifyOtp } from "@/lib/otp/verify"
import { normalizeInternationalPhone } from "@/lib/phone"

export const runtime = "nodejs"

/** يقبل فقط مسارات داخلية آمنة لإعادة التوجيه بعد الدخول. */
function safeNext(value: unknown): string {
  if (typeof value !== "string") return "/"
  if (!value.startsWith("/") || value.startsWith("//")) return "/"
  return value.slice(0, 512)
}

const cleanCode = (value: unknown) => String(value ?? "").replace(/\D/g, "").slice(0, 8)

export async function POST(req: Request) {
  if (!isAuthConfigured()) {
    return NextResponse.json({ ok: false, error: "AUTH_NOT_CONFIGURED" }, { status: 503 })
  }

  let body: { phone?: unknown; code?: unknown; next?: unknown }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ ok: false, error: "INVALID_JSON" }, { status: 400 })
  }

  const phone = normalizeInternationalPhone(body.phone)
  if (!phone) return NextResponse.json({ ok: false, error: "INVALID_PHONE" }, { status: 400 })
  const code = cleanCode(body.code)
  if (!code) return NextResponse.json({ ok: false, error: "INVALID_CODE" }, { status: 400 })

  const { ip, userAgent } = getClientContext(req)
  if (!(await consumeVerifyAttempt(phone))) {
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
    return NextResponse.json(
      { ok: false, error: result.error, ...(result.error === "INVALID_CODE" ? { remaining: result.remaining } : {}) },
      { status: result.error === "TOO_MANY_ATTEMPTS" ? 429 : 400 },
    )
  }
  await logAuthEvent({ event: "otp_verified", phone, ip, userAgent })

  const login = await completeLogin({ phone, ip, userAgent })
  if (!login.ok) return NextResponse.json({ ok: false, error: login.error }, { status: 403 })
  return NextResponse.json({ ok: true, redirect: safeNext(body.next) })
}
