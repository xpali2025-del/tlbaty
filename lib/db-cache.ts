import "server-only"
import { unstable_cache } from "next/cache"
import { unstable_rethrow } from "next/navigation"
import { connection } from "next/server"

/** هل قاعدة البيانات مضبوطة؟ بدونها (بناء محلي مثلاً) تعيد القراءات قيمة افتراضية آمنة. */
export function isDbConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL_2 || process.env.DATABASE_URL)
}

/**
 * وقت البناء: يجعل الصفحة التي تقرأ هذه البيانات ديناميكية (تُرسم عند الطلب) بدل أن تُخبز بما لدينا.
 * داخل generateStaticParams لا يصح `connection()` (يرمي خطأ عادياً): يُتجاهل فتعود القائمة فارغة وتُولَّد الصفحات عند أول طلب.
 */
async function bailOutOfStaticBuild(): Promise<void> {
  try {
    await connection()
  } catch (error) {
    unstable_rethrow(error)
  }
}

/**
 * قراءة مخزَّنة في Data Cache بوسوم.
 * - بلا DATABASE_URL: تعيد fallback ولا تلمس القاعدة ولا تخزّن شيئاً (وقت البناء تصير الصفحة ديناميكية فلا يُخبز متجر فارغ).
 * - عند خطأ القاعدة بعد ضبطها: وقت البناء تصير الصفحة ديناميكية؛ وقت التشغيل يُرمى الخطأ إلى Next.js حتى لا تُستبدل نسخة الكاش
 *   السليمة بقائمة فارغة أثناء إعادة التحقق.
 * - لا مؤقت زمني: لا تُبطَل إلا عبر revalidateTag من إجراءات الإدارة.
 */
export async function dbCached<T>(options: {
  keyParts: string[]
  tags: string[]
  fallback: T
  load: () => Promise<T>
}): Promise<T> {
  const { keyParts, tags, fallback, load } = options
  const building = process.env.NEXT_PHASE === "phase-production-build"
  if (!isDbConfigured()) {
    // بناء بلا قاعدة (CI، أو متغير مفقود): لا تُخبز صفحة بمتجر فارغ في الكاش الثابت؛ تصير الصفحة ديناميكية.
    if (building) await bailOutOfStaticBuild()
    return fallback
  }
  try {
    return await unstable_cache(load, keyParts, { tags })()
  } catch (error) {
    // وقت البناء: قاعدة غير جاهزة (ترحيلات لم تُطبَّق بعد مثلاً) لا تُفشل البناء ولا تُخبز صفحة فارغة؛
    // تصير الصفحة ديناميكية (تُرسم عند الطلب) إلى أن يُنشر البناء التالي بقاعدة جاهزة.
    if (building) await bailOutOfStaticBuild()
    throw error
  }
}
