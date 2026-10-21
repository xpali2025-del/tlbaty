import { NextResponse } from "next/server"
import { logAuthEvent } from "@/lib/otp/audit"
import { clearChallengeClaim, consumeChallenge, getChallengeForBrowser } from "@/lib/otp/chat-login"
import { isAuthConfigured } from "@/lib/otp/config"
import { completeLogin } from "@/lib/otp/login"
import { consumeVerifyAttempt } from "@/lib/otp/rate-limit"
import { getClientContext } from "@/lib/otp/request-context"
import { verifyOtp } from "@/lib/otp/verify"

export const runtime = "nodejs"

function safeNext(value: unknown): string {
  if (typeof value !== "string") return "/"
  if (!value.startsWith("/") || value.startsWith("//")) return "/"
  return value.slice(0, 512)
}

/** يتحقق من الرمز الذي ردّ به البوت. الرقم يُؤخذ من التحدّي المربوط بالمتصفح، لا من الطلب. */
export async function POST(req: Request) {
  if (!isAuthConfigured()) return NextResponse.json({ ok: false, error: "AUTH_NOT_CONFIGURED" }, { status: 503 })

  let body: { code?: unknown; next?: unknown }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ ok: false, error: "INVALID_JSON" }, { status: 400 })
  }
  const code = String(body.code ?? "").replace(/\D/g, "").slice(0, 8)
  if (!code) return NextResponse.json({ ok: false, error: "INVALID_CODE" }, { status: 400 })

  const challenge = await getChallengeForBrowser()
  if (!challenge) return NextResponse.json({ ok: false, error: "CHALLENGE_EXPIRED" }, { status: 410 })
  if (!challenge.phone) return NextResponse.json({ ok: false, error: "NOT_CLAIMED" }, { status: 409 })
  const phone = challenge.phone

  const { ip, userAgent } = getClientContext(req)
  if (!(await consumeVerifyAttempt(phone))) {
    await logAuthEvent({ event: "rate_limited", phone, ip, userAgent, detail: "verify" })
    return NextResponse.json({ ok: false, error: "TOO_MANY_ATTEMPTS" }, { status: 429 })
  }

  const result = await verifyOtp({ phone, purpose: "login", code })
  if (!result.ok) {
    if (result.error === "EXPIRED") await logAuthEvent({ event: "otp_expired", phone, ip, userAgent })
    else if (result.error !== "NO_CODE") await logAuthEvent({ event: "otp_failed", phone, ip, userAgent, detail: result.error })
    return NextResponse.json(
      { ok: false, error: result.error, ...(result.error === "INVALID_CODE" ? { remaining: result.remaining } : {}) },
      { status: result.error === "TOO_MANY_ATTEMPTS" ? 429 : 400 },
    )
  }
  await logAuthEvent({ event: "otp_verified", phone, ip, userAgent })

  // الاستهلاك ذرّي: لا ينجح طلبان متزامنان على التحدّي نفسه.
  if (!(await consumeChallenge(challenge.id))) {
    return NextResponse.json({ ok: false, error: "CHALLENGE_EXPIRED" }, { status: 410 })
  }
  await clearChallengeClaim()

  const login = await completeLogin({ phone, ip, userAgent })
  if (!login.ok) return NextResponse.json({ ok: false, error: login.error }, { status: 403 })
  return NextResponse.json({ ok: true, redirect: safeNext(body.next) })
}
