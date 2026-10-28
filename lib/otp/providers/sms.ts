import "server-only"
import { OTP_EXPIRE } from "../config"
import type { OtpProvider, SendOtpInput, SendOtpResult } from "../provider"

// يرسل الرمز برسالة SMS عبر «SMS Gateway for Android» (sms-gate.app) بواجهته REST:
// POST {SMS_GATE_URL} بمصادقة Basic ونص JSON { textMessage: { text }, phoneNumbers: ["+..."] }.
// المتغيرات: SMS_GATE_USERNAME, SMS_GATE_PASSWORD (من تطبيق الهاتف)، و SMS_GATE_URL اختياري:
//   السحابة (الافتراضي): https://api.sms-gate.app/3rdparty/v1/messages
//   محلي: http://<عنوان-الهاتف>:8080/messages (لا يصل إليه Vercel؛ يلزم عنوان عام)

const DEFAULT_URL = "https://api.sms-gate.app/3rdparty/v1/messages"
const TIMEOUT_MS = 15_000

export function isSmsConfigured(): boolean {
  return Boolean(process.env.SMS_GATE_USERNAME && process.env.SMS_GATE_PASSWORD)
}

export function buildSmsText(code: string, purpose: SendOtpInput["purpose"]): string {
  const reason = purpose === "change_phone" ? "تغيير رقم الهاتف" : "الدخول إلى تاج لاين"
  const minutes = Math.max(1, Math.round(OTP_EXPIRE / 60))
  return `رمز ${reason}: ${code}\nصالح ${minutes} دقائق، ولا تشاركه مع أحد.`
}

async function send(input: SendOtpInput): Promise<SendOtpResult> {
  const { phone, code, purpose, timeoutMs } = input
  const username = process.env.SMS_GATE_USERNAME
  const password = process.env.SMS_GATE_PASSWORD

  if (!username || !password) {
    // في غير الإنتاج نطبع الرمز في سجل الخادم للاختبار فقط؛ في الإنتاج نرفض بخطأ إعداد.
    if (process.env.NODE_ENV !== "production") {
      console.log(`[otp][dev][sms] code for ${phone}: ${code}`)
      return { ok: true, provider: "sms" }
    }
    return { ok: false, provider: "sms", errorCode: "SMS_NOT_CONFIGURED" }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs ?? TIMEOUT_MS)
  try {
    const res = await fetch((process.env.SMS_GATE_URL || DEFAULT_URL).trim(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
      },
      body: JSON.stringify({ textMessage: { text: buildSmsText(code, purpose) }, phoneNumbers: [`+${phone}`] }),
      signal: controller.signal,
      cache: "no-store",
      // لا نتبع إعادة التوجيه: كي لا تُرسَل بيانات Basic إلى مضيف آخر.
      redirect: "error",
    })
    if (!res.ok) return { ok: false, provider: "sms", errorCode: `HTTP_${res.status}` }
    return { ok: true, provider: "sms" }
  } catch {
    // لا نطبع الرمز ولا بيانات الدخول — فقط فشل الإرسال.
    return { ok: false, provider: "sms", errorCode: "SEND_FAILED" }
  } finally {
    clearTimeout(timeout)
  }
}

export const smsProvider: OtpProvider = { name: "sms", send }
