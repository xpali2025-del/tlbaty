import "server-only"
import { and, eq, gt, isNull, lt, or, sql } from "drizzle-orm"
import { db } from "@/lib/db/client"
import { coupons } from "@/lib/db/store"

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** الكود لم يعد صالحاً (استُهلك أو انتهى أو ليس لهذا العميل) لحظة تثبيت الطلب. */
export class CouponUnavailableError extends Error {
  constructor(readonly code: string) {
    super(`coupon unavailable: ${code}`)
  }
}

/**
 * يستهلك استعمالاً واحداً من الكود ذرياً داخل معاملة الطلب: UPDATE مشروط يقفل الصف، فلا يستعمل طلبان متزامنان
 * كوداً أحادي الاستعمال. الكود الشخصي لا يقبله غير صاحبه، والمنتهي يُرفض. يتراجع مع الطلب إن فشل أي شيء بعده.
 */
export async function redeemCoupon(tx: Tx, code: string, customerId: string): Promise<void> {
  const updated = await tx
    .update(coupons)
    .set({ usedCount: sql`${coupons.usedCount} + 1` })
    .where(
      and(
        sql`lower(${coupons.code}) = lower(${code})`,
        or(isNull(coupons.customerId), eq(coupons.customerId, customerId)),
        or(isNull(coupons.expiresAt), gt(coupons.expiresAt, new Date())),
        or(isNull(coupons.maxUses), lt(coupons.usedCount, coupons.maxUses)),
      ),
    )
    .returning({ id: coupons.id })
  if (updated.length === 0) throw new CouponUnavailableError(code)
}

/** يعيد استعمال كود محدود العدد عند إلغاء/إرجاع الطلب (فلا يخسر العميل كوده الأحادي بإلغاء طلبه). */
export async function releaseCoupon(tx: Tx, code: string | null | undefined): Promise<void> {
  if (!code) return
  await tx
    .update(coupons)
    .set({ usedCount: sql`greatest(${coupons.usedCount} - 1, 0)` })
    .where(and(sql`lower(${coupons.code}) = lower(${code})`, sql`${coupons.maxUses} is not null`))
}
