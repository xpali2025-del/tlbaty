import "server-only"

import { OTP_MAX_ATTEMPTS } from "./config"
import { verifyOtpHash } from "./hash"
import { consumeOtp, getActiveOtp, incrementOtpAttempts } from "./store"

// ============================================
// التحقق من رمز OTP.
//
// يبحث عن آخر رمز صالح ← يتحقق من الصلاحية ← يقارن Hash بأمان ←
// يزيد المحاولات عند الخطأ ويبطل الرمز بعد تجاوز الحد ← يستهلك الرمز
// بعد النجاح فلا يُعاد استخدامه.
// ============================================

export type VerifyResult =
  | { ok: true }
  | { ok: false; error: "NO_CODE" }
  | { ok: false; error: "EXPIRED" }
  | { ok: false; error: "TOO_MANY_ATTEMPTS" }
  | { ok: false; error: "INVALID_CODE"; remaining: number }

export async function verifyOtp(input: {
  phone: string
  purpose: string
  code: string
}): Promise<VerifyResult> {
  const { phone, purpose, code } = input

  const otp = await getActiveOtp(phone, purpose)
  if (!otp) return { ok: false, error: "NO_CODE" }

  // انتهاء الصلاحية: نبطل الرمز حتى لا يبقى قابلاً للتخمين.
  if (new Date(otp.expiresAt).getTime() < Date.now()) {
    await consumeOtp(otp._id)
    return { ok: false, error: "EXPIRED" }
  }

  // تجاوز حد المحاولات: نبطل الرمز نهائياً.
  if (otp.attempts >= OTP_MAX_ATTEMPTS) {
    await consumeOtp(otp._id)
    return { ok: false, error: "TOO_MANY_ATTEMPTS" }
  }

  const match = verifyOtpHash(code, otp.salt, otp.codeHash)
  if (!match) {
    const attempts = otp.attempts + 1
    await incrementOtpAttempts(otp._id, attempts)
    if (attempts >= OTP_MAX_ATTEMPTS) {
      await consumeOtp(otp._id)
      return { ok: false, error: "TOO_MANY_ATTEMPTS" }
    }
    return { ok: false, error: "INVALID_CODE", remaining: OTP_MAX_ATTEMPTS - attempts }
  }

  // نجاح: نستهلك الرمز فوراً حتى لا يُعاد استخدامه.
  await consumeOtp(otp._id)
  return { ok: true }
}
