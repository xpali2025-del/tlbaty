import { GENERIC_ACTION_ERROR } from "@/lib/action-result"
import { ImageUploadError } from "@/lib/storage/upload-transport"
import type { ErrorKind } from "./core"

const ARABIC = /[؀-ۿ]/

/**
 * تصنيف خطأ الحفظ ليقرّر الطابور ما يفعل وما يقوله للمدير:
 * - network: انقطاع اتصال أو فشل رفع الصورة من المتصفح (يُنتظر عودة الاتصال، وبلا حد).
 * - server: خطأ تقني من الخادم (قاعدة بيانات، رد غير متوقع، صفحة قديمة بعد نشر جديد، 5xx من التخزين): يُعاد مرتين ثم يُعرض بسببه.
 * - permanent: رفض يخص المدخلات أو الصلاحية (رسائلنا العربية للمدير): يُعرض فوراً.
 */
export function classifySaveError(error: unknown): ErrorKind {
  if (error instanceof ImageUploadError) {
    if (error.kind === "http") return error.status === 408 || error.status === 429 || (error.status ?? 0) >= 500 ? "server" : "permanent"
    return "network"
  }
  if (error instanceof TypeError) return "network"
  if (error instanceof Error) return error.message === GENERIC_ACTION_ERROR || !ARABIC.test(error.message) ? "server" : "permanent"
  return "permanent"
}

/** هل الخطأ عامّ لا يفسّر السبب (يحتاج تلميحاً للمدير)؟ */
export function isUnexplainedError(message: string | undefined): boolean {
  return !message || message === GENERIC_ACTION_ERROR || !ARABIC.test(message)
}
