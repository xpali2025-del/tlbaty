import "server-only"
import { OTP_MAX_ATTEMPTS } from "./config"
import { verifyOtpHash } from "./hash"
import type { OtpPurpose } from "./provider"
import { consumeOtp, getActiveOtp, incrementOtpAttempts } from "./store"

export type VerifyResult =
  | { ok: true }
  | { ok: false; error: "NO_CODE" }
  | { ok: false; error: "EXPIRED" }
  | { ok: false; error: "TOO_MANY_ATTEMPTS" }
  | { ok: false; error: "INVALID_CODE"; remaining: number }

/** آخر رمز صالح ← صلاحية ← حد المحاولات ← مقارنة ثابتة الزمن ← استهلاك لمرة واحدة. */
export async function verifyOtp(input: {
  phone: string
  purpose: OtpPurpose
  code: string
}): Promise<VerifyResult> {
  const { phone, purpose, code } = input
  const otp = await getActiveOtp(phone, purpose)
  if (!otp) return { ok: false, error: "NO_CODE" }

  if (otp.expiresAt.getTime() < Date.now()) {
    await consumeOtp(otp.id, false)
    return { ok: false, error: "EXPIRED" }
  }

  if (otp.attempts >= OTP_MAX_ATTEMPTS) {
    await consumeOtp(otp.id, false)
    return { ok: false, error: "TOO_MANY_ATTEMPTS" }
  }

  if (!verifyOtpHash(code, otp.salt, otp.codeHash)) {
    const attempts = await incrementOtpAttempts(otp.id)
    if (attempts >= OTP_MAX_ATTEMPTS) {
      await consumeOtp(otp.id, false)
      return { ok: false, error: "TOO_MANY_ATTEMPTS" }
    }
    return { ok: false, error: "INVALID_CODE", remaining: OTP_MAX_ATTEMPTS - attempts }
  }

  // نجاح: الاستهلاك ذرّي، فإن سبقه طلب متزامن بالرمز نفسه نرفض هذا الطلب.
  if (!(await consumeOtp(otp.id, true))) return { ok: false, error: "NO_CODE" }
  return { ok: true }
}
