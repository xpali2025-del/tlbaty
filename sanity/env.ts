// ============================================
// إعدادات بيئة Sanity — لا تضع أي قيم مباشرة هنا
// كل القيم تُقرأ من متغيرات البيئة فقط
// ============================================

export const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID ?? ""

export const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET ?? "production"

export const apiVersion = process.env.NEXT_PUBLIC_SANITY_API_VERSION ?? "2026-01-01"

/**
 * CDN معطّل افتراضياً مع نظام On-Demand Revalidation:
 * - كاش Next.js (Data Cache) هو من يخزّن النتائج ويقدّمها بسرعة،
 *   لذا لا نحتاج كاش Sanity CDN فوقه.
 * - عند وصول Webhook بعد النشر مباشرة، قد يقدّم الـ CDN نسخة قديمة
 *   لعدة ثوانٍ، فيُعاد تخزين بيانات قديمة في الكاش — لذلك نقرأ من
 *   Content Lake مباشرة لضمان أحدث البيانات دائماً.
 * لإعادة تفعيل الـ CDN (غير مستحسن مع Webhook فوري):
 * NEXT_PUBLIC_SANITY_USE_CDN=true
 */
export const useCdn = process.env.NEXT_PUBLIC_SANITY_USE_CDN === "true"

/**
 * هل تم ضبط Sanity؟ إن لم تكن المتغيرات موجودة بعد،
 * يعمل الموقع بحالات فارغة آمنة بدون أي أخطاء.
 */
export const isSanityConfigured = projectId.length > 0
