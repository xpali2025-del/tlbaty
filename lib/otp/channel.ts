// قناة إرسال رمز التحقق (يضبطها المدير من الإعدادات). قابلة للاستيراد من الواجهة والخادم.

export const OTP_CHANNELS = [
  { key: "whatsapp", label: "واتساب فقط", hint: "الرمز يصل عبر خدمة واتساب (الوضع الحالي)." },
  { key: "sms", label: "رسالة SMS فقط", hint: "الرمز يصل برسالة نصية عبر SMS Gateway." },
  { key: "whatsapp_sms", label: "واتساب ثم SMS عند الفشل", hint: "يُجرَّب واتساب أولاً، وإن فشل الإرسال يُرسل SMS تلقائياً." },
] as const

export type OtpChannel = (typeof OTP_CHANNELS)[number]["key"]

export const DEFAULT_OTP_CHANNEL: OtpChannel = "whatsapp"

export function isOtpChannel(value: unknown): value is OtpChannel {
  return OTP_CHANNELS.some((c) => c.key === value)
}
