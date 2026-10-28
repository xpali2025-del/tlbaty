import "server-only"
import { db } from "@/lib/db/client"
import { siteSettings } from "@/lib/db/store"
import { OTP_PROVIDER } from "./config"
import { DEFAULT_OTP_CHANNEL, isOtpChannel, type OtpChannel } from "./channel"
import { smsProvider } from "./providers/sms"
import { whatsappProvider } from "./providers/whatsapp"

// نمط المزوّد: بقية المشروع تستدعي getOtpProvider().send فقط ولا تعرف المزوّد الفعلي.
// لإضافة مزوّد آخر: أنشئ ملفاً في providers/ يحقق OtpProvider وسجّله أدناه.

export type OtpPurpose = "login" | "change_phone"

export type SendOtpInput = {
  /** الرقم بالصيغة الدولية بلا + (مثل 967781234567 أو 966512345678). */
  phone: string
  /** الرمز الصريح — يُمرَّر للإرسال فقط ولا يُحفظ في أي مكان. */
  code: string
  purpose: OtpPurpose
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

const PROVIDERS: Record<string, OtpProvider> = {
  whatsapp: whatsappProvider,
  sms: smsProvider,
}

export function getOtpProvider(): OtpProvider {
  return PROVIDERS[OTP_PROVIDER] ?? whatsappProvider
}

/**
 * قناة الإرسال المختارة في الإعدادات (تُقرأ من القاعدة بلا كاش فتسري فوراً).
 * إن تعذّرت القراءة نرجع لمتغير OTP_PROVIDER ثم واتساب، حتى لا يتعطل الدخول بسبب الإعداد.
 */
export async function getOtpChannel(): Promise<OtpChannel> {
  try {
    const [row] = await db.select({ c: siteSettings.otpChannel }).from(siteSettings).limit(1)
    if (isOtpChannel(row?.c)) return row.c
  } catch {
    // القاعدة غير متاحة: نكمل بالافتراضي.
  }
  return isOtpChannel(OTP_PROVIDER) ? OTP_PROVIDER : DEFAULT_OTP_CHANNEL
}

/** يرسل الرمز حسب القناة المختارة؛ في وضع «واتساب ثم SMS» يجرّب SMS إن فشل واتساب. */
export async function sendOtp(input: SendOtpInput): Promise<SendOtpResult> {
  const channel = await getOtpChannel()
  if (channel === "sms") return smsProvider.send(input)
  const first = await whatsappProvider.send(input)
  if (first.ok || channel !== "whatsapp_sms") return first
  return smsProvider.send(input)
}
