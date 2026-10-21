import "server-only"
import { OTP_PROVIDER } from "./config"
import { whatsappProvider } from "./providers/whatsapp"

// نمط المزوّد: بقية المشروع تستدعي getOtpProvider().send فقط ولا تعرف المزوّد الفعلي.
// لإضافة مزوّد آخر: أنشئ ملفاً في providers/ يحقق OtpProvider وسجّله أدناه.

export type OtpPurpose = "login" | "change_phone"

export type SendOtpInput = {
  /** الرقم المحلي الموحّد (9 أرقام). المزوّد يضيف كود الدولة إن لزم. */
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
}

export function getOtpProvider(): OtpProvider {
  return PROVIDERS[OTP_PROVIDER] ?? whatsappProvider
}
