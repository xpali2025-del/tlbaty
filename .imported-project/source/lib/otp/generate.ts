import "server-only"

import { randomInt } from "node:crypto"
import { OTP_LENGTH, OTP_EXPIRE, OTP_RESEND } from "./config"
import { createSalt, hashOtp } from "./hash"
import { getOtpProvider } from "./provider"
import {
  createOtp,
  getLastOtpCreatedAt,
  invalidatePreviousOtps,
} from "./store"

// ============================================
// إنشاء رمز OTP وإرساله.
//
// الخطوات: فرض مؤقت إعادة الإرسال ← رمز عشوائي آمن ← حفظ Hash فقط
// (بلا نص صريح) ← إبطال أي رمز سابق ← استدعاء المزوّد الخارجي للإرسال.
// ============================================

/** ينشئ رمزاً رقمياً عشوائياً آمناً بالطول المضبوط (randomInt غير متحيّز). */
export function generateOtpCode(): string {
  let code = ""
  for (let i = 0; i < OTP_LENGTH; i++) {
    code += randomInt(0, 10).toString()
  }
  return code
}

export type GenerateResult =
  | { ok: true; provider: string }
  | { ok: false; error: "RESEND_TOO_SOON"; retryAfter: number }
  | { ok: false; error: "SEND_FAILED" }

export async function createAndSendOtp(input: {
  phone: string
  purpose: string
  ip: string
  userAgent: string
}): Promise<GenerateResult> {
  const { phone, purpose, ip, userAgent } = input

  // فرض مؤقت إعادة الإرسال اعتماداً على آخر رمز أُنشئ فعلاً.
  const last = await getLastOtpCreatedAt(phone, purpose)
  if (last) {
    const elapsed = (Date.now() - new Date(last).getTime()) / 1000
    if (elapsed < OTP_RESEND) {
      return { ok: false, error: "RESEND_TOO_SOON", retryAfter: Math.ceil(OTP_RESEND - elapsed) }
    }
  }

  const code = generateOtpCode()
  const salt = createSalt()
  const codeHash = hashOtp(code, salt)
  const provider = getOtpProvider()

  // نرسل أولاً؛ إن فشل الإرسال لا نحفظ رمزاً غير قابل للاستخدام.
  const sent = await provider.send({ phone, code, purpose })
  if (!sent.ok) {
    return { ok: false, error: "SEND_FAILED" }
  }

  // نجاح الإرسال: نبطل الرموز السابقة ثم نحفظ البصمة فقط.
  await invalidatePreviousOtps(phone, purpose)
  await createOtp({
    phone,
    codeHash,
    salt,
    purpose,
    expiresAt: new Date(Date.now() + OTP_EXPIRE * 1000).toISOString(),
    provider: sent.provider,
    ip,
    userAgent: userAgent.slice(0, 300),
  })

  return { ok: true, provider: sent.provider }
}
