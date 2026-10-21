import "server-only"

import { and, arrayOverlaps, asc, count, desc, eq, exists, gt, gte, inArray, lte, sql, type SQL } from "drizzle-orm"
import { db } from "@/lib/db/client"
import { brands, categories, productColors, products, subcategories } from "@/lib/db/store"
import { CACHE_TAGS } from "@/lib/cache-tags"
import { dbCached } from "@/lib/db-cache"
import { getProductsByNumbers } from "@/lib/data"
import { paletteSimilarity, type PaletteColor } from "@/lib/palette"
import { codeQueryCandidates } from "@/lib/product-code"
import { SEARCH_PAGE_SIZE, type SearchParams } from "@/lib/search-params"
import { normalizeSearchText, searchTokens } from "@/lib/search-text"
import type { Product } from "@/lib/types"

// ============================================
// البحث في المتجر على PostgreSQL (بدل تحميل كل المنتجات للمتصفح):
//  - نص: كل كلمة يجب أن تظهر في search_text (مطبَّع عربي/إنجليزي)، مع ترتيب بالصلة.
//  - رمز منتج: «dr12» / «DR-012» يُطابق الرمز مباشرة ويتصدّر النتائج.
//  - فلاتر: قسم، قسم فرعي، براند، لون، مقاس، سعر، متوفر، تخفيض.
//  - ترتيب: صلة، الأحدث، السعر، الأكثر مبيعاً، التقييم.
//  - بالصورة: تشابه بصمة الألوان (lib/palette.ts).
// ============================================

/** أقصى عدد صفوف تُرتَّب بالصلة في الذاكرة (فوقه تُقتطع الأضعف). */
const RANK_WINDOW = 400

