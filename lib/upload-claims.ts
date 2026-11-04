import "server-only"
import { AsyncLocalStorage } from "node:async_hooks"
import { getManageSessionUser } from "@/lib/manage-auth"
import { claimPendingUploads } from "@/lib/pending-uploads"

// مطالبة تلقائية بالمفاتيح المرفوعة مسبقاً: كل مفتاح صورة/فيديو يقرؤه إجراء حفظ يُسجَّل في سياق الطلب
// (trackUploadKey من newImageKey وما شابه)، وعند نجاح الإجراء تُزال هذه المفاتيح من سجل المرفوعات المعلّقة
// قبل أن يرجع الرد، فلا يحذفها التنظيف. فشل الإجراء أو رميه خطأ لا يطالب بشيء (يعيد المدير المحاولة).

type Claims = { keys: Set<string>; skip: boolean }

const store = new AsyncLocalStorage<Claims>()

/** يسجّل مفتاحاً قرأه الإجراء الحالي (لا أثر خارج claimingUploads). */
export function trackUploadKey(key: string | null | undefined): void {
  if (key) store.getStore()?.keys.add(key)
}

/** الإجراء الحالي نجح لكنه لم يستعمل مفاتيحه (مثلاً تعارض): لا يُطالَب بها وتبقى للتنظيف أو لإعادة المحاولة. */
export function skipUploadClaims(): void {
  const claims = store.getStore()
  if (claims) claims.skip = true
}

/**
 * يشغّل الإجراء ضمن سياق مطالبة، وبعد نجاحه يطالب بالمفاتيح التي قرأها. الأخطاء تمر كما هي.
 * فشل المطالبة نفسها (قاعدة بيانات) لا يُفشل حفظاً نجح: يُسجَّل، والتنظيف لا يحذف كائناً يشير إليه صف حي.
 */
export function claimingUploads<A extends unknown[], R>(fn: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
  return async (...args: A) => {
    const claims: Claims = { keys: new Set(), skip: false }
    const result = await store.run(claims, () => fn(...args))
    if (claims.keys.size > 0 && !claims.skip) {
      try {
        const user = await getManageSessionUser()
        if (user) await claimPendingUploads([...claims.keys], user)
      } catch (error) {
        console.error("upload claim failed:", error instanceof Error ? error.message : error)
      }
    }
    return result
  }
}
