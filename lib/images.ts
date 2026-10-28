// يحوّل القيمة المخزَّنة للصورة إلى رابط صالح للعرض.
// - مفتاح كائن في R2 (مثل products/<uuid>.jpg): يُبنى منه رابط R2_PUBLIC_URL.
// - مسار محلي (/products/x.jpg) أو رابط كامل: يُعاد كما هو (بيانات قديمة أو ملفات public).
// - فارغ أو بلا إعداد R2: صورة بديلة، فلا ينكسر أي مكوّن.

export const PLACEHOLDER_IMAGE = "/placeholder.svg"

export function resolveImageUrl(value: string | null | undefined): string {
  if (!value) return PLACEHOLDER_IMAGE
  if (value.startsWith("/") || /^https?:\/\//i.test(value)) return value
  // نفس أولوية lib/env.ts: الاسم البديل R2_PUBLIC_URL_2 ثم الأصلي.
  const base = (process.env.R2_PUBLIC_URL_2 || process.env.R2_PUBLIC_URL)?.replace(/\/$/, "")
  return base ? `${base}/${value}` : PLACEHOLDER_IMAGE
}

/** نفس resolveImageUrl لكنه يعيد undefined بدل الصورة البديلة للحقول الاختيارية. */
export function resolveOptionalImageUrl(value: string | null | undefined): string | undefined {
  return value ? resolveImageUrl(value) : undefined
}
