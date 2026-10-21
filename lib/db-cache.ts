import "server-only"
import { unstable_cache } from "next/cache"

/** هل قاعدة البيانات مضبوطة؟ بدونها (بناء محلي مثلاً) تعيد القراءات قيمة افتراضية آمنة. */
export function isDbConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL)
}

/**
 * قراءة مخزَّنة في Data Cache بوسوم (بديل sanityFetch).
 * - بلا DATABASE_URL: تعيد fallback ولا تلمس القاعدة ولا تخزّن شيئاً.
 * - عند خطأ القاعدة بعد ضبطها: يُرمى الخطأ إلى Next.js حتى لا تُستبدل نسخة الكاش
 *   السليمة بقائمة فارغة أثناء إعادة التحقق.
 * - لا مؤقت زمني: لا تُبطَل إلا عبر revalidateTag من إجراءات الإدارة.
 */
export function dbCached<T>(options: {
  keyParts: string[]
  tags: string[]
  fallback: T
  load: () => Promise<T>
}): Promise<T> {
  const { keyParts, tags, fallback, load } = options
  if (!isDbConfigured()) return Promise.resolve(fallback)
  return unstable_cache(load, keyParts, { tags })()
}
