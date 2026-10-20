import "server-only"

// ============================================
// إعدادات نظام المصادقة بـ OTP — مصدر واحد لقراءة متغيرات البيئة.
//
// كل القيم تُقرأ من البيئة مع حدود آمنة، فلا تنتشر أرقام سحرية في المشروع.
// تغيير المزوّد أو المدد يتم من هنا فقط دون لمس بقية الطبقات.
// ============================================

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]
  const n = raw ? Number.parseInt(raw, 10) : NaN
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

/** المزوّد الحالي لإرسال الرمز (sms افتراضياً). */
export const OTP_PROVIDER = (process.env.OTP_PROVIDER ?? "sms").trim().toLowerCase()

/** طول الرمز (بين 4 و 8 خانات). */
export const OTP_LENGTH = intEnv("OTP_LENGTH", 6, 4, 8)

/** مدة صلاحية الرمز بالثواني. */
export const OTP_EXPIRE = intEnv("OTP_EXPIRE", 300, 30, 3600)

/** أقل فاصل زمني بين طلبات الإرسال بالثواني. */
export const OTP_RESEND = intEnv("OTP_RESEND", 60, 15, 600)

/** أقصى عدد محاولات تحقق خاطئة قبل إبطال الرمز. */
export const OTP_MAX_ATTEMPTS = intEnv("OTP_MAX_ATTEMPTS", 5, 1, 20)

/** مدة صلاحية الجلسة بالأيام. */
export const SESSION_EXPIRE_DAYS = intEnv("SESSION_EXPIRE_DAYS", 30, 1, 365)

/** اسم كوكي الجلسة. */
export const SESSION_COOKIE = "tajline_session"

/**
 * المفتاح السري للجلسات وبصمات الرموز.
 * لا مفتاح افتراضي في الإنتاج؛ في التطوير نشتق بديلاً من مفتاح خادمي موجود
 * حتى تعمل المعاينة دون كشف أي سر.
 */
export class AuthConfigError extends Error {
  constructor(message = "SESSION_SECRET is not configured on the server") {
    super(message)
    this.name = "AuthConfigError"
  }
}

export function readSessionSecret(): string {
  const secret = process.env.SESSION_SECRET
  if (typeof secret === "string" && secret.trim().length >= 16) return secret.trim()

  if (process.env.NODE_ENV === "production") throw new AuthConfigError()

  const devBase =
    process.env.CUSTOMER_ID_SECRET ?? process.env.PAYMENT_PROOF_ENCRYPTION_KEY ?? ""
  if (devBase.trim().length >= 16) return `dev-auth-fallback:${devBase.trim()}`

  throw new AuthConfigError()
}

export function isAuthConfigured(): boolean {
  try {
    readSessionSecret()
    return true
  } catch {
    return false
  }
}
