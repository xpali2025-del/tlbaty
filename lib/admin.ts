import "server-only"
import { asc, desc, eq, inArray, sql } from "drizzle-orm"
import { db } from "@/lib/db/client"
import { isDbConfigured } from "@/lib/db-cache"
import {
  adCategories,
  ads,
  brands,
  categories,
  coupons,
  currencies,
  paymentAccounts,
  productColors,
  productImages,
  products,
  reviews,
  shippingMethods,
  shippingZones,
  siteSettings,
  slides,
  subcategories,
} from "@/lib/db/store"
import { resolveOptionalImageUrl } from "@/lib/images"

// ============================================
// قراءات لوحة الإدارة على PostgreSQL. بلا كاش (بيانات حيّة دائماً)، وبلا DATABASE_URL
// تعيد قيمة فارغة آمنة. المعرّف _id هو UUID الصف، والمرجع ref لصورة هو مفتاح التخزين.
// ============================================

async function adminFetch<T>(fallback: T, load: () => Promise<T>): Promise<T> {
  if (!isDbConfigured()) return fallback
  return load()
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : undefined)
const opt = <T,>(v: T | null | undefined): T | undefined => v ?? undefined

export type AdminColor = { name: string; hex: string }

export type AdminProduct = {
  _id: string
  productId?: string
  name: string
  slug?: string
  description?: string
  price?: number
  oldPrice?: number
  categoryId?: string
  categoryName?: string
  categorySlug?: string
  subcategory?: string
  brandId?: string
  brandName?: string
  image?: string
  images: { url: string; ref: string }[]
  stock?: number
  isNew?: boolean
  isBestseller?: boolean
  badge?: string
  sortOrder?: number
  rating?: number
  reviewsCount?: number
  sku?: string
  metaTitle?: string
  metaDescription?: string
  keywords?: string[]
  colors: AdminColor[]
  sizes: string[]
  tags?: string[]
}

export type AdminSubcategory = { name: string; slug?: string; description?: string }

export type AdminCategory = {
  _id: string
  name: string
  slug?: string
  /** رمز القسم الذي يبدأ به رمز كل منتج فيه (DR → DR-012). */
  code?: string
  description?: string
  image?: string
  sortOrder?: number
  metaTitle?: string
  metaDescription?: string
  keywords?: string[]
  subcategories: AdminSubcategory[]
  productCount: number
}

export type AdminBrand = {
  _id: string
  name: string
  slug?: string
  description?: string
  image?: string
  featured?: boolean
  sortOrder?: number
  metaTitle?: string
  metaDescription?: string
  keywords?: string[]
  productCount: number
}

export type AdminSlide = {
  _id: string
  title: string
  subtitle?: string
  cta?: string
  href?: string
  image?: string
  sortOrder?: number
}

export type AdminCoupon = {
  _id: string
  code: string
  discount: number
  type: "percent" | "fixed"
  minOrder?: number
  description?: string
}

export type AdminReview = {
  _id: string
  name: string
  rating: number
  comment: string
  date?: string
  avatar?: string
}

export type AdminAd = {
  _id: string
  title: string
  image?: string
  href?: string
  active?: boolean
  frequency?: number
  sortOrder?: number
  categoryIds: string[]
}

export type AdminSettings = {
  _id: string
  name?: string
  tagline?: string
  description?: string
  logo?: string
  phone?: string
  whatsapp?: string
  email?: string
  address?: string
  workingHours?: string
  nameEn?: string
  secondaryPhone?: string
  social?: { instagram?: string; facebook?: string; tiktok?: string; x?: string; youtube?: string; snapchat?: string; telegram?: string }
  copyright?: string
  /** طرق الدفع المفعّلة في صفحة الدفع. */
  payments: { cashOnDelivery: boolean; manualTransfer: boolean }
} | null

/** حساب دفع كما يُعرض في لوحة الإدارة (يشمل المعطّل). */
export type AdminPaymentAccount = {
  _id: string
  providerName: string
  accountDisplayName?: string
  accountHolderName?: string
  accountNumber?: string
  image?: string
  imageRef?: string
  instructions?: string
  isActive: boolean
  sortOrder: number
  createdAt?: string
  updatedAt?: string
  /** عدد الطلبات لا يُحسب هنا لأن الطلبات في قاعدة البيانات. */
}

// ---------- الاستعلامات ----------


async function productCounts(column: typeof products.categoryId | typeof products.brandId): Promise<Map<string, number>> {
  const rows = await db
    .select({ id: column, n: sql<number>`count(*)::int` })
    .from(products)
    .groupBy(column)
  return new Map(rows.filter((r): r is { id: string; n: number } => Boolean(r.id)).map((r) => [r.id, r.n]))
}

