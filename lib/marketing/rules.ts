// قواعد التذكير التلقائي (سلة متروكة / رغبات). بلا اعتماد على الخادم فتُستعمل في اللوحة والخادم والاختبارات.

export const REMINDER_KINDS = ["cart", "wishlist"] as const
export type ReminderKind = (typeof REMINDER_KINDS)[number]

export const REMINDER_KIND_LABELS: Record<ReminderKind, string> = {
  cart: "تذكير السلة المتروكة",
  wishlist: "تذكير الرغبات",
}

export type ReminderRule = {
  kind: ReminderKind
  enabled: boolean
  delayHours: number
  cooldownDays: number
  title: string
  body: string
  discountType: "percent" | "fixed"
  /** 0 = بلا كود خصم. */
  discountValue: number
  minOrder: number
  couponValidDays: number
}

export const DEFAULT_REMINDER_RULES: Record<ReminderKind, ReminderRule> = {
  cart: {
    kind: "cart",
    enabled: false,
    delayHours: 24,
    cooldownDays: 7,
    title: "لا تترك سلتك 🛒",
    body: "{product} وبقية منتجاتك بانتظارك! استعمل الكود {code} لخصم {discount} خلال {days} أيام.",
    discountType: "percent",
    discountValue: 10,
    minOrder: 0,
    couponValidDays: 3,
  },
  wishlist: {
    kind: "wishlist",
    enabled: false,
    delayHours: 72,
    cooldownDays: 14,
    title: "رغباتك ما زالت متوفرة ❤️",
    body: "{product} من رغباتك ما زال متوفراً. كود خصم خاص بك: {code} ({discount}) لمدة {days} أيام.",
    discountType: "percent",
    discountValue: 5,
    minOrder: 0,
    couponValidDays: 7,
  },
}

export const RULE_LIMITS = {
  delayHours: { min: 1, max: 2160 },
  cooldownDays: { min: 1, max: 90 },
  couponValidDays: { min: 1, max: 90 },
  titleMax: 80,
  bodyMax: 400,
} as const

export const PLACEHOLDERS = ["{product}", "{code}", "{discount}", "{days}"] as const

/** يستبدل المتغيرات في نص الإشعار. المتغير المجهول يُترك كما هو. */
export function renderReminderText(template: string, vars: { product: string; code: string; discount: string; days: number }): string {
  return template
    .replaceAll("{product}", vars.product)
    .replaceAll("{code}", vars.code)
    .replaceAll("{discount}", vars.discount)
    .replaceAll("{days}", String(vars.days))
}

export function describeDiscount(rule: Pick<ReminderRule, "discountType" | "discountValue">): string {
  return rule.discountType === "percent" ? `${rule.discountValue}%` : `${rule.discountValue.toLocaleString("en-US")} ر.ي`
}

/** يتحقق من قاعدة قادمة من اللوحة. يعيد رسالة الخطأ العربية أو null. */
export function validateRule(rule: ReminderRule): string | null {
  const { delayHours, cooldownDays, couponValidDays } = RULE_LIMITS
  if (!Number.isInteger(rule.delayHours) || rule.delayHours < delayHours.min || rule.delayHours > delayHours.max)
    return `مدة الانتظار من ${delayHours.min} إلى ${delayHours.max} ساعة (90 يوماً)`
  if (!Number.isInteger(rule.cooldownDays) || rule.cooldownDays < cooldownDays.min || rule.cooldownDays > cooldownDays.max)
    return `أقل فاصل بين تذكيرين لنفس العميل من ${cooldownDays.min} إلى ${cooldownDays.max} يوماً`
  if (!rule.title.trim() || rule.title.length > RULE_LIMITS.titleMax) return `عنوان الإشعار مطلوب (حتى ${RULE_LIMITS.titleMax} حرفاً)`
  if (!rule.body.trim() || rule.body.length > RULE_LIMITS.bodyMax) return `نص الإشعار مطلوب (حتى ${RULE_LIMITS.bodyMax} حرفاً)`
  if (!Number.isFinite(rule.discountValue) || rule.discountValue < 0) return "قيمة الخصم لا يمكن أن تكون سالبة"
  if (rule.discountType === "percent" && rule.discountValue > 100) return "نسبة الخصم لا تتجاوز 100%"
  if (!Number.isFinite(rule.minOrder) || rule.minOrder < 0) return "الحد الأدنى للطلب لا يمكن أن يكون سالباً"
  if (!Number.isInteger(rule.couponValidDays) || rule.couponValidDays < couponValidDays.min || rule.couponValidDays > couponValidDays.max)
    return `صلاحية الكود من ${couponValidDays.min} إلى ${couponValidDays.max} يوماً`
  if (rule.discountValue === 0 && rule.body.includes("{code}")) return "النص يحتوي {code} لكن قيمة الخصم صفر؛ ضع قيمة خصم أو احذف {code}"
  return null
}
