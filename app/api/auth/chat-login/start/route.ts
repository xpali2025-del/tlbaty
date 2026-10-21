import { NextResponse } from "next/server"
import { buildChatLink, CHALLENGE_TTL_SECONDS, startChallenge } from "@/lib/otp/chat-login"
import { isAuthConfigured } from "@/lib/otp/config"
import { consumeChallengeStart } from "@/lib/otp/rate-limit"
import { getClientContext } from "@/lib/otp/request-context"

export const runtime = "nodejs"

/** يبدأ الدخول بنقرة واتساب: يعيد رابط wa.me برسالة جاهزة ويربط التحدّي بهذا المتصفح. */
export async function POST(req: Request) {
  if (!isAuthConfigured() || !buildChatLink("AAAAAA")) {
    return NextResponse.json({ ok: false, error: "AUTH_NOT_CONFIGURED" }, { status: 503 })
  }
  const { ip, userAgent } = getClientContext(req)
  if (!(await consumeChallengeStart(ip))) {
    return NextResponse.json({ ok: false, error: "RATE_LIMITED" }, { status: 429 })
  }
  const { token } = await startChallenge({ ip, userAgent })
  return NextResponse.json({ ok: true, token, link: buildChatLink(token), expiresIn: CHALLENGE_TTL_SECONDS })
}
