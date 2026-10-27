// منطق الإعلانات المشترك (بلا اعتماد على الخادم): أماكن العرض، نافذة التاريخ، اختيار الإعلان لكل موضع،
// وحدود الفيديو. يُستخدم في الصفحات والواجهة ولوحة الإدارة والاختبارات.

export const AD_PLACEMENTS = [
  { key: "home_new", group: "الرئيسية", label: "بعد «المضاف حديثاً»" },
  { key: "home_bestsellers", group: "الرئيسية", label: "بعد «الأكثر مبيعاً»" },
  { key: "home_offers", group: "الرئيسية", label: "بعد «العروض»" },
  { key: "home_categories", group: "الرئيسية", label: "بين أقسام الصفحة" },
  { key: "grid", group: "المنتجات", label: "كافة المنتجات ونتائج البحث (بين المنتجات)" },
  { key: "category", group: "الأقسام", label: "صفحات الأقسام (بين المنتجات)" },
] as const

export type AdPlacement = (typeof AD_PLACEMENTS)[number]["key"]

const PLACEMENT_KEYS: readonly string[] = AD_PLACEMENTS.map((p) => p.key)

export function isAdPlacement(value: unknown): value is AdPlacement {
  return typeof value === "string" && PLACEMENT_KEYS.includes(value)
}

/** يبقي الأماكن المعروفة فقط، بلا تكرار وبترتيب ثابت. القائمة الفارغة تعني «كل الأماكن». */
export function normalizePlacements(values: unknown): AdPlacement[] {
  const wanted = new Set(Array.isArray(values) ? values.filter(isAdPlacement) : [])
  const kept = AD_PLACEMENTS.map((p) => p.key).filter((k) => wanted.has(k))
  // كل الأماكن المعروفة = «في كل مكان» (فتشمل أي مكان يُضاف لاحقاً)
  return kept.length === AD_PLACEMENTS.length ? [] : kept
}

type Placed = { placements?: string[] }

/** هل يُسمح بعرض الإعلان في هذا الموضع؟ بلا أماكن محدّدة = كل الأماكن. */
export function adAllowedAt(ad: Placed, placement: AdPlacement): boolean {
  return !ad.placements?.length || ad.placements.includes(placement)
}

export function adsForPlacement<T extends Placed>(ads: T[], placement: AdPlacement): T[] {
  return ads.filter((a) => adAllowedAt(a, placement))
}

/**
 * يوزّع الإعلانات على مواضع الصفحة: لكل موضع يختار من المسموح له الإعلان الأقل ظهوراً حتى الآن
 * (التعادل بحسب الترتيب)، فتتناوب الإعلانات بدل أن يتكرر الأول. بلا إعلان مناسب: null.
 */
export function createAdPicker<T extends Placed & { id: string }>(ads: T[]) {
  const shown = new Map<string, number>()
  return (placement: AdPlacement): T | null => {
    const eligible = adsForPlacement(ads, placement)
    if (eligible.length === 0) return null
    let best = eligible[0]
    for (const ad of eligible) if ((shown.get(ad.id) ?? 0) < (shown.get(best.id) ?? 0)) best = ad
    shown.set(best.id, (shown.get(best.id) ?? 0) + 1)
    return best
  }
}

// ---------- نافذة التاريخ (توقيت عدن UTC+3، بدقة اليوم) ----------

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

/** تاريخ اليوم YYYY-MM-DD بتوقيت عدن. */
export function todayInAden(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Aden", year: "numeric", month: "2-digit", day: "2-digit" }).format(now)
}

/** يقبل YYYY-MM-DD صالحاً فقط (تاريخ حقيقي)، وإلا null. */
export function parseDateOnly(value: unknown): string | null {
  if (typeof value !== "string" || !DATE_ONLY.test(value)) return null
  const d = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value ? value : null
}

/** هل الإعلان ضمن نافذته اليوم؟ الطرفان شاملان، وغياب أي منهما = مفتوح من تلك الجهة. */
export function isAdLive(ad: { startsOn?: string | null; endsOn?: string | null }, today: string): boolean {
  if (ad.startsOn && today < ad.startsOn) return false
  if (ad.endsOn && today > ad.endsOn) return false
  return true
}

// ---------- حدود الفيديو ----------

export const MAX_VIDEO_BYTES = 8 * 1024 * 1024
export const MAX_VIDEO_SECONDS = 20
export const ALLOWED_VIDEO_TYPES: Record<string, string> = { "video/mp4": "mp4" }

/** رسالة خطأ بالعربية إن خالف الملف الحدود، وإلا null. المدة بالثواني (تُقاس في المتصفح). */
export function validateVideoFile(file: { type: string; size: number; duration?: number }): string | null {
  if (!ALLOWED_VIDEO_TYPES[file.type]) return "صيغة الفيديو غير مدعومة: ارفع ملف MP4 (H.264)"
  if (!Number.isFinite(file.size) || file.size <= 0) return "ملف الفيديو فارغ"
  if (file.size > MAX_VIDEO_BYTES) return `حجم الفيديو يتجاوز ${MAX_VIDEO_BYTES / 1024 / 1024} ميغابايت — اضغطه ثم أعد الرفع`
  if (file.duration !== undefined) {
    if (!Number.isFinite(file.duration) || file.duration <= 0) return "تعذّرت قراءة مدة الفيديو"
    if (file.duration > MAX_VIDEO_SECONDS) return `مدة الفيديو تتجاوز ${MAX_VIDEO_SECONDS} ثانية — الأنسب من 5 إلى 15 ثانية`
  }
  return null
}
