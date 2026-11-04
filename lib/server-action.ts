import "server-only"
import { unstable_rethrow } from "next/navigation"
import { ZodError } from "zod"
import { GENERIC_ACTION_ERROR, type ActionFailure } from "@/lib/action-result"
import { claimingUploads } from "@/lib/upload-claims"

const ARABIC = /[؀-ۿ]/

/**
 * رسالة آمنة للعرض: رسائلنا الموجّهة للمستخدم بالعربية تُعرض كما هي، وأخطاء Zod بأول سبب.
 * أي خطأ تقني آخر (قاعدة بيانات، مكتبة...) لا يُكشف نصه: يُسجَّل في الخادم وتُعرض رسالة عامة.
 */
export function actionErrorMessage(error: unknown): string {
  if (error instanceof ZodError) return error.issues[0]?.message || "بيانات غير صالحة"
  if (error instanceof Error && ARABIC.test(error.message)) return error.message
  console.error("server action failed:", error)
  return GENERIC_ACTION_ERROR
}

/**
 * يغلّف إجراء خادم: يعيد النتيجة، أو `{ __actionError }` عند أي خطأ متوقع، فتصل الرسالة للمدير في الإنتاج.
 * أخطاء التحكم في Next (redirect/notFound) تُعاد رميها كما هي.
 */
export function serverAction<A extends unknown[], R>(fn: (...args: A) => Promise<R>): (...args: A) => Promise<R | ActionFailure> {
  // المفاتيح المرفوعة مسبقاً التي يقرؤها الإجراء تُزال من سجل المعلّق عند نجاحه (lib/upload-claims.ts).
  const run = claimingUploads(fn)
  return async (...args: A) => {
    try {
      return await run(...args)
    } catch (error) {
      unstable_rethrow(error)
      return { __actionError: actionErrorMessage(error) }
    }
  }
}
