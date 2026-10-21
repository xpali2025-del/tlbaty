// معاملات البحث في الرابط (/search?...) — منطق خالص يُستخدم في الخادم (قراءة) والعميل (بناء الرابط).

export const SEARCH_SORTS = ["relevance", "newest", "price_asc", "price_desc", "popular", "rating"] as const
export type SearchSort = (typeof SEARCH_SORTS)[number]

export const SEARCH_PAGE_SIZE = 24
export const SEARCH_MAX_LIMIT = 120

export type SearchParams = {
  q?: string
  category?: string
  subcategory?: string
  brand?: string
  /** مفاتيح ألوان (اسم اللون موحّداً) — يظهر المنتج إن كان فيه أي منها. */
  colors?: string[]
  sizes?: string[]
  /** بالعملة الأساسية (الريال اليمني القديم). */
  minPrice?: number
  maxPrice?: number
  inStock?: boolean
  onSale?: boolean
  sort?: SearchSort
  limit?: number
}

type Raw = Record<string, string | string[] | undefined> | URLSearchParams

const slugLike = /^[\p{L}\p{N}_-]{1,100}$/u

function getAll(raw: Raw, key: string): string[] {
  if (raw instanceof URLSearchParams) return raw.getAll(key)
  const v = raw[key]
  return v === undefined ? [] : Array.isArray(v) ? v : [v]
}
const first = (raw: Raw, key: string) => getAll(raw, key)[0]

function price(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 && n <= 1_000_000_000 ? Math.round(n) : undefined
}

/** يقرأ ويتحقق من معاملات الرابط (لا نثق بها): قيم غير صالحة تُهمل بصمت. */
export function parseSearchParams(raw: Raw): SearchParams {
  const out: SearchParams = {}
  const q = first(raw, "q")?.trim().slice(0, 100)
  if (q) out.q = q
  for (const key of ["category", "subcategory", "brand"] as const) {
    const v = first(raw, key)?.trim()
    if (v && slugLike.test(v)) out[key] = v
  }
  const colors = getAll(raw, "color").map((c) => c.trim().slice(0, 40)).filter(Boolean)
  if (colors.length) out.colors = [...new Set(colors)].slice(0, 6)
  const sizes = getAll(raw, "size").map((c) => c.trim().slice(0, 20)).filter(Boolean)
  if (sizes.length) out.sizes = [...new Set(sizes)].slice(0, 8)
  const min = price(first(raw, "min"))
  const max = price(first(raw, "max"))
  if (min !== undefined) out.minPrice = min
  if (max !== undefined) out.maxPrice = max
  if (out.minPrice !== undefined && out.maxPrice !== undefined && out.minPrice > out.maxPrice) {
    ;[out.minPrice, out.maxPrice] = [out.maxPrice, out.minPrice]
  }
  if (first(raw, "stock") === "1") out.inStock = true
  if (first(raw, "sale") === "1") out.onSale = true
  const sort = first(raw, "sort")
  if (sort && (SEARCH_SORTS as readonly string[]).includes(sort)) out.sort = sort as SearchSort
  const limit = Number(first(raw, "limit"))
  if (Number.isInteger(limit) && limit > 0) out.limit = Math.min(limit, SEARCH_MAX_LIMIT)
  return out
}

/** يبني استعلام الرابط من المعاملات (العكس). الحقول الافتراضية لا تُكتب. */
export function buildSearchQuery(p: SearchParams): string {
  const u = new URLSearchParams()
  if (p.q) u.set("q", p.q)
  if (p.category) u.set("category", p.category)
  if (p.subcategory) u.set("subcategory", p.subcategory)
  if (p.brand) u.set("brand", p.brand)
  for (const c of p.colors ?? []) u.append("color", c)
  for (const s of p.sizes ?? []) u.append("size", s)
  if (p.minPrice !== undefined) u.set("min", String(p.minPrice))
  if (p.maxPrice !== undefined) u.set("max", String(p.maxPrice))
  if (p.inStock) u.set("stock", "1")
  if (p.onSale) u.set("sale", "1")
  if (p.sort && p.sort !== "relevance") u.set("sort", p.sort)
  if (p.limit && p.limit > SEARCH_PAGE_SIZE) u.set("limit", String(p.limit))
  return u.toString()
}

/** عدد الفلاتر الفعّالة (بدون النص والترتيب) لعرضه على زر الفلاتر. */
export function activeFilterCount(p: SearchParams): number {
  return (
    (p.category ? 1 : 0) +
    (p.subcategory ? 1 : 0) +
    (p.brand ? 1 : 0) +
    (p.colors?.length ?? 0) +
    (p.sizes?.length ?? 0) +
    (p.minPrice !== undefined || p.maxPrice !== undefined ? 1 : 0) +
    (p.inStock ? 1 : 0) +
    (p.onSale ? 1 : 0)
  )
}
