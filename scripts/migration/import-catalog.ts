import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import { eq } from "drizzle-orm"
import type { PgDatabase } from "drizzle-orm/pg-core"
import * as s from "../../lib/db/store"
import { allocateProductCode, ensureCategoryCode } from "../../lib/product-code-db"
import { refreshProductSearch } from "../../lib/search-index"

// ============================================
// استيراد الكتالوج من ملفات JSON إلى جداول store (PostgreSQL).
//
// الأقسام والماركات والمنتجات تُحدَّث بحسب slug (آمن لإعادة التشغيل)، والسلايدر والتقييمات والإعلانات تُضاف مرة واحدة فقط إن كان جدولها فارغاً، والكوبونات بحسب الكود،
// ربط الماركة بالاسم، وتحويل وسوم new/bestseller إلى isNew/isBestseller مع إبقاء الوسوم.
// الصور تُحلّ عبر resolveImage المحقونة (R2 أو مسار محلي)، فيبقى هذا الملف قابلاً للاختبار.
// ============================================

export type SeedProduct = {
  id: string
  slug: string
  name: string
  description?: string
  price: number
  oldPrice?: number | null
  image?: string
  images?: string[]
  category: string
  subcategory?: string
  brand?: string
  rating?: number
  reviewsCount?: number
  colors?: { name: string; hex: string }[]
  sizes?: string[]
  stock?: number
  isNew?: boolean
  isBestseller?: boolean
  badge?: string
  tags?: string[]
  sku?: string
  metaTitle?: string
  metaDescription?: string
  keywords?: string[]
}
export type SeedCategory = {
  slug: string
  name: string
  image?: string
  description?: string
  metaTitle?: string
  metaDescription?: string
  keywords?: string[]
  subcategories?: { slug: string; name: string; description?: string }[]
}
export type SeedBrand = {
  slug: string
  name: string
  image?: string
  description?: string
  featured?: boolean
  metaTitle?: string
  metaDescription?: string
  keywords?: string[]
}
export type SeedSlide = { id: string; title: string; subtitle?: string; cta?: string; href?: string; image?: string }
export type SeedCoupon = { code: string; discount: number; type: "percent" | "fixed"; minOrder?: number; description: string }
export type SeedReview = { id: string; name: string; rating: number; comment: string; date: string }
export type SeedAd = { id: string; title: string; image?: string; href?: string; categories?: string[]; active?: boolean; frequency?: number; order?: number }

export type SeedData = {
  categories: SeedCategory[]
  brands: SeedBrand[]
  products: SeedProduct[]
  slides: SeedSlide[]
  coupons: SeedCoupon[]
  reviews: SeedReview[]
  ads: SeedAd[]
}

/** يقرأ ملفات البيانات من المجلد (المنتجات مرتبة أبجدياً لثبات الترتيب بين التشغيلات). */
export function loadSeedData(dataDir: string): SeedData {
  const read = <T,>(file: string): T => JSON.parse(readFileSync(path.join(dataDir, file), "utf8")) as T
  const productFiles = readdirSync(path.join(dataDir, "products")).filter((f) => f.endsWith(".json")).sort()
  return {
    categories: read<{ categories: SeedCategory[] }>("categories.json").categories,
    brands: read<{ brands: SeedBrand[] }>("brands.json").brands,
    products: productFiles.map((f) => read<SeedProduct>(path.join("products", f))),
    slides: read<{ slides: SeedSlide[] }>("slider.json").slides,
    coupons: read<{ coupons: SeedCoupon[] }>("coupons.json").coupons,
    reviews: read<{ reviews: SeedReview[] }>("reviews.json").reviews,
    ads: read<{ ads: SeedAd[] }>("ads.json").ads,
  }
}

