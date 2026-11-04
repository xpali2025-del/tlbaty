// قراءة حقول النماذج وتحويلها: بلا أي اعتماد على الخادم، فتُستعمل في الإجراءات (الخادم) وفي النماذج (المتصفح).
// هذه الدوال أساس قواعد التحقق المشتركة في lib/validation: قاعدة واحدة تُطبَّق في المكانين فلا يختلف قبول أو رفض مدخل.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** يتحقق أن المعرّف UUID قبل أي استعلام (يمنع أخطاء cast ويرفض المدخلات الغريبة). */
export function uuidParam(value: unknown, message = "معرّف غير صالح"): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new Error(message)
  return value
}

/** تحويل نص عربي/إنجليزي إلى سلاج آمن. */
export function slugify(input: string): string {
  return (
    input
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9؀-ۿ]+/g, "-")
      .replace(/^-+|-+$/g, "") || `item-${Date.now().toString(36)}`
  )
}

/** تنظيف نص لاتيني إلى سلاج إنجليزي آمن (حروف/أرقام وشرطات فقط). */
export function englishSlug(input: string): string {
  return (
    input
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || `item-${Date.now().toString(36)}`
  )
}

export function str(form: FormData, key: string): string | undefined {
  const v = form.get(key)
  if (typeof v !== "string") return undefined
  const trimmed = v.trim()
  return trimmed.length ? trimmed : undefined
}

export function num(form: FormData, key: string): number | undefined {
  const v = str(form, key)
  if (v === undefined) return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

export function bool(form: FormData, key: string): boolean {
  return form.get(key) === "true" || form.get(key) === "on"
}

/** يقرأ حقل JSON من النموذج (للمصفوفات مثل الألوان والكلمات المفتاحية). */
export function json<T>(form: FormData, key: string, fallback: T): T {
  const raw = str(form, key)
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

/** هل في حقل الملف صورة مختارة فعلاً؟ (المتصفح يضع ملفاً فارغاً الاسم لحقل لم يُختر فيه شيء.) */
export function hasFile(form: FormData, key: string): boolean {
  return form.getAll(key).some((v) => typeof v !== "string" && v.size > 0)
}

/** نص أول خطأ تحقق يرميه المحلّل (أو null إن كان المدخل صالحاً): ما يعرضه المتصفح للمدير قبل أي رفع. */
export function problemOf(check: () => unknown): string | null {
  try {
    check()
    return null
  } catch (error) {
    return error instanceof Error ? error.message : "مدخلات غير صالحة"
  }
}
