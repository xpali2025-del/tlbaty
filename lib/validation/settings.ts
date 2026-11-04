import { isOtpChannel, type OtpChannel } from "@/lib/otp/channel"
import { SUPPORTED_COUNTRIES } from "@/lib/phone"
import { bool, str } from "./form"

/** رابط تواصل اجتماعي: رابط http(s) كامل أو اسم حساب فقط. أي بروتوكول آخر (javascript: وغيره) مرفوض. */
export function socialField(form: FormData, key: string, label: string): string | null {
  const value = str(form, key)
  if (!value) return null
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value)
      if (url.protocol === "http:" || url.protocol === "https:") return url.toString().slice(0, 300)
    } catch {
      // يسقط إلى رسالة الخطأ
    }
    throw new Error(`رابط ${label} غير صالح`)
  }
  if (/^@?[A-Za-z0-9._-]{1,60}$/.test(value)) return value
  throw new Error(`${label}: أدخل رابطاً كاملاً (https://…) أو اسم الحساب فقط`)
}

const PHONE = /^[+0-9][0-9 ()-]{4,24}$/

/**
 * قواعد إعدادات المتجر. شرط «SMS فقط يحتاج مفاتيح مضبوطة» يبقى في الخادم لأنه يقرأ متغيرات البيئة.
 */
export function parseSettingsForm(form: FormData) {
  const phone = str(form, "phone") ?? null
  if (phone && !PHONE.test(phone)) throw new Error("رقم الهاتف غير صالح")
  const secondaryPhone = str(form, "secondaryPhone") ?? null
  if (secondaryPhone && !PHONE.test(secondaryPhone)) throw new Error("رقم الهاتف الثاني غير صالح")
  const whatsapp = str(form, "whatsapp") ?? null
  if (whatsapp) {
    const digits = whatsapp.replace(/\D/g, "")
    if (digits.length < 8 || digits.length > 15) throw new Error("رقم واتساب غير صالح (بالصيغة الدولية، مثل 967771234567)")
  }
  const email = str(form, "email") ?? null
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("البريد الإلكتروني غير صالح")

  const codEnabled = bool(form, "codEnabled")
  const transferEnabled = bool(form, "transferEnabled")
  const walletEnabled = bool(form, "walletEnabled")
  // رقم بوت واتساب للدخول: أرقام دولية فقط (8 إلى 15)، والفارغ يعني استعمال متغير البيئة.
  const botRaw = (str(form, "loginBotNumber") ?? "").replace(/[\s+()-]/g, "")
  if (botRaw && !/^[0-9]{8,15}$/.test(botRaw)) throw new Error("رقم بوت الدخول: أرقام دولية فقط بلا رموز (مثل 967777000000)")
  const loginBotNumber = botRaw || null
  // دول تسجيل الدخول: تُحدَّث فقط إذا أُرسل حقل الدول (علامة loginCountriesPresent)، لأن الخانة غير المعلّمة لا تُرسَل أصلاً.
  // الأكواد المدعومة فقط ودولة واحدة على الأقل (الافتراضي اليمن).
  let loginCountries: string[] | undefined
  if (form.get("loginCountriesPresent") === "1") {
    const wantedCountries = form.getAll("loginCountries").map(String)
    if (wantedCountries.some((c) => !SUPPORTED_COUNTRIES.some((s) => s.code === c))) throw new Error("دولة غير مدعومة لتسجيل الدخول")
    loginCountries = SUPPORTED_COUNTRIES.filter((c) => wantedCountries.includes(c.code)).map((c) => c.code as string)
    if (loginCountries.length === 0) throw new Error("اختر دولة واحدة على الأقل لتسجيل دخول العملاء")
  }
  // قناة إرسال رمز التحقق: تُحدَّث فقط إذا أُرسلت (النماذج القديمة لا تحملها).
  const otpChannelRaw = str(form, "otpChannel")
  if (otpChannelRaw && !isOtpChannel(otpChannelRaw)) throw new Error("قناة إرسال رمز التحقق غير صالحة")
  const otpChannel: OtpChannel | undefined = otpChannelRaw && isOtpChannel(otpChannelRaw) ? otpChannelRaw : undefined
  // حذف صور الإثبات تلقائياً: غير مفعّل افتراضياً؛ عند التفعيل المدة بين 7 و365 يوماً.
  let proofRetentionDays: number | null = null
  if (bool(form, "proofRetentionEnabled")) {
    const days = Number(str(form, "proofRetentionDays"))
    if (!Number.isInteger(days) || days < 7 || days > 365) throw new Error("مدة الاحتفاظ بصور الإثبات: عدد صحيح من 7 إلى 365 يوماً")
    proofRetentionDays = days
  }
  if (!codEnabled && !transferEnabled) throw new Error("فعّل طريقة دفع واحدة على الأقل، وإلا لن يستطيع العملاء إتمام الطلب")

  return {
    name: str(form, "name") ?? null,
    nameEn: str(form, "nameEn") ?? null,
    tagline: str(form, "tagline") ?? null,
    description: str(form, "description") ?? null,
    phone,
    secondaryPhone,
    whatsapp,
    email,
    address: str(form, "address") ?? null,
    workingHours: str(form, "workingHours") ?? null,
    copyright: str(form, "copyright") ?? null,
    instagram: socialField(form, "instagram", "إنستغرام"),
    facebook: socialField(form, "facebook", "فيسبوك"),
    tiktok: socialField(form, "tiktok", "تيك توك"),
    x: socialField(form, "x", "إكس"),
    youtube: socialField(form, "youtube", "يوتيوب"),
    snapchat: socialField(form, "snapchat", "سناب شات"),
    telegram: socialField(form, "telegram", "تيليجرام"),
    codEnabled,
    transferEnabled,
    walletEnabled,
    proofRetentionDays,
    loginBotNumber,
    ...(loginCountries ? { loginCountries } : {}),
    ...(otpChannel ? { otpChannel } : {}),
  }
}
