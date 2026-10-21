import "server-only"
import type { OtpProvider, SendOtpInput, SendOtpResult } from "../provider"

// يرسل الرمز عبر خدمة worker/whatsapp (whatsapp-web.js) باستدعاء HTTP موثَّق بتوكن.
// الخدمة منفصلة لأنها تحتاج عملية دائمة وجلسة QR، ولا تعمل على Serverless.
// المتغيرات: WHATSAPP_WORKER_URL, WHATSAPP_WORKER_TOKEN.

const TIMEOUT_MS = 15_000

function buildMessage(code: string, purpose: SendOtpInput["purpose"]): string {
  const reason = purpose === "change_phone" ? "تغيير رقم الهاتف" : "الدخول إلى تاج لاين"
  return `رمز ${reason}: ${code}\nلا تشاركه مع أحد.`
}

async function send(input: SendOtpInput): Promise<SendOtpResult> {
  const { phone, code, purpose } = input
  const url = process.env.WHATSAPP_WORKER_URL
  const token = process.env.WHATSAPP_WORKER_TOKEN

  if (!url || !token) {
    // في غير الإنتاج نطبع الرمز في سجل الخادم للاختبار فقط؛ في الإنتاج نرفض بخطأ إعداد.
    if (process.env.NODE_ENV !== "production") {
      console.log(`[otp][dev] code for ${phone}: ${code}`)
      return { ok: true, provider: "whatsapp" }
    }
    return { ok: false, provider: "whatsapp", errorCode: "WHATSAPP_NOT_CONFIGURED" }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ phone, text: buildMessage(code, purpose) }),
      signal: controller.signal,
      cache: "no-store",
    })
    if (!res.ok) return { ok: false, provider: "whatsapp", errorCode: `HTTP_${res.status}` }
    return { ok: true, provider: "whatsapp" }
  } catch {
    // لا نطبع الرمز ولا التوكن — فقط فشل الإرسال.
    return { ok: false, provider: "whatsapp", errorCode: "SEND_FAILED" }
  } finally {
    clearTimeout(timeout)
  }
}

export const whatsappProvider: OtpProvider = { name: "whatsapp", send }