export const getAdminProducts = () =>
  adminFetch<AdminProduct[]>([], async () => {
    const rows = await db
      .select({
        p: products,
        categorySlug: categories.slug,
        categoryName: categories.name,
        subcategorySlug: subcategories.slug,
        brandName: brands.name,
      })
      .from(products)
      .innerJoin(categories, eq(categories.id, products.categoryId))
      .leftJoin(subcategories, eq(subcategories.id, products.subcategoryId))
      .leftJoin(brands, eq(brands.id, products.brandId))
      .orderBy(asc(products.sortOrder), asc(products.name))
    if (rows.length === 0) return []
    const ids = rows.map((r) => r.p.id)
    const [images, colors] = await Promise.all([
      db.select().from(productImages).where(inArray(productImages.productId, ids)).orderBy(asc(productImages.sortOrder)),
      db.select().from(productColors).where(inArray(productColors.productId, ids)).orderBy(asc(productColors.sortOrder)),
    ])
    return rows.map(({ p, categorySlug, categoryName, subcategorySlug, brandName }) => ({
      _id: p.id,
      productId: p.productNumber,
      name: p.name,
      slug: p.slug,
      description: p.description,
      price: p.price,
      oldPrice: opt(p.oldPrice),
      categoryId: p.categoryId,
      categoryName,
      categorySlug,
      subcategory: opt(subcategorySlug),
      brandId: opt(p.brandId),
      brandName: opt(brandName),
      image: resolveOptionalImageUrl(p.mainImageKey),
      images: images
        .filter((i) => i.productId === p.id)
        .map((i) => ({ url: resolveOptionalImageUrl(i.imageKey) as string, ref: i.imageKey })),
      stock: p.stock,
      isNew: p.isNew,
      isBestseller: p.isBestseller,
      badge: opt(p.badge),
      sortOrder: p.sortOrder,
      rating: p.rating,
      reviewsCount: p.reviewsCount,
      sku: opt(p.sku),
      metaTitle: opt(p.metaTitle),
      metaDescription: opt(p.metaDescription),
      keywords: p.keywords,
      colors: colors.filter((c) => c.productId === p.id).map((c) => ({ name: c.name, hex: c.hex })),
      sizes: p.sizes,
      tags: p.tags,
    }))
  })

export const getAdminCategories = () =>
  adminFetch<AdminCategory[]>([], async () => {
    const [rows, subs, counts] = await Promise.all([
      db.select().from(categories).orderBy(asc(categories.sortOrder), asc(categories.name)),
      db.select().from(subcategories).orderBy(asc(subcategories.sortOrder), asc(subcategories.name)),
      productCounts(products.categoryId),
    ])
    return rows.map((c) => ({
      _id: c.id,
      name: c.name,
      slug: c.slug,
      code: opt(c.code),
      description: opt(c.description),
      image: resolveOptionalImageUrl(c.imageKey),
      sortOrder: c.sortOrder,
      metaTitle: opt(c.metaTitle),
      metaDescription: opt(c.metaDescription),
      keywords: c.keywords,
      subcategories: subs
        .filter((x) => x.categoryId === c.id)
        .map((x) => ({ name: x.name, slug: x.slug, description: opt(x.description) })),
      productCount: counts.get(c.id) ?? 0,
    }))
  })

export const getAdminBrands = () =>
  adminFetch<AdminBrand[]>([], async () => {
    const [rows, counts] = await Promise.all([
      db.select().from(brands).orderBy(asc(brands.sortOrder), asc(brands.name)),
      productCounts(products.brandId),
    ])
    return rows.map((b) => ({
      _id: b.id,
      name: b.name,
      slug: b.slug,
      description: opt(b.description),
      image: resolveOptionalImageUrl(b.imageKey),
      featured: b.featured,
      sortOrder: b.sortOrder,
      metaTitle: opt(b.metaTitle),
      metaDescription: opt(b.metaDescription),
      keywords: b.keywords,
      productCount: counts.get(b.id) ?? 0,
    }))
  })

export const getAdminSlides = () =>
  adminFetch<AdminSlide[]>([], async () =>
    (await db.select().from(slides).orderBy(asc(slides.sortOrder))).map((x) => ({
      _id: x.id,
      title: x.title,
      subtitle: opt(x.subtitle),
      cta: opt(x.cta),
      href: opt(x.href),
      image: resolveOptionalImageUrl(x.imageKey),
      sortOrder: x.sortOrder,
    })),
  )

export const getAdminCoupons = () =>
  adminFetch<AdminCoupon[]>([], async () =>
    (await db.select().from(coupons).orderBy(desc(coupons.createdAt))).map((c) => ({
      _id: c.id,
      code: c.code,
      discount: c.discount,
      type: c.type,
      minOrder: c.minOrder,
      description: c.description,
    })),
  )

