// يبني ويحدّث products.search_text (النص المفهرس للبحث). يعمل على أي اتصال Drizzle
// (التطبيق والسكربتات والاختبارات) فلا server-only ومسارات نسبية.

import { and, asc, eq, gt, inArray, sql } from "drizzle-orm"
import type { PgDatabase } from "drizzle-orm/pg-core"
import { brands, categories, productColors, products, subcategories } from "./db/store"
import { buildSearchText } from "./search-text"

type Db = PgDatabase<any, any, any> // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * يعيد بناء search_text للمنتجات المطلوبة: بالمعرّفات، أو كل منتجات قسم/براند، أو الكل.
 * يُستدعى بعد أي تغيير يمس نصوص البحث: حفظ منتج، إعادة تسمية قسم/براند/قسم فرعي، الاستيراد.
 */
export async function refreshProductSearch(
  db: Db,
  scope: { productIds?: string[]; categoryId?: string; brandId?: string } = {},
): Promise<number> {
  const where = scope.productIds
    ? inArray(products.id, scope.productIds)
    : scope.categoryId
      ? eq(products.categoryId, scope.categoryId)
      : scope.brandId
        ? eq(products.brandId, scope.brandId)
        : undefined
  if (scope.productIds && scope.productIds.length === 0) return 0

  const batchSize = 250
  let cursor: string | undefined
  let total = 0
  while (true) {
    const rows = await db
      .select({
        id: products.id,
        name: products.name,
        description: products.description,
        code: products.productNumber,
        sku: products.sku,
        sizes: products.sizes,
        tags: products.tags,
        keywords: products.keywords,
        category: categories.name,
        subcategory: subcategories.name,
        brand: brands.name,
      })
      .from(products)
      .innerJoin(categories, eq(categories.id, products.categoryId))
      .leftJoin(subcategories, eq(subcategories.id, products.subcategoryId))
      .leftJoin(brands, eq(brands.id, products.brandId))
      .where(and(where, cursor ? gt(products.id, cursor) : undefined))
      .orderBy(asc(products.id))
      .limit(batchSize)
    if (rows.length === 0) return total

    const ids = rows.map((r: { id: string }) => r.id)
    const colorRows = await db.select({ productId: productColors.productId, name: productColors.name }).from(productColors).where(inArray(productColors.productId, ids)).orderBy(asc(productColors.sortOrder), asc(productColors.id))
    const colorsByProduct = new Map<string, string[]>()
    for (const c of colorRows as { productId: string; name: string }[]) {
      const list = colorsByProduct.get(c.productId) ?? []
      list.push(c.name)
      colorsByProduct.set(c.productId, list)
    }

    // VALUES is parameterized, bounded, and updates existing rows only. Do not upsert
    // products: an index refresh must never recreate a concurrently deleted product.
    const values = rows.map((r: (typeof rows)[number]) =>
      sql`(${r.id}::uuid, ${buildSearchText({ ...r, colors: colorsByProduct.get(r.id) })}::text)`,
    )
    await db.execute(sql`
      update ${products} as target
      set search_text = refreshed.search_text
      from (values ${sql.join(values, sql`, `)}) as refreshed(id, search_text)
      where target.id = refreshed.id
        and target.search_text is distinct from refreshed.search_text
    `)
    total += rows.length
    cursor = rows[rows.length - 1].id
    if (rows.length < batchSize) return total
  }
}
