import "server-only"
import { randomInt } from "node:crypto"
import { OTP_EXPIRE, OTP_LENGTH, OTP_RESEND } from "./config"
import { createSalt, hashOtp } from "./hash"
import { getOtpProvider, type OtpPurpose } from "./provider"
import { createOtp, getLastOtpCreatedAt, invalidatePreviousOtps } from "./store"

/** رمز رقمي عشوائي آمن بالطول المضبوط (randomInt غير متحيّز). */
export function generateOtpCode(): string {
  let code = ""
  for (let i = 0; i < OTP_LENGTH; i++) code += randomInt(0, 10).toString()
  return code
}

export type GenerateResult =
  | { ok: true; provider: string }
  | { ok: false; error: "RESEND_TOO_SOON"; retryAfter: number }
  | { ok: false; error: "SEND_FAILED" }

/**
 * فرض مؤقت إعادة الإرسال ← رمز عشوائي ← إرسال ← (عند النجاح فقط) إبطال السابق
 * وحفظ البصمة. لا يُحفظ نص الرمز الصريح في أي مكان.
 */
export async function createAndSendOtp(input: {
  phone: string
  purpose: OtpPurpose
  ip: string
  userAgent: string
}): Promise<GenerateResult> {
  const { phone, purpose, ip, userAgent } = input

  const last = await getLastOtpCreatedAt(phone, purpose)
  if (last) {
    const elapsed = (Date.now() - last.getTime()) / 1000
    if (elapsed < OTP_RESEND) {
      return { ok: false, error: "RESEND_TOO_SOON", retryAfter: Math.ceil(OTP_RESEND - elapsed) }
    }
  }

  const code = generateOtpCode()
  const salt = createSalt()
  const codeHash = hashOtp(code, salt)

  // نرسل أولاً؛ إن فشل الإرسال لا نحفظ رمزاً غير قابل للاستخدام.
  const sent = await getOtpProvider().send({ phone, code, purpose })
  if (!sent.ok) return { ok: false, error: "SEND_FAILED" }

  await invalidatePreviousOtps(phone, purpose)
  await createOtp({
    phone,
    codeHash,
    salt,
    purpose,
    expiresAt: new Date(Date.now() + OTP_EXPIRE * 1000),
    provider: sent.provider,
    ip,
    userAgent: userAgent.slice(0, 300),
  })
  return { ok: true, provider: sent.provider }
}
