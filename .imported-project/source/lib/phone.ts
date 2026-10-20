// ============================================
// توحيد أرقام هواتف العملاء — المصدر الوحيد في المشروع.
//
// تُستخدم هذه الدوال في: إنشاء الطلب، إنشاء customerId، البحث في شاشة التتبع،
// مقارنة الهواتف، وتجميع طلبات العميل في لوحة الإدارة.
// لا تُنشئ دالة توحيد أخرى في أي مكان — أي اختلاف في النتيجة بين إنشاء الطلب
// والتتبع يعني أن العميل لن يجد طلبه.
//
// الناتج النهائي دائماً رقم محلي يمني من 9 أرقام بلا كود دولة، مثل: 781234567
//
// ملاحظة: هذا الملف يخص هاتف العميل فقط. أرقام تواصل المتجر تبقى كما هي
// بكود دولتها ولا تمر من هنا إطلاقاً.
// ============================================

/** قاعدة التحقق الحالية في المشروع: تسعة أرقام بالضبط. */
export const LOCAL_PHONE_LENGTH = 9

/** تحويل الأرقام العربية (٠-٩) والفارسية (۰-۹) إلى أرقام إنجليزية. */
export function toEnglishDigits(value: string): string {
  return value.replace(/[\u0660-\u0669\u06f0-\u06f9]/g, (d) => {
    const code = d.charCodeAt(0)
    const base = code >= 0x06f0 ? 0x06f0 : 0x0660
    return String(code - base)
  })
}

/**
 * يوحّد رقم هاتف العميل إلى الصيغة المحلية (9 أرقام بلا كود دولة).
 *
 * الخطوات: أرقام إنجليزية ← إسقاط كل ما ليس رقماً (المسافات والشرطات
 * والأقواس وعلامة +) ← حذف كود الدولة (+967 / 00967 / 967)
 * ← حذف الصفر المحلي الزائد.
 *
 * يعيد سلسلة فارغة إذا لم يبقَ أي رقم.
 */
export function normalizeLocalPhone(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number") return ""

  let digits = toEnglishDigits(String(value)).replace(/\D/g, "")
  if (!digits) return ""

  // حذف كود الدولة اليمني بصيغه الثلاث.
  // شرط الطول يمنع قصّ رقم محلي صالح يبدأ بـ 967 بالخطأ.
  if (digits.startsWith("00967") && digits.length > 5) {
    digits = digits.slice(5)
  } else if (digits.startsWith("967") && digits.length > LOCAL_PHONE_LENGTH) {
    digits = digits.slice(3)
  }

  // حذف الصفر المحلي الزائد (مثل 0781234567) — مسموح لأن القاعدة الحالية 9 أرقام.
  if (digits.startsWith("0")) {
    const withoutZeros = digits.replace(/^0+/, "")
    if (withoutZeros.length >= LOCAL_PHONE_LENGTH) digits = withoutZeros
  }

  // لا نقصّ الأرقام الزائدة هنا: الرقم الأطول من 9 بعد حذف كود الدولة
  // يعني خطأ إدخال، ويجب أن يرفضه التحقق بدل تحويله صامتاً إلى رقم صالح
  // قد يطابق طلب عميل آخر.
  return digits
}

/**
 * توحيد متسامح للأرقام المخزّنة في الطلبات القديمة فقط.
 *
 * بعض الطلبات القديمة حُفظت بصيغ غير موحّدة (كود دولة أو بادئات إضافية)،
 * فنأخذ آخر 9 أرقام حتى نتمكن من مطابقتها. لا تُستخدم هذه الدالة إطلاقاً
 * على مدخلات العميل حتى لا يتحول خطأ إدخال إلى رقم صالح.
 */
export function normalizeStoredPhone(value: unknown): string {
  const digits = normalizeLocalPhone(value)
  return digits.length > LOCAL_PHONE_LENGTH ? digits.slice(-LOCAL_PHONE_LENGTH) : digits
}

/** هل الرقم المحلي صالح وفق قاعدة المشروع (تسعة أرقام بالضبط)؟ */
export function isValidLocalPhone(localPhone: string): boolean {
  return /^\d{9}$/.test(localPhone)
}

/**
 * يوحّد ويتحقق في خطوة واحدة.
 * يعيد الرقم المحلي عند الصلاحية، أو null عند الرفض.
 */
export function normalizeAndValidateLocalPhone(value: unknown): string | null {
  const local = normalizeLocalPhone(value)
  return isValidLocalPhone(local) ? local : null
}

/**
 * إخفاء جزئي لعرضه للعميل: 781234567 ← 78•••••67
 * يُستخدم في شاشة التتبع حتى لا يُكشف الرقم كاملاً.
 */
export function maskLocalPhone(localPhone: string): string {
  if (localPhone.length < 4) return "•••"
  const start = localPhone.slice(0, 2)
  const end = localPhone.slice(-2)
  return `${start}${"•".repeat(Math.max(3, localPhone.length - 4))}${end}`
}

/**
 * مفتاح موحّد للهاتف — يبقى للتوافق مع لوحة الإدارة.
 * @deprecated استخدم normalizeLocalPhone للمنطق الجديد.
 */
export function normalizePhoneKey(value: unknown): string {
  return normalizeStoredPhone(value)
}

/**
 * مفتاح تعريف العميل: يفضّل customerId إن وُجد، وإلا الهاتف الموحّد.
 * يعيد null إذا تعذّر التعريف حتى لا يُحتسب سجل مجهول كعميل.
 */
export function customerKey(input: { customerId?: string; phone?: string }): string | null {
  const id = (input.customerId ?? "").trim()
  if (id) return `id:${id}`
  // قيم مخزّنة قد تكون غير موحّدة، فنستخدم التوحيد المتسامح.
  const phone = normalizeStoredPhone(input.phone)
  return phone ? `tel:${phone}` : null
}
