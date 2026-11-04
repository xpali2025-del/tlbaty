// يبني ويحدّث products.search_text (النص المفهرس للبحث). يعمل على أي اتصال Drizzle
// (التطبيق والسكربتات والاختبارات) فلا server-only ومسارات نسبية.

import { eq, inArray, sql } from "drizzle-orm"
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
    .where(where)
  if (rows.length === 0) return 0

  const ids = rows.map((r: { id: string }) => r.id)
  const colorRows = await db.select({ productId: productColors.productId, name: productColors.name }).from(productColors).where(inArray(productColors.productId, ids))
  const colorsByProduct = new Map<string, string[]>()
  for (const c of colorRows as { productId: string; name: string }[]) {
    const list = colorsByProduct.get(c.productId) ?? []
    list.push(c.name)
    colorsByProduct.set(c.productId, list)
  }

  // جملة UPDATE واحدة لكل دفعة بدل جملة لكل منتج: كل جملة ذهاب وإياب كامل للقاعدة (قسم بـ 200 منتج = 200 رحلة).
  for (let i = 0; i < rows.length; i += UPDATE_CHUNK) {
    const values = (rows as (typeof rows)[number][]).slice(i, i + UPDATE_CHUNK).map((r) => {
      const text = buildSearchText({ ...r, colors: colorsByProduct.get(r.id) })
      return sql`(${r.id}::uuid, ${text}::text)`
    })
    await db.execute(sql`update ${products} set search_text = v.t from (values ${sql.join(values, sql`, `)}) as v(id, t) where ${products.id} = v.id`)
  }
  return rows.length
}

/** صفوف كل جملة تحديث (حدّ معاملات الجملة الواحدة في Postgres 65534؛ هنا معاملان لكل صف). */
const UPDATE_CHUNK = 500
