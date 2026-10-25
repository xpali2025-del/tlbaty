// تحقق نموذج العنوان المحفوظ — منطق خالص بنفس قواعد صفحة الدفع (اسم ثلاثي، هاتف 9 أرقام).
import { ADDRESS_LABELS, MAX_ADDRESS_LABEL } from "@/hooks/use-saved-addresses"

export function validateAddressName(value: string): string {
  const words = value.trim().split(/\s+/).filter((w) => w.length >= 2)
  return words.length < 3 ? "يرجى إدخال الاسم الثلاثي (الاسم الأول واسم الأب واسم الجد)" : ""
}

export function validateAddressPhone(value: string): string {
  return value.replace(/\D/g, "").length === 9 ? "" : "رقم الهاتف يجب أن يكون 9 أرقام بالضبط (مثال: 777777777)"
}

/** يقصّ التسمية وينظّفها؛ الفارغة تعني «بلا تسمية». */
export function normalizeAddressLabel(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const clean = value.replace(/\s+/g, " ").trim().slice(0, MAX_ADDRESS_LABEL)
  return clean || undefined
}

/** هل التسمية إحدى الجاهزة (غير «أخرى» المخصّصة)؟ */
export function isPresetLabel(label: string | undefined): boolean {
  return !!label && (ADDRESS_LABELS as readonly string[]).includes(label) && label !== "أخرى"
}
