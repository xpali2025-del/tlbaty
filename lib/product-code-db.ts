// يعمل على أي اتصال Drizzle (التطبيق والسكربتات والاختبارات)، لذا بلا server-only وبمسارات نسبية.
import { eq, sql } from "drizzle-orm"
import type { PgDatabase } from "drizzle-orm/pg-core"
import { categories, products } from "./db/store"
import { formatProductCode, suggestCategoryCode } from "./product-code"

type Tx = PgDatabase<any, any, any> // eslint-disable-line @typescript-eslint/no-explicit-any

/** يضمن أن للقسم رمزاً (يولّده من الـslug إن لم يكن له) ويعيده. */
export async function ensureCategoryCode(tx: Tx, categoryId: string): Promise<string> {
  const [row] = await tx.select({ slug: categories.slug, code: categories.code }).from(categories).where(eq(categories.id, categoryId)).limit(1)
  if (!row) throw new Error("القسم غير موجود")
  if (row.code) return row.code
  const taken = new Set(
    (await tx.select({ code: categories.code }).from(categories)).map((c: { code: string | null }) => c.code).filter((c: string | null): c is string => Boolean(c)),
  )
  const code = suggestCategoryCode(row.slug, taken)
  await tx.update(categories).set({ code }).where(eq(categories.id, categoryId))
  return code
}

/**
 * يحجز رمز المنتج التالي في القسم بشكل ذري: UPDATE واحد يزيد العدّاد ويقفل الصف،
 * فلا يحصل منتجان متزامنان على نفس الرمز.
 */
export async function allocateProductCode(tx: Tx, categoryId: string): Promise<string> {
  await ensureCategoryCode(tx, categoryId)
  // نتخطى أي رقم محجوز فعلاً (مثلاً بعد تغيير رمز قسم ثم إعادة استخدام رمزه القديم في قسم آخر)،
  // فلا يفشل حفظ المنتجات بتعارض على product_number.
  for (let attempt = 0; attempt < 200; attempt++) {
    const [row] = await tx
      .update(categories)
      .set({ productSeq: sql`${categories.productSeq} + 1` })
      .where(eq(categories.id, categoryId))
      .returning({ code: categories.code, seq: categories.productSeq })
    if (!row?.code) throw new Error("تعذّر حجز رمز المنتج")
    const code = formatProductCode(row.code, row.seq)
    const taken = await tx.select({ id: products.id }).from(products).where(eq(products.productNumber, code)).limit(1)
    if (taken.length === 0) return code
  }
  throw new Error("تعذّر حجز رمز منتج غير مستخدم")
}
