import "server-only"

import type { OtpProvider, SendOtpInput, SendOtpResult } from "../provider"

// ============================================
// مزوّد إرسال الرمز عبر SMS — يستدعي API خارجياً جاهزاً فقط.
//
// لا يوجد هنا أي بوابة SMS ولا تطبيق أندرويد ولا خدمة إرسال: مجرد استدعاء
// HTTP لعنوان خارجي يُقرأ من البيئة. النتيجة المُستقبَلة هي كل ما يهم المشروع.
//
// المتغيرات: SMS_API_URL, SMS_USERNAME, SMS_PASSWORD.
// ============================================

const YEMEN_DIAL_CODE = "967"

/** يبني الرقم الدولي من الرقم المحلي (9 أرقام) لإرساله للمزوّد. */
function toInternational(localPhone: string): string {
  return `${YEMEN_DIAL_CODE}${localPhone}`
}

function isConfigured(): boolean {
  return Boolean(process.env.SMS_API_URL && process.env.SMS_USERNAME && process.env.SMS_PASSWORD)
}

function buildMessage(code: string): string {
  return `رمز الدخول إلى تاج لاين: ${code}\nلا تشاركه مع أحد.`
}

async function send(input: SendOtpInput): Promise<SendOtpResult> {
  const { phone, code } = input

  // عند غياب الإعداد: في غير الإنتاج نطبع الرمز في سجل الخادم للاختبار فقط،
  // وفي الإنتاج نرفض الإرسال بخطأ إعداد صريح (لا رمز في أي سجل إنتاجي).
  if (!isConfigured()) {
    if (process.env.NODE_ENV !== "production") {
      console.log(`[v0][otp][dev] code for ${phone}: ${code}`)
      return { ok: true, provider: "sms" }
    }
    return { ok: false, provider: "sms", errorCode: "SMS_NOT_CONFIGURED" }
  }

  const url = process.env.SMS_API_URL as string
  const username = process.env.SMS_USERNAME as string
  const password = process.env.SMS_PASSWORD as string

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10_000)
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username,
        password,
        to: toInternational(phone),
        message: buildMessage(code),
      }),
      signal: controller.signal,
      cache: "no-store",
    })
    clearTimeout(timeout)

    if (!res.ok) {
      return { ok: false, provider: "sms", errorCode: `HTTP_${res.status}` }
    }
    return { ok: true, provider: "sms" }
  } catch {
    // لا نطبع الرمز ولا بيانات الاعتماد — فقط فشل الإرسال.
    return { ok: false, provider: "sms", errorCode: "SEND_FAILED" }
  }
}

export const smsProvider: OtpProvider = {
  name: "sms",
  send,
}
