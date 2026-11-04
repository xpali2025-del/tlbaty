import "server-only"
import { eq, lt } from "drizzle-orm"
import { db } from "@/lib/db/client"
import { saveRequests } from "@/lib/db/store"

// حفظ آمن من التكرار: يرسل المتصفح معرّفاً لكل عملية حفظ ويُبقيه في كل إعادة محاولة.
// يُكتب المعرّف في معاملة الحفظ نفسها، فإن وصل الحفظ ثم ضاع الرد وأُعيد الإرسال يعود المعرّف المخزَّن
// (وكيان العملية الأولى) بدل أن يُنشأ عنصر مكرر.

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

export type SaveOutcome = { entityId: string; replayed: boolean }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** المعرّف يأتي من المتصفح: يُقبل UUID فقط. فارغ = بلا حماية من التكرار (استدعاء قديم). */
export function parseRequestId(raw: string | undefined): string | null {
  if (raw === undefined || raw === "") return null
  if (!UUID.test(raw)) throw new Error("معرّف عملية الحفظ غير صالح")
  return raw.toLowerCase()
}

/**
 * ينفّذ `run` داخل معاملة. مع `requestId`:
 * - معرّف جديد: يُسجَّل ثم يُنفَّذ `run` ويُخزَّن معرّف الكيان المحفوظ، وكلها ذرياً.
 * - معرّف سبق حفظه: لا يُنفَّذ `run` ويعود كيان العملية الأولى مع `replayed: true`.
 * - فشل `run`: تُلغى المعاملة بما فيها تسجيل المعرّف، فتُنفَّذ إعادة المحاولة من جديد.
 * إرسالان متزامنان بالمعرّف نفسه: الثاني ينتظر الأول عند فهرس المفتاح الأساسي ثم يعيد نتيجته.
 */
export async function withSaveRequest(
  requestId: string | null,
  screen: string,
  run: (tx: Tx) => Promise<string>,
): Promise<SaveOutcome> {
  return db.transaction(async (tx) => {
    if (requestId) {
      const claimed = await tx.insert(saveRequests).values({ requestId, screen }).onConflictDoNothing().returning({ id: saveRequests.requestId })
      if (claimed.length === 0) {
        const [prior] = await tx.select().from(saveRequests).where(eq(saveRequests.requestId, requestId)).limit(1)
        if (prior && prior.screen !== screen) throw new Error("معرّف عملية الحفظ مستخدم لعملية أخرى")
        if (prior?.entityId) return { entityId: prior.entityId, replayed: true }
        // صف بلا كيان: عملية سابقة لم تكتمل ولا يمكن أن تُلتزم هكذا؛ نتعامل معه كجديد.
      }
    }
    const entityId = await run(tx)
    if (requestId) await tx.update(saveRequests).set({ entityId }).where(eq(saveRequests.requestId, requestId))
    return { entityId, replayed: false }
  })
}

/** حذف معرّفات الحفظ الأقدم من `days` (تنظيف يومي). */
export async function purgeSaveRequests(days = 7, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - days * 86_400_000)
  const deleted = await db.delete(saveRequests).where(lt(saveRequests.createdAt, cutoff)).returning({ id: saveRequests.requestId })
  return deleted.length
}
