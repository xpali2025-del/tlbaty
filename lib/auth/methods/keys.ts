// مفاتيح طرق الدخول وتسمياتها، بلا اعتماد على الخادم (تُستورد من الواجهة والخادم).
import type { OtpChannel } from "@/lib/otp/channel"
import type { MethodKey } from "./types"

export const METHOD_KEYS: readonly MethodKey[] = ["wa_cloud", "wa_web", "sms", "wa_web_sms", "wa_chat", "puk"]

export const METHOD_LABELS: Record<MethodKey, string> = {
  wa_cloud: "واتساب الرسمي (WhatsApp Business API)",
  wa_web: "واتساب عبر الخادم (whatsapp-web.js)",
  sms: "رسالة SMS",
  wa_web_sms: "واتساب ثم SMS",
  wa_chat: "تأكيد بمحادثة واتساب",
  puk: "رمز PUK يدوي + كلمة مرور",
}

export const DEFAULT_METHOD: MethodKey = "wa_web"

export function isMethodKey(value: unknown): value is MethodKey {
  return typeof value === "string" && (METHOD_KEYS as readonly string[]).includes(value)
}

/** code: رمز يصل بقناة؛ chat: تأكيد بمحادثة؛ puk: كلمة مرور ورمز يدوي. */
export function methodKind(key: MethodKey): "code" | "chat" | "puk" {
  if (key === "wa_chat") return "chat"
  if (key === "puk") return "puk"
  return "code"
}

/** القناة القديمة (otp_channel) إلى الطريقة المقابلة. */
export function channelForLegacy(channel: OtpChannel): MethodKey {
  if (channel === "sms") return "sms"
  if (channel === "whatsapp_sms") return "wa_web_sms"
  return "wa_web"
}

/** الطريقة إلى القناة القديمة؛ ما لا مقابل له يرجع «whatsapp». */
export function legacyChannelFor(method: MethodKey): OtpChannel {
  if (method === "sms") return "sms"
  if (method === "wa_web_sms") return "whatsapp_sms"
  return "whatsapp"
}