/** كل مسارات الصور المذكورة في البيانات (بلا تكرار). */
export function collectImagePaths(data: SeedData): string[] {
  const all = [
    ...data.categories.map((c) => c.image),
    ...data.brands.map((b) => b.image),
    ...data.slides.map((x) => x.image),
    ...data.ads.map((a) => a.image),
    ...data.products.flatMap((p) => [p.image, ...(p.images ?? [])]),
  ]
  return [...new Set(all.filter((x): x is string => Boolean(x)))]
}

/** فحص العلاقات قبل الكتابة: أي خطأ يمنع الاستيراد، والتحذيرات تُعرض فقط. */
export function validateSeed(data: SeedData): { errors: string[]; warnings: string[] } {
  const errors: string[] = []
  const warnings: string[] = []
  const catSlugs = new Set(data.categories.map((c) => c.slug))
  const subSlugs = new Map(data.categories.map((c) => [c.slug, new Set((c.subcategories ?? []).map((x) => x.slug))]))
  const brandNames = new Set(data.brands.map((b) => b.name.trim()))
  const ids = new Set<string>()
  const slugs = new Set<string>()
  for (const p of data.products) {
    if (!catSlugs.has(p.category)) errors.push(`المنتج ${p.slug}: القسم غير موجود (${p.category})`)
    else if (p.subcategory && !subSlugs.get(p.category)!.has(p.subcategory)) {
      warnings.push(`المنتج ${p.slug}: القسم الفرعي غير موجود (${p.subcategory}) وسيُترك فارغاً`)
    }
    if (p.brand && !brandNames.has(p.brand.trim())) warnings.push(`المنتج ${p.slug}: براند غير معروف "${p.brand}" وسيُترك فارغاً`)
    if (ids.has(p.id)) errors.push(`رقم منتج مكرر: ${p.id}`)
    if (slugs.has(p.slug)) errors.push(`سلاج منتج مكرر: ${p.slug}`)
    ids.add(p.id)
    slugs.add(p.slug)
    if (typeof p.price !== "number" || p.price < 0) errors.push(`المنتج ${p.slug}: سعر غير صالح`)
  }
  for (const a of data.ads) {
    for (const slug of a.categories ?? []) {
      if (slug !== "all" && !catSlugs.has(slug)) warnings.push(`الإعلان ${a.id}: قسم غير معروف (${slug})`)
    }
  }
  for (const r of data.reviews) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date)) errors.push(`التقييم ${r.id}: تاريخ غير صالح (${r.date})`)
  }
  return { errors, warnings }
}

const PLACEHOLDER = "/placeholder.svg"

 
async function hasRows(tx: PgDatabase<any, any, any>, table: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const rows = await tx.select().from(table).limit(1)
  return rows.length > 0
}

export type ImportOptions = {
  /** يحوّل مسار صورة من البيانات إلى القيمة التي تُخزَّن (مفتاح R2 أو مسار محلي)، أو null إن فُقدت. الافتراضي: بلا صور. */
  resolveImage?: (publicPath: string) => Promise<string | null>
  log?: (message: string) => void
  /** يعيّن لكل منتج جديد رمزاً قصيراً (DR-012) بدل معرّف الملف. المنتجات الموجودة تحتفظ برقمها. */
  assignCodes?: boolean
}

export type ImportReport = {
  counts: Record<string, number>
  missingImages: string[]
  skipped: string[]
}

/**
 * يكتب كل البيانات في معاملة واحدة (إما كلها أو لا شيء). الصور تُحلّ قبل المعاملة
 * حتى لا تبقى معاملة مفتوحة أثناء رفع الملفات.
 */
