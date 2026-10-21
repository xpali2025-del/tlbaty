import "server-only"

import { createClient, type SanityClient } from "next-sanity"
import { apiVersion, dataset, isSanityConfigured, projectId, useCdn } from "./env"

// ============================================
// عميل Sanity — للقراءة فقط من المحتوى المنشور
// useCdn: false افتراضياً => البيانات تُجلب مباشرة من Content Lake
//   لأن كاش Next.js هو من يتولى التخزين، ونحتاج بيانات حديثة
//   فور وصول الـ Webhook (On-Demand Revalidation)
// perspective: "published" => تجاهل المسودات تلقائياً
// ============================================

export const client: SanityClient | null = isSanityConfigured
  ? createClient({
      projectId,
      dataset,
      apiVersion,
      useCdn,
      perspective: "published",
    })
  : null

/**
 * جلب موحّد مع كاش Next.js (On-Demand Revalidation عبر Tags).
 *
 * - cache: "force-cache" => النتيجة تُخزَّن في Data Cache بلا مؤقت زمني.
 *   ولا تُبطَل إلا عند وصول Sanity Webhook إلى /api/revalidate.
 * - tags => كل استعلام يُوسَم بالقائمة أو المستند أو العلاقة التي يعتمد
 *   عليها، فيتحدث المتأثر فقط بدون إعادة بناء الموقع كله.
 * - يمنع تكرار الطلبات (deduplication) تلقائياً عبر كاش fetch في Next.js
 * - يرجع قيمة افتراضية آمنة عند غياب إعدادات Sanity فقط. أما خطأ الشبكة
 *   بعد ضبط Sanity فيُرمى إلى Next.js حتى لا تُستبدل نسخة الكاش السليمة
 *   بصفحة فارغة أثناء إعادة التحقق.
 */
export async function sanityFetch<T>(options: {
  query: string
  params?: Record<string, unknown>
  tags?: string[]
  fallback: T
}): Promise<T> {
  const { query, params = {}, tags = [], fallback } = options

  if (!client) return fallback

  return client.fetch<T>(query, params, {
    cache: "force-cache",
    next: { tags },
  })
}
