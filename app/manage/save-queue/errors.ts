import { GENERIC_ACTION_ERROR } from "@/lib/action-result"
import { ImageUploadError } from "@/lib/storage/upload-transport"

const ARABIC = /[؀-ۿ]/

/**
 * هل يستحق هذا الخطأ إعادة المحاولة تلقائياً؟ مؤقت: الشبكة، مهلة الرفع، 5xx من التخزين، خطأ تقني عام من الخادم،
 * وأي خطأ بنص غير عربي (رفض الاتصال أو ردّ غير متوقع من Next.js، لا رسائلنا الموجّهة للمدير).
 * ما عداه رفض يخص المدخلات أو الصلاحية، فيُعرض على المدير بدل أن يُعاد بلا جدوى.
 */
export function isTransientSaveError(error: unknown): boolean {
  if (error instanceof ImageUploadError) {
    if (error.kind === "http") return error.status === 408 || error.status === 429 || (error.status ?? 0) >= 500
    return true
  }
  if (error instanceof TypeError) return true
  if (error instanceof Error) return error.message === GENERIC_ACTION_ERROR || !ARABIC.test(error.message)
  return false
}
