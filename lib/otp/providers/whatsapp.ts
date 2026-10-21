import "server-only"
import { OTP_EXPIRE } from "../config"
import type { OtpProvider, SendOtpInput, SendOtpResult } from "../provider"

// يرسل الرمز عبر خدمة worker/whatsapp (whatsapp-web.js) باستدعاء HTTP موثَّق بتوكن.
// الخدمة منفصلة لأنها تحتاج عملية دائمة وجلسة QR، ولا تعمل على Serverless.
// المتغيرات: WHATSAPP_WORKER_URL, WHATSAPP_WORKER_TOKEN.

const TIMEOUT_MS = 15_000

// واتساب يرصد تكرار الرسائل المتطابقة؛ لذلك تختلف كل رسالة بالوقت (بالثواني، بتوقيت عدن)
// وبصياغة تُختار من عدة قوالب. الرمز نفسه عشوائي في كل مرة.
const TIME_FORMAT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Aden",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
})

type Template = (v: { reason: string; code: string; time: string; minutes: number }) => string

const TEMPLATES: Template[] = [
  ({ reason, code, time, minutes }) => `رمز ${reason}: ${code}\nالوقت: ${time}\nصالح لمدة ${minutes} دقائق، ولا تشاركه مع أحد.`,
  ({ reason, code, time, minutes }) => `مرحباً 👋\nرمزك لـ${reason} هو ${code}\nأُرسل عند ${time}، وينتهي بعد ${minutes} دقائق.`,
  ({ reason, code, time, minutes }) => `تاج لاين - ${time}\nرمز ${reason}: ${code}\nيُستخدم مرة واحدة ويصلح ${minutes} دقائق فقط.`,
  ({ reason, code, time, minutes }) => `${code} هو رمز ${reason}.\nالوقت ${time}. لا تعطِ هذا الرمز لأي شخص، ويسري ${minutes} دقائق.`,
]

export function buildMessage(
  code: string,
  purpose: SendOtpInput["purpose"],
  now: Date = new Date(),
  random: () => number = Math.random,
): string {
  const reason = purpose === "change_phone" ? "تغيير رقم الهاتف" : "الدخول إلى تاج لاين"
  const template = TEMPLATES[Math.floor(random() * TEMPLATES.length)]
  return template({ reason, code, time: TIME_FORMAT.format(now), minutes: Math.max(1, Math.round(OTP_EXPIRE / 60)) })
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
