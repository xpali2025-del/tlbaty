import "server-only"
import { unstable_rethrow } from "next/navigation"
import { ZodError } from "zod"
import type { ActionFailure } from "@/lib/action-result"

const ARABIC = /[؀-ۿ]/
const GENERIC = "تعذّر تنفيذ العملية، حاول مجدداً. إن تكرر الخطأ راجع سجل الخادم."

/**
 * رسالة آمنة للعرض: رسائلنا الموجّهة للمستخدم بالعربية تُعرض كما هي، وأخطاء Zod بأول سبب.
 * أي خطأ تقني آخر (قاعدة بيانات، مكتبة...) لا يُكشف نصه: يُسجَّل في الخادم وتُعرض رسالة عامة.
 */
export function actionErrorMessage(error: unknown): string {
  if (error instanceof ZodError) return error.issues[0]?.message || "بيانات غير صالحة"
  if (error instanceof Error && ARABIC.test(error.message)) return error.message
  console.error("server action failed:", error)
  return GENERIC
}

/**
 * يغلّف إجراء خادم: يعيد النتيجة، أو `{ __actionError }` عند أي خطأ متوقع، فتصل الرسالة للمدير في الإنتاج.
 * أخطاء التحكم في Next (redirect/notFound) تُعاد رميها كما هي.
 */
export function serverAction<A extends unknown[], R>(fn: (...args: A) => Promise<R>): (...args: A) => Promise<R | ActionFailure> {
  return async (...args: A) => {
    try {
      return await fn(...args)
    } catch (error) {
      unstable_rethrow(error)
      return { __actionError: actionErrorMessage(error) }
    }
  }
}
