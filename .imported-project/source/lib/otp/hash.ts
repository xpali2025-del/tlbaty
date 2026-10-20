import "server-only"

import { randomBytes, scryptSync, timingSafeEqual, createHmac } from "node:crypto"
import { readSessionSecret } from "./config"

// ============================================
// تجزئة الرموز والتوكنات — خادمية بحتة.
//
// الرمز لا يُحفظ كنص صريح: نحفظ scrypt(الرمز + salt) فقط.
// المقارنة دائماً عبر timingSafeEqual لتفادي هجمات التوقيت.
// ============================================

const SCRYPT_KEYLEN = 32

/** ينشئ salt عشوائياً (hex). */
export function createSalt(): string {
  return randomBytes(16).toString("hex")
}

/** يحسب بصمة الرمز باستخدام scrypt مع salt الخاص به. */
export function hashOtp(code: string, salt: string): string {
  return scryptSync(code, salt, SCRYPT_KEYLEN).toString("hex")
}

/** يقارن رمزاً مُدخلاً ببصمة مخزّنة بأمان (ثابت الزمن). */
export function verifyOtpHash(code: string, salt: string, expectedHash: string): boolean {
  try {
    const actual = Buffer.from(hashOtp(code, salt), "hex")
    const expected = Buffer.from(expectedHash, "hex")
    if (actual.length !== expected.length) return false
    return timingSafeEqual(actual, expected)
  } catch {
    return false
  }
}

/**
 * بصمة توكن الجلسة (HMAC-SHA256 بالمفتاح السري).
 * التوكن الخام يبقى في الكوكي فقط، ولا يُحفظ في قاعدة البيانات إطلاقاً.
 */
export function hashSessionToken(token: string): string {
  return createHmac("sha256", readSessionSecret()).update(token).digest("hex")
}

/** توكن جلسة عشوائي آمن (256 بت). */
export function createSessionToken(): string {
  return randomBytes(32).toString("hex")
}
