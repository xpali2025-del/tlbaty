import "server-only"
import { getActiveMethod, legacyChannelFor } from "@/lib/auth/methods"
import type { OtpChannel } from "./channel"
import { smsProvider } from "./providers/sms"
import { testSinkPath, testSinkProvider } from "./providers/test-sink"
import { whatsappProvider } from "./providers/whatsapp"

// نمط المزوّد: بقية المشروع تستدعي sendOtp فقط ولا تعرف المزوّد الفعلي.
// لإضافة مزوّد آخر: أنشئ ملفاً في providers/ يحقق OtpProvider وأضفه إلى القنوات (channel.ts) و sendOtp أدناه.

export type OtpPurpose = "login" | "change_phone"

export type SendOtpInput = {
  /** الرقم بالصيغة الدولية بلا + (مثل 967781234567 أو 966512345678). */
  phone: string
  /** الرمز الصريح — يُمرَّر للإرسال فقط ولا يُحفظ في أي مكان. */
  code: string
  purpose: OtpPurpose
  /** مهلة الإرسال بالمللي ثانية (تُقصَّر لواتساب في وضع الرجوع إلى SMS كي لا يتضاعف الانتظار). */
  timeoutMs?: number
}

export type SendOtpResult = {
  ok: boolean
  /** اسم المزوّد المستخدم فعلياً لأغراض التدقيق. */
  provider: string
  /** رمز خطأ اختياري عند الفشل (لا يُعرض للعميل كما هو). */
  errorCode?: string
}

export interface OtpProvider {
  readonly name: string
  send(input: SendOtpInput): Promise<SendOtpResult>
}


const FALLBACK_WHATSAPP_TIMEOUT_MS = 8_000

/**
 * القناة القديمة المقابلة للطريقة الفعّالة (تبقى مصدّرة لمن يستوردها). المصدر الفعلي هو login_method
 * (lib/auth/methods)، ويبقى otp_channel مزامَناً معه في القاعدة.
 */
export async function getOtpChannel(): Promise<OtpChannel> {
  return legacyChannelFor(await getActiveMethod())
}

/** يرسل الرمز حسب طريقة الدخول الفعّالة؛ في «واتساب ثم SMS» يجرّب SMS إن فشل واتساب. */
export async function sendOtp(input: SendOtpInput): Promise<SendOtpResult> {
  // مصرف الاختبارات (لا يعمل على Vercel ولا بلا متغيره) يسبق أي مزوّد حقيقي
  if (testSinkPath()) return testSinkProvider.send(input)
  const method = await getActiveMethod()
  switch (method) {
    case "sms":
      return smsProvider.send(input)
    case "wa_web_sms": {
      const first = await whatsappProvider.send({ ...input, timeoutMs: FALLBACK_WHATSAPP_TIMEOUT_MS })
      if (first.ok) return first
      // نُبقي سبب فشل واتساب في السجل (لا الرمز) كي لا يخفي الرجوع إلى SMS انقطاعاً متكرراً.
      console.error(`[otp] whatsapp failed (${first.errorCode ?? "unknown"}), falling back to sms`)
      return smsProvider.send(input)
    }
    case "wa_cloud":
      throw new Error("wa_cloud not implemented")
    case "puk":
      // وضع PUK لا يرسل رموزاً: الدخول بكلمة المرور ورمز يصدره المدير
      return { ok: false, provider: "none", errorCode: "METHOD_DISABLED" }
    default: // wa_web و wa_chat: عامل واتساب
      return whatsappProvider.send(input)
  }
}