export type { SearchFacets, SearchResult } from "@/lib/search-types"
import type { SearchFacets, SearchResult } from "@/lib/search-types"

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`)

type ColorFacet = { key: string; label: string; hex: string; count: number; names: string[] }

const EMPTY_FACETS: SearchFacets = { categories: [], brands: [], colors: [], sizes: [], price: { min: 0, max: 0 } }

const SIZE_ORDER = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "2XL", "3XL", "4XL", "5XL"]
const sizeRank = (s: string) => {
  const i = SIZE_ORDER.indexOf(s.toUpperCase())
  if (i >= 0) return [0, i] as const
  const n = Number(s)
  return Number.isFinite(n) ? ([1, n] as const) : ([2, 0] as const)
}

async function loadColorFacets(): Promise<ColorFacet[]> {
  const rows = await db
    .select({ name: productColors.name, hex: productColors.hex, n: count() })
    .from(productColors)
    .innerJoin(products, eq(products.id, productColors.productId))
    .groupBy(productColors.name, productColors.hex)
  const groups = new Map<string, ColorFacet>()
  for (const r of rows) {
    const key = normalizeSearchText(r.name).replace(/ /g, "-")
    if (!key) continue
    const g = groups.get(key)
    if (g) {
      g.count += Number(r.n)
      if (!g.names.includes(r.name)) g.names.push(r.name)
    } else groups.set(key, { key, label: r.name, hex: r.hex, count: Number(r.n), names: [r.name] })
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "ar"))
}

const getColorFacets = () =>
  dbCached<ColorFacet[]>({ keyParts: ["search", "colors"], tags: [CACHE_TAGS.products], fallback: [], load: loadColorFacets })

/** خيارات الفلاتر (تُخزَّن بوسم المنتجات وتُبطَل مع أي تعديل في الكتالوج). الأعداد عامة لا تتبع الفلاتر الحالية. */
export const getSearchFacets = (): Promise<SearchFacets> =>
  dbCached<SearchFacets>({
    keyParts: ["search", "facets"],
    tags: [CACHE_TAGS.products, CACHE_TAGS.categoryReferences, CACHE_TAGS.brandReferences],
    fallback: EMPTY_FACETS,
    load: async () => {
      const [cats, subs, brandRows, sizeRows, [range], colors] = await Promise.all([
        db.select({ slug: categories.slug, name: categories.name, n: count(products.id) }).from(categories).leftJoin(products, eq(products.categoryId, categories.id)).groupBy(categories.id).orderBy(asc(categories.sortOrder), asc(categories.name)),
        db.select({ category: categories.slug, slug: subcategories.slug, name: subcategories.name, n: count(products.id) }).from(subcategories).innerJoin(categories, eq(categories.id, subcategories.categoryId)).leftJoin(products, eq(products.subcategoryId, subcategories.id)).groupBy(subcategories.id, categories.slug).orderBy(asc(subcategories.sortOrder), asc(subcategories.name)),
        db.select({ slug: brands.slug, name: brands.name, n: count(products.id) }).from(brands).leftJoin(products, eq(products.brandId, brands.id)).groupBy(brands.id).orderBy(asc(brands.sortOrder), asc(brands.name)),
        db.select({ size: sql<string>`unnest(${products.sizes})`, n: count() }).from(products).groupBy(sql`1`),
        db.select({ min: sql<number>`coalesce(min(${products.price}), 0)::int`, max: sql<number>`coalesce(max(${products.price}), 0)::int` }).from(products),
        loadColorFacets(),
      ])
      return {
        categories: cats
          .filter((c) => Number(c.n) > 0)
          .map((c) => ({
            slug: c.slug,
            name: c.name,
            count: Number(c.n),
            subcategories: subs.filter((s) => s.category === c.slug && Number(s.n) > 0).map((s) => ({ slug: s.slug, name: s.name, count: Number(s.n) })),
          })),
        brands: brandRows.filter((b) => Number(b.n) > 0).map((b) => ({ slug: b.slug, name: b.name, count: Number(b.n) })),
        colors: colors.map(({ names: _names, ...c }) => c),
        sizes: sizeRows
          .map((s) => ({ size: s.size, count: Number(s.n) }))
          .sort((a, b) => {
            const [ga, va] = sizeRank(a.size)
            const [gb, vb] = sizeRank(b.size)
            return ga - gb || va - vb || a.size.localeCompare(b.size)
          }),
        price: { min: range?.min ?? 0, max: range?.max ?? 0 },
      }
    },
  })

/** شروط الفلاتر (بدون النص). */
async function filterConditions(p: SearchParams): Promise<SQL[]> {
  const conds: SQL[] = []
  if (p.category) conds.push(eq(categories.slug, p.category))
  if (p.subcategory) conds.push(eq(subcategories.slug, p.subcategory))
  if (p.brand) conds.push(eq(brands.slug, p.brand))
  if (p.colors?.length) {
    const wanted = new Set(p.colors)
    const names = (await getColorFacets()).filter((c) => wanted.has(c.key)).flatMap((c) => c.names)
    // لون غير معروف: لا نتائج (بدل تجاهل الفلتر وإظهار كل شيء).
    conds.push(
      names.length
        ? exists(db.select({ one: sql`1` }).from(productColors).where(and(eq(productColors.productId, products.id), inArray(productColors.name, names))))
        : sql`false`,
    )
  }
  if (p.sizes?.length) conds.push(arrayOverlaps(products.sizes, p.sizes))
  if (p.minPrice !== undefined) conds.push(gte(products.price, p.minPrice))
  if (p.maxPrice !== undefined) conds.push(lte(products.price, p.maxPrice))
  if (p.inStock) conds.push(gt(products.stock, 0))
  if (p.onSale) conds.push(sql`${products.oldPrice} is not null and ${products.oldPrice} > ${products.price}`)
  return conds
}

const baseQuery = () =>
  db
    .select({ id: products.id, number: products.productNumber, name: products.name, stock: products.stock, sortOrder: products.sortOrder })
    .from(products)
    .innerJoin(categories, eq(categories.id, products.categoryId))
    .leftJoin(subcategories, eq(subcategories.id, products.subcategoryId))
    .leftJoin(brands, eq(brands.id, products.brandId))

/** ترتيب SQL لغير النص (أو عند اختيار ترتيب صريح). */
function orderBy(sort: SearchParams["sort"]) {
  switch (sort) {
    case "newest":
      return [desc(products.createdAt), asc(products.name)]
    case "price_asc":
      return [asc(products.price), asc(products.name)]
    case "price_desc":
      return [desc(products.price), asc(products.name)]
    case "popular":
      return [desc(products.isBestseller), desc(products.reviewsCount), asc(products.name)]
    case "rating":
      return [desc(products.rating), desc(products.reviewsCount), asc(products.name)]
    default:
      return [asc(products.sortOrder), asc(products.name)]
  }
}

export async function searchProducts(params: SearchParams): Promise<SearchResult> {
  const limit = Math.min(Math.max(params.limit ?? SEARCH_PAGE_SIZE, 1), 120)
  const empty: SearchResult = { items: [], total: 0, limit }
  if (!process.env.DATABASE_URL) return empty

  const filters = await filterConditions(params)
  const tokens = params.q ? searchTokens(params.q) : []
  const codes = params.q ? codeQueryCandidates(params.q) : []

  // 1) رمز منتج مطابق حرفياً يتصدّر (إن وُجد ويحقق الفلاتر).
  let exact: { number: string }[] = []
  if (codes.length) {
    exact = await baseQuery().where(and(inArray(products.productNumber, codes), ...filters)).limit(5)
  }

  // 2) بحث نصي: كل الكلمات يجب أن تظهر.
  const textConds = tokens.map((t) => sql`${products.searchText} like ${"%" + escapeLike(t) + "%"} escape '\\'`)
  const where = and(...filters, ...textConds)
  const [{ n }] = await db
    .select({ n: count() })
    .from(products)
    .innerJoin(categories, eq(categories.id, products.categoryId))
    .leftJoin(subcategories, eq(subcategories.id, products.subcategoryId))
    .leftJoin(brands, eq(brands.id, products.brandId))
    .where(where)
  const total = Number(n)

  let numbers: string[]
  if (tokens.length && (!params.sort || params.sort === "relevance")) {
    const rows = await baseQuery().where(where).orderBy(asc(products.sortOrder), asc(products.name)).limit(RANK_WINDOW)
    numbers = rows
      .map((r) => ({ r, score: relevance(r, tokens) }))
      .sort((a, b) => b.score - a.score || a.r.sortOrder - b.r.sortOrder)
      .map((x) => x.r.number)
  } else {
    const rows = await baseQuery().where(where).orderBy(...orderBy(params.sort === "relevance" ? undefined : params.sort)).limit(limit)
    numbers = rows.map((r) => r.number)
  }

  const exactNumbers = exact.map((e) => e.number)
  const ordered = [...new Set([...exactNumbers, ...numbers])].slice(0, limit)
  const items = await getProductsByNumbers(ordered)
  return {
    items,
    total: Math.max(total, ordered.length),
    limit,
    matchedCode: exactNumbers[0],
  }
}

/** درجة الصلة: كلمة كاملة في الاسم > جزء من الاسم > في بقية النص، مع أفضلية للمتوفر. */
export function relevance(row: { name: string; stock: number }, tokens: string[]): number {
  const name = normalizeSearchText(row.name)
  const words = new Set(name.split(" "))
  let score = 0
  let inName = 0
  for (const t of tokens) {
    if (words.has(t)) {
      score += 25
      inName++
    } else if (name.includes(t)) {
      score += 15
      inName++
    } else score += 5
  }
  if (tokens.length > 0 && inName === tokens.length) score += 40
  if (row.stock > 0) score += 3
  return score
}

export type ImageSearchResult = { items: (Product & { similarity: number })[]; total: number }

/**
 * البحث بالصورة: ترتيب المنتجات بتشابه بصمة الألوان مع صورة المستخدم، ضمن الفلاتر الحالية (أهمها القسم).
 * بصمة المنتج: المحفوظة من صورته، وإلا ألوانه المُدخلة في اللوحة بأوزان متساوية.
 */
export async function searchByPalette(palette: PaletteColor[], params: SearchParams = {}, limit = 24): Promise<ImageSearchResult> {
  if (!process.env.DATABASE_URL || palette.length === 0) return { items: [], total: 0 }
  const filters = await filterConditions({ ...params, q: undefined })
  const rows = await db
    .select({ number: products.productNumber, palette: products.imagePalette, stock: products.stock })
    .from(products)
    .innerJoin(categories, eq(categories.id, products.categoryId))
    .leftJoin(subcategories, eq(subcategories.id, products.subcategoryId))
    .leftJoin(brands, eq(brands.id, products.brandId))
    .where(and(...filters))
    .limit(2000)
  if (rows.length === 0) return { items: [], total: 0 }

  const needColors = rows.filter((r) => !r.palette?.length).map((r) => r.number)
  const declared = new Map<string, PaletteColor[]>()
  if (needColors.length) {
    const colorRows = await db
      .select({ number: products.productNumber, hex: productColors.hex })
      .from(productColors)
      .innerJoin(products, eq(products.id, productColors.productId))
      .where(inArray(products.productNumber, needColors))
    for (const c of colorRows) {
      const list = declared.get(c.number) ?? []
      list.push({ hex: c.hex, weight: 1 })
      declared.set(c.number, list)
    }
    for (const [k, list] of declared) declared.set(k, list.map((c) => ({ ...c, weight: Number((1 / list.length).toFixed(3)) })))
  }

  const scored = rows
    .map((r) => ({ number: r.number, similarity: paletteSimilarity(palette, r.palette?.length ? r.palette : (declared.get(r.number) ?? [])) + (r.stock > 0 ? 0.001 : 0) }))
    .filter((r) => r.similarity >= 0.3)
    .sort((a, b) => b.similarity - a.similarity)
  const top = scored.slice(0, limit)
  const items = await getProductsByNumbers(top.map((t) => t.number))
  const sim = new Map(top.map((t) => [t.number, t.similarity]))
  return { items: items.map((p) => ({ ...p, similarity: Math.min(1, Number((sim.get(p.id) ?? 0).toFixed(2))) })), total: scored.length }
}

