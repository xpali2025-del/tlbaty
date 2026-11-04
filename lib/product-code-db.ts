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
  // نتخطى أي رقم محجوز فعلاً (مثلاً بعد تغيير رمز قسم ثم إعادة استخدام رمزه القديم في قسم آخر)،
  // فلا يفشل حفظ المنتجات بتعارض على product_number.
  // جملة واحدة تزيد العدّاد وتعيد الرمز والرقم وهل الرمز الكامل محجوز: ذهاب وإياب واحد بدل ثلاثة (كل جملة 100 ms عبر pooler بعيد).
  let ensured = false
  for (let attempt = 0; attempt < 200; attempt++) {
    const result = await tx.execute(sql`
      with u as (
        update ${categories} set product_seq = product_seq + 1
        where ${categories.id} = ${categoryId} and ${categories.code} is not null
        returning ${categories.code} as code, ${categories.productSeq} as seq
      )
      select u.code as code, u.seq as seq,
        exists (
          select 1 from ${products}
          where ${products.productNumber} = u.code || '-' || lpad(u.seq::text, greatest(3, length(u.seq::text)), '0')
        ) as taken
      from u`)
    // postgres.js يعيد الصفوف مصفوفةً، وPGlite وnode-postgres في rows
    const rows = (Array.isArray(result) ? result : (result as { rows: unknown[] }).rows) as { code: string; seq: number; taken: boolean }[]
    const row = rows[0]
    if (!row) {
      // لا رمز للقسم بعد (أو القسم غير موجود): يُولَّد مرة واحدة ثم نعيد
      if (ensured) throw new Error("تعذّر حجز رمز المنتج")
      await ensureCategoryCode(tx, categoryId)
      ensured = true
      continue
    }
    if (!row.taken) return formatProductCode(row.code, Number(row.seq))
  }
  throw new Error("تعذّر حجز رمز منتج غير مستخدم")
}
