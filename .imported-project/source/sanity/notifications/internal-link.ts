// ============================================
// التحقق من الرابط الداخلي للإشعار
//
// القاعدة: الروابط الداخلية فقط. أي رابط خارجي أو بروتوكول تنفيذي مرفوض.
// نفس الدالة تُستخدم في مخطط Sanity، وفي تحقق الخادم قبل الحفظ،
// وفي واجهة العميل قبل العرض — فلا يمكن لإشعار قديم أو محرَّف أن ينفّذ كوداً.
// ============================================

/** بروتوكولات ممنوعة صريحة (بعد إزالة المسافات وتوحيد الحالة). */
const BLOCKED_PROTOCOLS = ["javascript:", "data:", "vbscript:", "file:", "blob:", "about:"]

/**
 * يتحقق أن الرابط مسار داخلي آمن، ويعيد نسخة منظّفة منه أو null.
 *
 * يُقبل فقط:
 *   - يبدأ بـ "/" (مسار داخلي)
 *   - لا يبدأ بـ "//" (رابط بروتوكول-نسبي يخرج من الموقع)
 *   - لا يحتوي بروتوكولاً تنفيذياً ولا محارف تحكّم أو أسطر جديدة
 *   - لا يحتوي "\" (تُفسّرها بعض المتصفحات كـ "/")
 */
export function sanitizeInternalLink(input: unknown): string | null {
  if (typeof input !== "string") return null

  // إزالة المسافات ومحارف التحكم غير المرئية التي تُستخدم للتحايل.
  const cleaned = input.trim().replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200D\uFEFF]/g, "")
  if (!cleaned) return null
  if (cleaned.length > 300) return null

  const lower = cleaned.toLowerCase()
  if (BLOCKED_PROTOCOLS.some((p) => lower.startsWith(p) || lower.includes(p))) return null
  if (cleaned.includes("\\")) return null

  // مسار داخلي فقط — لا http/https ولا //host ولا mailto/tel.
  if (!cleaned.startsWith("/")) return null
  if (cleaned.startsWith("//")) return null

  return cleaned
}

/** هل الرابط صالح كمسار داخلي؟ */
export function isValidInternalLink(input: unknown): boolean {
  return sanitizeInternalLink(input) !== null
}
