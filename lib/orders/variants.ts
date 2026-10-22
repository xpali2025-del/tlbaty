import "server-only"
import { and, eq, gte, inArray, sql } from "drizzle-orm"
import { db } from "@/lib/db/client"
import { productVariants, products } from "@/lib/db/store"
import { normalizeVariantKey } from "@/lib/variant-stock"

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** الكمية المطلوبة أكبر من المخزون المتاح؛ `productName` للعرض للعميل. */
export class OutOfStockError extends Error {
  constructor(readonly productName: string) {
    super(`out of stock: ${productName}`)
  }
}

export type VariantLine = { productUuid: string; name: string; color: string; size: string; quantity: number }

async function loadVariants(tx: Tx, productUuids: string[]) {
  if (productUuids.length === 0) return new Map<string, { color: string; size: string; stock: number }[]>()
  const rows = await tx.select().from(productVariants).where(inArray(productVariants.productId, productUuids))
  const byProduct = new Map<string, { color: string; size: string; stock: number }[]>()
  for (const r of rows) {
    const list = byProduct.get(r.productId) ?? []
    list.push({ color: r.color, size: r.size, stock: r.stock })
    byProduct.set(r.productId, list)
  }
  return byProduct
}

/** يجمّع الكميات بحسب (منتج، لون، مقاس) بعد توحيد البعد غير المستعمل، بترتيب ثابت يمنع deadlock بين طلبين. */
function aggregate(lines: VariantLine[], variants: Map<string, { color: string; size: string; stock: number }[]>) {
  const wanted = new Map<string, { productUuid: string; name: string; color: string; size: string; quantity: number }>()
  for (const l of lines) {
    const rows = variants.get(l.productUuid)
    if (!rows) continue
    const key = normalizeVariantKey(rows, l.color, l.size)
    const id = `${l.productUuid}\u0000${key.color}\u0000${key.size}`
    const prev = wanted.get(id)
    wanted.set(id, { productUuid: l.productUuid, name: l.name, ...key, quantity: (prev?.quantity ?? 0) + l.quantity })
  }
  return [...wanted.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v)
}

/** يضبط مخزون المنتج الإجمالي على مجموع متغيّراته. يعيد slugs المنتجات لإبطال كاشها. */
export async function syncProductStock(tx: Tx, productUuids: string[]): Promise<string[]> {
  if (productUuids.length === 0) return []
  const rows = await tx
    .update(products)
    .set({ stock: sql`coalesce((select sum(${productVariants.stock}) from ${productVariants} where ${productVariants.productId} = ${products.id}), 0)` })
    .where(inArray(products.id, productUuids))
    .returning({ slug: products.slug })
  return rows.map((r) => r.slug)
}

/**
 * يخصم مخزون المتغيّرات ذرياً (UPDATE مشروط بالكمية يقفل الصف). يرمي OutOfStockError إن لم يتوفر لون/مقاس
 * أو لم تكفِ كميته. يعيد معرّفات المنتجات المتتبَّعة (يُترك لها خصم المخزون الإجمالي على المتغيّرات).
 */
export async function deductVariantStock(tx: Tx, lines: VariantLine[]): Promise<Set<string>> {
  const variants = await loadVariants(tx, [...new Set(lines.map((l) => l.productUuid))])
  for (const w of aggregate(lines, variants)) {
    const updated = await tx
      .update(productVariants)
      .set({ stock: sql`${productVariants.stock} - ${w.quantity}` })
      .where(and(eq(productVariants.productId, w.productUuid), eq(productVariants.color, w.color), eq(productVariants.size, w.size), gte(productVariants.stock, w.quantity)))
      .returning({ id: productVariants.id })
    if (updated.length === 0) throw new OutOfStockError(w.name)
  }
  return new Set(variants.keys())
}

/** يعيد كميات الطلب إلى متغيّراتها (إلغاء/إرجاع/حذف). يعيد معرّفات المنتجات المتتبَّعة. */
export async function restoreVariantStock(tx: Tx, lines: VariantLine[]): Promise<Set<string>> {
  const variants = await loadVariants(tx, [...new Set(lines.map((l) => l.productUuid))])
  for (const w of aggregate(lines, variants)) {
    await tx
      .update(productVariants)
      .set({ stock: sql`${productVariants.stock} + ${w.quantity}` })
      .where(and(eq(productVariants.productId, w.productUuid), eq(productVariants.color, w.color), eq(productVariants.size, w.size)))
  }
  return new Set(variants.keys())
}
