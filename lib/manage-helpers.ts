import "server-only"
import { revalidatePath, revalidateTag } from "next/cache"
import { CACHE_TAGS } from "@/lib/cache-tags"
import { isValidImageKey } from "@/lib/storage/keys"
import { deleteImageObject } from "@/lib/storage/r2"

// أدوات مشتركة بين إجراءات لوحة الإدارة. في ملف مستقل لأن ملفات "use server"
// لا تصدّر إلا دوالاً غير متزامنة، ولأن هذه الأدوات قابلة للاختبار منفردة.

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

/** رمز قصير من نص (3 أحرف لاتينية) لاستخدامه في رقم المنتج. */
function shortCode(value: string, fallback: string): string {
  const ascii = value.toUpperCase().replace(/[^A-Z0-9]/g, "")
  return ascii.slice(0, 3) || fallback
}

export function makeProductId(categorySlug: string, subcategory?: string): string {
  const suffix = Math.random().toString(36).slice(2, 10).toUpperCase()
  const cat = shortCode(categorySlug, "CAT")
  const sub = subcategory ? `-${shortCode(subcategory, "SUB")}` : ""
  return `TRF-${cat}${sub}-${suffix}`
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

/**
 * مفتاح صورة جديدة رُفعت مباشرة إلى R2 من المتصفح. لا نقبل إلا مفتاحاً صالحاً داخل
 * مجلد عام مسموح، فلا يستطيع النموذج تمرير رابط خارجي أو مفتاح ملف حساس.
 */
export function newImageKey(form: FormData, field: string): string | undefined {
  const value = str(form, field)
  if (!value) return undefined
  if (!isValidImageKey(value)) throw new Error("مفتاح الصورة غير صالح")
  return value
}

/** قائمة مفاتيح صور جديدة (JSON) — كلها يجب أن تكون صالحة. */
export function newImageKeys(form: FormData, field: string): string[] {
  const list = json<unknown>(form, field, [])
  if (!Array.isArray(list)) throw new Error("مفاتيح الصور غير صالحة")
  return list.map((k) => {
    if (typeof k !== "string" || !isValidImageKey(k)) throw new Error("مفتاح الصورة غير صالح")
    return k
  })
}

/** اسم القيد المخالَف عند خطأ تفرّد (23505) من postgres.js أو PGlite، أو null. */
export function uniqueViolation(error: unknown): string | null {
  const e = error as { code?: string; constraint?: string; constraint_name?: string; cause?: unknown } | null
  if (!e) return null
  if (e.code === "23505") return e.constraint_name ?? e.constraint ?? ""
  return e.cause ? uniqueViolation(e.cause) : null
}

/**
 * مزامنة وسوم العرض مع الأعلام. القديم: الوسم "new"/"bestseller" يُبقي المنتج في القائمة
 * حتى لو أُطفئ العلم من اللوحة (isNew || "new" in tags)، فلا يمكن إزالته. الآن إطفاء العلم يزيل وسمه.
 */
export function syncTags(tags: string[], flags: { isNew?: boolean; isBestseller?: boolean }): string[] {
  let next = tags
  if (flags.isNew === false) next = next.filter((t) => t !== "new")
  if (flags.isBestseller === false) next = next.filter((t) => t !== "bestseller")
  return next
}

/** حذف صور من R2 بأفضل جهد: فشل الحذف لا يُفشل العملية (يبقى كائن يتيم فقط). */
export async function removeObjects(keys: (string | null | undefined)[]): Promise<void> {
  const unique = [...new Set(keys.filter((k): k is string => Boolean(k)))]
  await Promise.allSettled(unique.map((k) => deleteImageObject(k)))
}

/**
 * إبطال كاش المتجر بعد أي كتابة. عمليات الإدارة نادرة نسبياً، لذا نبطل كل الوسوم
 * ومسارات الجذر لضمان ظهور التغيير فوراً في كل الصفحات.
 */
export function revalidateStore() {
  for (const tag of Object.values(CACHE_TAGS)) {
    revalidateTag(tag, { expire: 0 })
  }
  revalidatePath("/", "layout")
}

/** إبطال كاش صفحة اللوحة فقط حتى تُحدَّث قائمة المستخدمين فوراً. */
export function revalidateManage() {
  revalidatePath("/manage")
}
