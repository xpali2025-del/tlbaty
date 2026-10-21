// ============================================
// حالة قراءة الإشعارات على الجهاز الحالي
//
// لا يوجد تسجيل دخول للعملاء، فتُحفظ المعرفات المقروءة في localStorage فقط.
// كل الدوال آمنة على الخادم (تتحقق من window) ومحمية بـ try/catch،
// وتُقرأ من المكوّنات بعد التحميل فقط لمنع أخطاء Hydration.
// ============================================

export const READ_NOTIFICATIONS_KEY = "tajline_read_notifications"

/** حد أقصى للمعرفات المحفوظة كي لا ينمو التخزين بلا نهاية. */
export const MAX_STORED_READ_IDS = 300

/** يقرأ المعرفات المقروءة. يعيد مصفوفة فارغة عند أي خطأ أو على الخادم. */
export function loadReadIds(): string[] {
  if (typeof window === "undefined") return []
  try {
    const raw = window.localStorage.getItem(READ_NOTIFICATIONS_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((id): id is string => typeof id === "string" && id.length > 0)
  } catch {
    // تخزين معطّل أو بيانات تالفة — نتجاهل بهدوء.
    return []
  }
}

/**
 * يحفظ المعرفات المقروءة بعد إزالة التكرار والاقتصار على الحد الأقصى.
 * نحتفظ بالأحدث (آخر ما قُرئ) ونحذف الأقدم دورياً.
 */
export function saveReadIds(ids: readonly string[]): void {
  if (typeof window === "undefined") return
  try {
    const unique = Array.from(new Set(ids)).slice(-MAX_STORED_READ_IDS)
    window.localStorage.setItem(READ_NOTIFICATIONS_KEY, JSON.stringify(unique))
  } catch {
    // تجاهل امتلاء التخزين أو منعه.
  }
}

/**
 * يزيل المعرفات التي لم تعد موجودة ضمن الإشعارات الصالحة الحالية،
 * فلا تتضخم القائمة بمعرفات إشعارات محذوفة أو منتهية.
 */
export function pruneReadIds(stored: readonly string[], validIds: readonly string[]): string[] {
  if (validIds.length === 0) return [...stored]
  const valid = new Set(validIds)
  return stored.filter((id) => valid.has(id))
}
