import "server-only"

import { OTP_PROVIDER } from "./config"
import { smsProvider } from "./providers/sms"

// ============================================
// نمط المزوّد (Provider Pattern) لإرسال الرمز.
//
// بقية المشروع (شاشة الدخول، قاعدة البيانات، منطق المصادقة، الجلسات، الطلبات)
// لا تعرف شيئاً عن المزوّد الفعلي — تستدعي getOtpProvider().send فقط.
// لإضافة واتساب أو أي مزوّد آخر مستقبلاً: أنشئ ملفاً في providers/ يحقق
// واجهة OtpProvider ثم سجّله في الخريطة أدناه، وغيّر OTP_PROVIDER في البيئة.
// لا حاجة لتعديل أي طبقة أخرى.
// ============================================

export type SendOtpInput = {
  /** الرقم المحلي الموحّد (9 أرقام). المزوّد يضيف كود الدولة إن لزم. */
  phone: string
  /** الرمز الصريح — يُمرَّر للإرسال فقط ولا يُحفظ في أي مكان. */
  code: string
  /** غرض الرمز (login / change_phone) لصياغة الرسالة. */
  purpose: string
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

// خريطة المزوّدات المتاحة. الإضافة هنا فقط.
const PROVIDERS: Record<string, OtpProvider> = {
  sms: smsProvider,
  // whatsapp: whatsappProvider, // مثال مستقبلي — لا تعديل في أي طبقة أخرى.
}

/** يعيد المزوّد المضبوط في البيئة، أو مزوّد SMS افتراضياً. */
export function getOtpProvider(): OtpProvider {
  return PROVIDERS[OTP_PROVIDER] ?? smsProvider
}