export const getAdminReviews = () =>
  adminFetch<AdminReview[]>([], async () =>
    (await db.select().from(reviews).orderBy(desc(reviews.reviewDate), desc(reviews.createdAt))).map((r) => ({
      _id: r.id,
      name: r.name,
      rating: r.rating,
      comment: r.comment,
      date: r.reviewDate,
      avatar: resolveOptionalImageUrl(r.avatarKey),
    })),
  )

export const getAdminAds = () =>
  adminFetch<AdminAd[]>([], async () => {
    const rows = await db.select().from(ads).orderBy(asc(ads.sortOrder))
    if (rows.length === 0) return []
    const links = await db.select().from(adCategories).where(inArray(adCategories.adId, rows.map((r) => r.id)))
    return rows.map((a) => ({
      _id: a.id,
      title: a.title,
      image: resolveOptionalImageUrl(a.imageKey),
      href: opt(a.href),
      active: a.active,
      frequency: a.frequency,
      sortOrder: a.sortOrder,
      categoryIds: links.filter((l) => l.adId === a.id).map((l) => l.categoryId),
    }))
  })

export const getAdminSettings = () =>
  adminFetch<AdminSettings>(null, async () => {
    const [x] = await db.select().from(siteSettings).limit(1)
    if (!x) return null
    return {
      _id: String(x.id),
      name: opt(x.name),
      tagline: opt(x.tagline),
      description: opt(x.description),
      logo: resolveOptionalImageUrl(x.logoKey),
      phone: opt(x.phone),
      whatsapp: opt(x.whatsapp),
      email: opt(x.email),
      address: opt(x.address),
      workingHours: opt(x.workingHours),
      nameEn: opt(x.nameEn),
      secondaryPhone: opt(x.secondaryPhone),
      social: {
        instagram: opt(x.instagram),
        facebook: opt(x.facebook),
        tiktok: opt(x.tiktok),
        x: opt(x.x),
        youtube: opt(x.youtube),
        snapchat: opt(x.snapchat),
        telegram: opt(x.telegram),
      },
      copyright: opt(x.copyright),
      payments: { cashOnDelivery: x.codEnabled, manualTransfer: x.transferEnabled },
    }
  })

export const getAdminPaymentAccounts = () =>
  adminFetch<AdminPaymentAccount[]>([], async () =>
    (await db.select().from(paymentAccounts).orderBy(asc(paymentAccounts.sortOrder), asc(paymentAccounts.providerName))).map((a) => ({
      _id: a.id,
      providerName: a.providerName,
      accountDisplayName: opt(a.accountDisplayName),
      accountHolderName: opt(a.accountHolderName),
      accountNumber: opt(a.accountNumber),
      image: resolveOptionalImageUrl(a.imageKey),
      imageRef: opt(a.imageKey),
      instructions: opt(a.instructions),
      isActive: a.isActive,
      sortOrder: a.sortOrder,
      createdAt: iso(a.createdAt),
      updatedAt: iso(a.updatedAt),
    })),
  )

// ---------- الشحن والعملات ----------

export type AdminShippingMethod = { name: string; description: string; price: number; icon: "express" | "standard" | "pickup" }
export type AdminShippingZone = { _id: string; governorate: string; isDefault: boolean; methods: AdminShippingMethod[] }
export type AdminCurrency = { code: string; name: string; symbol: string; rate: number; updatedAt?: string }
export type AdminShipping = { zones: AdminShippingZone[]; currencies: AdminCurrency[]; defaultCurrency: string }

export const getAdminShipping = () =>
  adminFetch<AdminShipping>({ zones: [], currencies: [], defaultCurrency: "YER" }, async () => {
    const [zones, methods, rates, [settings]] = await Promise.all([
      db.select().from(shippingZones).orderBy(desc(shippingZones.isDefault), asc(shippingZones.governorate)),
      db.select().from(shippingMethods).orderBy(asc(shippingMethods.sortOrder), asc(shippingMethods.name)),
      db.select().from(currencies).orderBy(asc(currencies.sortOrder), asc(currencies.code)),
      db.select({ defaultCurrency: siteSettings.defaultCurrency }).from(siteSettings).limit(1),
    ])
    return {
      zones: zones.map((z) => ({
        _id: z.id,
        governorate: z.governorate ?? "",
        isDefault: z.isDefault,
        methods: methods
          .filter((m) => m.zoneId === z.id)
          .map((m) => ({ name: m.name, description: m.description ?? "", price: m.price, icon: m.icon })),
      })),
      currencies: rates.map((c) => ({ code: c.code, name: c.name, symbol: c.symbol, rate: c.rate, updatedAt: c.updatedAt.toISOString() })),
      defaultCurrency: settings?.defaultCurrency ?? "YER",
    }
  })