export async function importCatalog(
  db: PgDatabase<any, any, any>, // eslint-disable-line @typescript-eslint/no-explicit-any
  data: SeedData,
  options: ImportOptions,
): Promise<ImportReport> {
  const log = options.log ?? (() => {})
  const { errors } = validateSeed(data)
  if (errors.length) throw new Error(`بيانات غير صالحة:\n- ${errors.join("\n- ")}`)

  // 1) الصور
  const images = new Map<string, string | null>()
  const missingImages: string[] = []
  for (const p of collectImagePaths(data)) {
    const value = options.resolveImage ? await options.resolveImage(p) : null
    images.set(p, value)
    if (!value) missingImages.push(p)
  }
  const img = (p?: string | null) => (p ? (images.get(p) ?? null) : null)
  const requiredImg = (p?: string | null) => img(p) ?? PLACEHOLDER

  const skipped: string[] = []
  const counts: Record<string, number> = {}

  await db.transaction(async (tx) => {
    // 2) الأقسام والأقسام الفرعية
    const categoryIds = new Map<string, string>()
    const subcategoryIds = new Map<string, string>() // `${categorySlug}/${subSlug}`
    for (const [i, c] of data.categories.entries()) {
      const values = {
        name: c.name,
        slug: c.slug,
        imageKey: img(c.image),
        description: c.description ?? null,
        metaTitle: c.metaTitle ?? null,
        metaDescription: c.metaDescription ?? null,
        keywords: c.keywords ?? [],
        sortOrder: i,
      }
      const [row] = await tx
        .insert(s.categories)
        .values(values)
        .onConflictDoUpdate({ target: s.categories.slug, set: values })
        .returning({ id: s.categories.id })
      categoryIds.set(c.slug, row.id)
      if (options.assignCodes) await ensureCategoryCode(tx, row.id)
      for (const [j, sub] of (c.subcategories ?? []).entries()) {
        const subValues = {
          categoryId: row.id,
          name: sub.name,
          slug: sub.slug,
          description: sub.description ?? null,
          sortOrder: j,
        }
        const [subRow] = await tx
          .insert(s.subcategories)
          .values(subValues)
          .onConflictDoUpdate({ target: [s.subcategories.categoryId, s.subcategories.slug], set: subValues })
          .returning({ id: s.subcategories.id })
        subcategoryIds.set(`${c.slug}/${sub.slug}`, subRow.id)
      }
    }
    counts.categories = data.categories.length
    counts.subcategories = subcategoryIds.size
    log(`الأقسام: ${counts.categories} (فرعية: ${counts.subcategories})`)

    // 3) الماركات
    const brandIdByName = new Map<string, string>()
    for (const [i, b] of data.brands.entries()) {
      const values = {
        name: b.name,
        slug: b.slug,
        imageKey: img(b.image),
        description: b.description ?? null,
        featured: Boolean(b.featured),
        metaTitle: b.metaTitle ?? null,
        metaDescription: b.metaDescription ?? null,
        keywords: b.keywords ?? [],
        sortOrder: i,
      }
      const [row] = await tx
        .insert(s.brands)
        .values(values)
        .onConflictDoUpdate({ target: s.brands.slug, set: values })
        .returning({ id: s.brands.id })
      brandIdByName.set(b.name.trim(), row.id)
    }
    counts.brands = data.brands.length
    log(`الماركات: ${counts.brands}`)

    // 4) المنتجات
    for (const [i, p] of data.products.entries()) {
      const tags = p.tags ?? []
      const values = {
        productNumber: p.id,
        name: p.name,
        slug: p.slug,
        categoryId: categoryIds.get(p.category)!,
        subcategoryId: p.subcategory ? (subcategoryIds.get(`${p.category}/${p.subcategory}`) ?? null) : null,
        brandId: p.brand ? (brandIdByName.get(p.brand.trim()) ?? null) : null,
        price: p.price,
        oldPrice: p.oldPrice ?? null,
        description: p.description ?? "",
        isNew: Boolean(p.isNew) || tags.includes("new"),
        isBestseller: Boolean(p.isBestseller) || tags.includes("bestseller"),
        mainImageKey: img(p.image),
        stock: p.stock ?? 0,
        sizes: p.sizes ?? [],
        // SKU القديم الذي يطابق المعرّف القديم للمنتج لا فائدة منه مع الرمز القصير الجديد، فلا يُستورد (يتكرر على صفحة المنتج).
        sku: options.assignCodes && p.sku === p.id ? null : (p.sku ?? null),
        badge: p.badge ?? null,
        tags,
        sortOrder: i,
        rating: p.rating ?? 5,
        reviewsCount: p.reviewsCount ?? 0,
        metaTitle: p.metaTitle ?? null,
        metaDescription: p.metaDescription ?? null,
        keywords: p.keywords ?? [],
        updatedAt: new Date(),
      }
      if (options.assignCodes) {
        const [existing] = await tx.select({ productNumber: s.products.productNumber }).from(s.products).where(eq(s.products.slug, p.slug)).limit(1)
        values.productNumber = existing?.productNumber ?? (await allocateProductCode(tx, values.categoryId))
      }
      const [row] = await tx
        .insert(s.products)
        .values(values)
        .onConflictDoUpdate({ target: s.products.slug, set: values })
        .returning({ id: s.products.id })

      await tx.delete(s.productImages).where(eq(s.productImages.productId, row.id))
      await tx.delete(s.productColors).where(eq(s.productColors.productId, row.id))
      const gallery = (p.images ?? []).map((x) => img(x)).filter((x): x is string => Boolean(x))
      if (gallery.length) {
        await tx.insert(s.productImages).values(gallery.map((imageKey, j) => ({ productId: row.id, imageKey, sortOrder: j })))
      }
      const colors = p.colors ?? []
      if (colors.length) {
        await tx.insert(s.productColors).values(colors.map((c, j) => ({ productId: row.id, name: c.name, hex: c.hex, sortOrder: j })))
      }
    }
    counts.products = data.products.length
    await refreshProductSearch(tx)
    log(`المنتجات: ${counts.products}`)

    // 5) السلايدر
    const slidesExisted = await hasRows(tx, s.slides)
    for (const [i, sl] of data.slides.entries()) {
      const values = {
        title: sl.title,
        subtitle: sl.subtitle ?? null,
        cta: sl.cta ?? null,
        href: sl.href ?? null,
        imageKey: requiredImg(sl.image),
        sortOrder: i,
      }
      if (!slidesExisted) await tx.insert(s.slides).values(values)
    }
    counts.slides = data.slides.length

    // 6) الكوبونات
    for (const c of data.coupons) {
      const values = {
        code: c.code,
        discount: c.discount,
        type: c.type,
        minOrder: c.minOrder ?? 0,
        description: c.description,
      }
      await tx.insert(s.coupons).values(values).onConflictDoNothing()
    }
    counts.coupons = data.coupons.length

    // 7) التقييمات
    const reviewsExisted = await hasRows(tx, s.reviews)
    for (const r of data.reviews) {
      const values = {
        name: r.name,
        rating: r.rating,
        comment: r.comment,
        reviewDate: r.date,
      }
      if (!reviewsExisted) await tx.insert(s.reviews).values(values)
    }
    counts.reviews = data.reviews.length

    // 8) الإعلانات ("all" تعني كل الأقسام ⇒ بلا روابط)
    const adsExisted = await hasRows(tx, s.ads)
    for (const [i, a] of data.ads.entries()) {
      const values = {
        title: a.title,
        imageKey: requiredImg(a.image),
        href: a.href ?? null,
        active: a.active !== false,
        frequency: a.frequency ?? 6,
        sortOrder: a.order ?? i,
      }
      if (adsExisted) continue
      const [row] = await tx.insert(s.ads).values(values).returning({ id: s.ads.id })
      const links = (a.categories ?? [])
        .filter((slug) => slug !== "all")
        .map((slug) => categoryIds.get(slug))
        .filter((id): id is string => Boolean(id))
      if (links.length) await tx.insert(s.adCategories).values(links.map((categoryId) => ({ adId: row.id, categoryId })))
    }
    counts.ads = data.ads.length
    log(`السلايدر ${counts.slides} · كوبونات ${counts.coupons} · تقييمات ${counts.reviews} · إعلانات ${counts.ads}`)
  })

  return { counts, missingImages, skipped }
}
