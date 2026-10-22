import "server-only"
import { cache } from "react"
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lt, or, sql, type SQL } from "drizzle-orm"
import { db } from "@/lib/db/client"
import {
  adCategories,
  ads,
  brands,
  categories,
  coupons,
  currencies,
  paymentAccounts,
  productColors,
  productVariants,
  productImages,
  products,
  reviews,
  shippingMethods,
  shippingZones,
  siteSettings,
  slides,
  subcategories,
} from "@/lib/db/store"
import {
  CACHE_TAGS,
  brandProductsTag,
  brandTag,
  categoryProductsTag,
  categoryTag,
  productTag,
} from "@/lib/cache-tags"
import { dbCached } from "@/lib/db-cache"
import { resolveImageUrl, resolveOptionalImageUrl } from "@/lib/images"
import type { Product, Category, Subcategory, Slide, Coupon, Review, Ad, Brand, ShippingZone } from "./types"
import type { PaymentAccount } from "./payment"
import {
  DEFAULT_CURRENCY_SETTINGS,
  normalizeCurrencies,
  type CurrencySettings,
} from "./currency"

// ============================================
// طبقة قراءة المتجر على PostgreSQL (Drizzle).
//
// الأسماء وأشكال المخرجات مطابقة لما كانت تُرجعه استعلامات GROQ سابقاً (lib/types.ts)،
// فلا يتغير أي مكوّن أو صفحة. كل قراءة مخزَّنة في Data Cache بوسوم، وتُبطَل فقط من
// إجراءات الإدارة (revalidateStore). بلا DATABASE_URL تعيد كل دالة قيمة افتراضية آمنة.
// ============================================

/** كل إسقاطات المنتجات تعرض بيانات مرجعية من القسم والبراند. */
const PRODUCT_REFERENCE_TAGS = [CACHE_TAGS.categoryReferences, CACHE_TAGS.brandReferences]

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const nullToUndefined = <T>(value: T | null | undefined): T | undefined => value ?? undefined

/**
 * يجلب المنتجات (مع الصور والألوان) بشرط اختياري. الترتيب: sortOrder ثم الاسم.
 * Product.id هو رقم المنتج (productNumber) لا المعرّف الداخلي، لأن السلة والطلبات تعتمد عليه.
 */
async function loadProducts(where?: SQL): Promise<Product[]> {
  const rows = await db
    .select({
      uuid: products.id,
      id: products.productNumber,
      slug: products.slug,
      name: products.name,
      description: products.description,
      price: products.price,
      oldPrice: products.oldPrice,
      mainImageKey: products.mainImageKey,
      category: categories.slug,
      subcategory: subcategories.slug,
      brand: brands.name,
      rating: products.rating,
      reviewsCount: products.reviewsCount,
      sizes: products.sizes,
      stock: products.stock,
      isNew: products.isNew,
      isBestseller: products.isBestseller,
      badge: products.badge,
      tags: products.tags,
      metaTitle: products.metaTitle,
      metaDescription: products.metaDescription,
      keywords: products.keywords,
      sku: products.sku,
    })
    .from(products)
    .innerJoin(categories, eq(categories.id, products.categoryId))
    .leftJoin(subcategories, eq(subcategories.id, products.subcategoryId))
    .leftJoin(brands, eq(brands.id, products.brandId))
    .where(where)
    .orderBy(asc(products.sortOrder), asc(products.name))

  if (rows.length === 0) return []
  const ids = rows.map((r) => r.uuid)
  const [images, colors, variants] = await Promise.all([
    db.select().from(productImages).where(inArray(productImages.productId, ids)).orderBy(asc(productImages.sortOrder)),
    db.select().from(productColors).where(inArray(productColors.productId, ids)).orderBy(asc(productColors.sortOrder)),
    db.select().from(productVariants).where(inArray(productVariants.productId, ids)),
  ])
  const variantsByProduct = new Map<string, { color: string; size: string; stock: number }[]>()
  for (const v of variants) {
    const list = variantsByProduct.get(v.productId) ?? []
    list.push({ color: v.color, size: v.size, stock: v.stock })
    variantsByProduct.set(v.productId, list)
  }
  const imagesByProduct = new Map<string, string[]>()
  for (const img of images) {
    const list = imagesByProduct.get(img.productId) ?? []
    list.push(resolveImageUrl(img.imageKey))
    imagesByProduct.set(img.productId, list)
  }
  const colorsByProduct = new Map<string, { name: string; hex: string }[]>()
  for (const c of colors) {
    const list = colorsByProduct.get(c.productId) ?? []
    list.push({ name: c.name, hex: c.hex })
    colorsByProduct.set(c.productId, list)
  }

  return rows.map(({ uuid, mainImageKey, subcategory, brand, oldPrice, badge, metaTitle, metaDescription, sku, ...r }) => ({
    ...r,
    image: resolveImageUrl(mainImageKey),
    images: imagesByProduct.get(uuid) ?? [],
    colors: colorsByProduct.get(uuid) ?? [],
    variantStock: variantsByProduct.get(uuid),
    subcategory: nullToUndefined(subcategory),
    brand: nullToUndefined(brand),
    oldPrice: nullToUndefined(oldPrice),
    badge: nullToUndefined(badge),
    metaTitle: nullToUndefined(metaTitle),
    metaDescription: nullToUndefined(metaDescription),
    sku: nullToUndefined(sku),
  }))
}

/** منتجات بأرقامها (رمز المنتج) بدقة وبالترتيب المطلوب — للبحث. بلا كاش: المعرّفات تأتي من استعلام حيّ. */
export async function getProductsByNumbers(numbers: string[]): Promise<Product[]> {
  if (numbers.length === 0) return []
  const rows = await loadProducts(inArray(products.productNumber, numbers))
  const order = new Map(numbers.map((n, i) => [n, i]))
  return rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
}

export const getProducts = cache(async (): Promise<Product[]> =>
  dbCached({
    keyParts: ["store", "products", "all"],
    tags: [CACHE_TAGS.products, ...PRODUCT_REFERENCE_TAGS],
    fallback: [],
    load: () => loadProducts(),
  }),
)

export const getProductBySlug = cache(async (slug: string): Promise<Product | undefined> => {
  const [product] = await dbCached<Product[]>({
    keyParts: ["store", "product", slug],
    tags: [productTag(slug), ...PRODUCT_REFERENCE_TAGS],
    fallback: [],
    load: () => loadProducts(eq(products.slug, slug)),
  })
  return product
})

export const getProductById = cache(async (id: string): Promise<Product | undefined> => {
  const all = await getProducts()
  return all.find((p) => p.id === id)
})

export const getProductsByCategory = cache(async (categorySlug: string): Promise<Product[]> =>
  dbCached({
    keyParts: ["store", "products-by-category", categorySlug],
    tags: [categoryProductsTag(categorySlug), ...PRODUCT_REFERENCE_TAGS],
    fallback: [],
    load: () => loadProducts(eq(categories.slug, categorySlug)),
  }),
)

export const getProductsBySubcategory = cache(async (subcategorySlug: string): Promise<Product[]> => {
  const all = await getProducts()
  return all.filter((p) => p.subcategory === subcategorySlug)
})

export const getBestsellers = cache(async (): Promise<Product[]> =>
  dbCached({
    keyParts: ["store", "products", "bestsellers"],
    tags: [CACHE_TAGS.bestsellerProducts, ...PRODUCT_REFERENCE_TAGS],
    fallback: [],
    load: () => loadProducts(sql`(${products.isBestseller} or 'bestseller' = any(${products.tags}))`),
  }),
)

export const getNewArrivals = cache(async (): Promise<Product[]> =>
  dbCached({
    keyParts: ["store", "products", "new"],
    tags: [CACHE_TAGS.newProducts, ...PRODUCT_REFERENCE_TAGS],
    fallback: [],
    load: () => loadProducts(sql`(${products.isNew} or 'new' = any(${products.tags}))`),
  }),
)

export const getOfferProducts = cache(async (): Promise<Product[]> =>
  dbCached({
    keyParts: ["store", "products", "offers"],
    tags: [CACHE_TAGS.offerProducts, ...PRODUCT_REFERENCE_TAGS],
    fallback: [],
    load: () =>
      loadProducts(
        sql`((${products.oldPrice} is not null and ${products.oldPrice} > ${products.price}) or 'offer' = any(${products.tags}))`,
      ),
  }),
)

/** بحث نصي بسيط على الاسم والوصف وسلاج القسم (نفس سلوك الإصدار السابق). */
export async function searchProducts(query: string): Promise<Product[]> {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const all = await getProducts()
  return all.filter(
    (p) =>
      p.name.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q) ||
      p.category.toLowerCase().includes(q),
  )
}

/** سلاجات المنتجات — للاستخدام في generateStaticParams و sitemap */
export const getProductSlugs = cache(async (): Promise<string[]> =>
  dbCached({
    keyParts: ["store", "product-slugs"],
    tags: [CACHE_TAGS.productSlugs],
    fallback: [],
    load: async () => (await db.select({ slug: products.slug }).from(products)).map((r) => r.slug),
  }),
)

// ---------- الأقسام ----------

async function loadCategories(where?: SQL): Promise<Category[]> {
  const rows = await db
    .select()
    .from(categories)
    .where(where)
    .orderBy(asc(categories.sortOrder), asc(categories.name))
  if (rows.length === 0) return []
  const ids = rows.map((r) => r.id)
  const [subs, counts] = await Promise.all([
    db
      .select()
      .from(subcategories)
      .where(inArray(subcategories.categoryId, ids))
      .orderBy(asc(subcategories.sortOrder), asc(subcategories.name)),
    db
      .select({ categoryId: products.categoryId, n: sql<number>`count(*)::int` })
      .from(products)
      .where(inArray(products.categoryId, ids))
      .groupBy(products.categoryId),
  ])
  const countById = new Map(counts.map((c) => [c.categoryId, c.n]))
  return rows.map((c) => ({
    id: c.slug,
    slug: c.slug,
    name: c.name,
    image: resolveImageUrl(c.imageKey),
    productCount: countById.get(c.id) ?? 0,
    description: nullToUndefined(c.description),
    metaTitle: nullToUndefined(c.metaTitle),
    metaDescription: nullToUndefined(c.metaDescription),
    keywords: c.keywords,
    subcategories: subs
      .filter((s) => s.categoryId === c.id)
      .map((s): Subcategory => ({
        id: s.slug,
        slug: s.slug,
        name: s.name,
        description: nullToUndefined(s.description),
      })),
  }))
}

export const getCategories = cache(async (): Promise<Category[]> =>
  dbCached({
    keyParts: ["store", "categories"],
    tags: [CACHE_TAGS.categories],
    fallback: [],
    load: () => loadCategories(),
  }),
)

export const getCategoryBySlug = cache(async (slug: string): Promise<Category | undefined> => {
  const [category] = await dbCached<Category[]>({
    keyParts: ["store", "category", slug],
    tags: [categoryTag(slug)],
    fallback: [],
    load: () => loadCategories(eq(categories.slug, slug)),
  })
  return category
})

export const getCategorySlugs = cache(async (): Promise<string[]> =>
  dbCached({
    keyParts: ["store", "category-slugs"],
    tags: [CACHE_TAGS.categorySlugs],
    fallback: [],
    load: async () => (await db.select({ slug: categories.slug }).from(categories)).map((r) => r.slug),
  }),
)

/**
 * روابط أقسام الفوتر — تُبنى ديناميكياً من الأقسام الفعلية حتى لا تظهر أقسام محذوفة
 * أو روابط تؤدي إلى 404. عند غياب القاعدة تُرجَع قائمة فارغة آمنة.
 */
export const getFooterCategories = cache(async (): Promise<{ label: string; href: string }[]> => {
  const list = await getCategories()
  return list.map((c) => ({ label: c.name, href: `/category/${c.slug}` }))
})

export async function getSubcategories(categorySlug: string): Promise<Subcategory[]> {
  const category = await getCategoryBySlug(categorySlug)
  return category?.subcategories ?? []
}

export async function getSubcategoryBySlug(
  categorySlug: string,
  subcategorySlug: string,
): Promise<Subcategory | undefined> {
  const subs = await getSubcategories(categorySlug)
  return subs.find((s) => s.slug === subcategorySlug)
}

/** عدد المنتجات الفعلي في كل قسم فرعي */
export async function getSubcategoriesWithCounts(
  categorySlug: string,
): Promise<(Subcategory & { count: number })[]> {
  const [subs, list] = await Promise.all([getSubcategories(categorySlug), getProductsByCategory(categorySlug)])
  return subs.map((sub) => ({ ...sub, count: list.filter((p) => p.subcategory === sub.slug).length }))
}

// ---------- الماركات ----------

async function loadBrands(where?: SQL): Promise<Brand[]> {
  const rows = await db.select().from(brands).where(where).orderBy(asc(brands.sortOrder), asc(brands.name))
  if (rows.length === 0) return []
  const counts = await db
    .select({ brandId: products.brandId, n: sql<number>`count(*)::int` })
    .from(products)
    .where(and(isNotNull(products.brandId), inArray(products.brandId, rows.map((r) => r.id))))
    .groupBy(products.brandId)
  const countById = new Map(counts.map((c) => [c.brandId, c.n]))
  return rows.map((b) => ({
    id: b.slug,
    slug: b.slug,
    name: b.name,
    image: resolveImageUrl(b.imageKey),
    description: nullToUndefined(b.description),
    featured: b.featured,
    metaTitle: nullToUndefined(b.metaTitle),
    metaDescription: nullToUndefined(b.metaDescription),
    keywords: b.keywords,
    productCount: countById.get(b.id) ?? 0,
  }))
}

export const getBrands = cache(async (): Promise<Brand[]> =>
  dbCached({
    keyParts: ["store", "brands"],
    tags: [CACHE_TAGS.brands],
    fallback: [],
    load: () => loadBrands(),
  }),
)

export const getBrandBySlug = cache(async (slug: string): Promise<Brand | undefined> => {
  const [brand] = await dbCached<Brand[]>({
    keyParts: ["store", "brand", slug],
    tags: [brandTag(slug)],
    fallback: [],
    load: () => loadBrands(eq(brands.slug, slug)),
  })
  return brand
})

export const getBrandSlugs = cache(async (): Promise<string[]> =>
  dbCached({
    keyParts: ["store", "brand-slugs"],
    tags: [CACHE_TAGS.brandSlugs],
    fallback: [],
    load: async () => (await db.select({ slug: brands.slug }).from(brands)).map((r) => r.slug),
  }),
)

/** كل المنتجات بنفس البراند مجمّعة من جميع الأقسام */
export const getProductsByBrand = cache(async (brandSlug: string): Promise<Product[]> =>
  dbCached({
    keyParts: ["store", "products-by-brand", brandSlug],
    tags: [brandProductsTag(brandSlug), ...PRODUCT_REFERENCE_TAGS],
    fallback: [],
    load: () => loadProducts(eq(brands.slug, brandSlug)),
  }),
)

// ---------- المحتوى التسويقي والإعدادات ----------

export const getSlides = cache(async (): Promise<Slide[]> =>
  dbCached({
    keyParts: ["store", "slides"],
    tags: [CACHE_TAGS.slides],
    fallback: [],
    load: async () => {
      const rows = await db.select().from(slides).orderBy(asc(slides.sortOrder))
      return rows.map((s) => ({
        id: s.id,
        title: s.title,
        subtitle: s.subtitle ?? "",
        cta: s.cta ?? "",
        href: s.href ?? "/",
        image: resolveImageUrl(s.imageKey),
      }))
    },
  }),
)

export const getCoupons = cache(async (): Promise<Coupon[]> =>
  dbCached({
    keyParts: ["store", "coupons"],
    tags: [CACHE_TAGS.coupons],
    fallback: [],
    load: async () => {
      // العامة فقط: كود شخصي لعميل (تذكير السلة…) لا يظهر في قائمة يراها الجميع.
      const rows = await db.select().from(coupons).where(isNull(coupons.customerId)).orderBy(asc(coupons.code))
      return rows.map(toCoupon)
    },
  }),
)

const toCoupon = (c: typeof coupons.$inferSelect): Coupon => ({
  code: c.code,
  discount: c.discount,
  type: c.type,
  minOrder: c.minOrder,
  description: c.description,
})

/**
 * أكواد العميل الشخصية الصالحة الآن (غير منتهية ولم تُستهلك). بلا كاش: تختلف من عميل لآخر.
 * مصدر الحقيقة لخصم الطلب على الخادم وللأكواد التي تصل لمتصفح العميل نفسه فقط.
 */
export async function getPersonalCoupons(customerId: string): Promise<Coupon[]> {
  if (!process.env.DATABASE_URL) return []
  const rows = await db
    .select()
    .from(coupons)
    .where(
      and(
        eq(coupons.customerId, customerId),
        or(isNull(coupons.expiresAt), gt(coupons.expiresAt, new Date())),
        or(isNull(coupons.maxUses), lt(coupons.usedCount, coupons.maxUses)),
      ),
    )
  return rows.map(toCoupon)
}

/** العامة + الشخصية لهذا العميل. */
export async function getCouponsForCustomer(customerId: string): Promise<Coupon[]> {
  const [shared, personal] = await Promise.all([getCoupons(), getPersonalCoupons(customerId)])
  return [...shared, ...personal]
}

/** طرق التوصيل حسب المحافظة — تُدار من لوحة الإدارة */
export const getShippingZones = cache(async (): Promise<ShippingZone[]> =>
  dbCached({
    keyParts: ["store", "shipping-zones"],
    tags: [CACHE_TAGS.shippingZones],
    fallback: [],
    load: async () => {
      const zones = await db
        .select()
        .from(shippingZones)
        .orderBy(desc(shippingZones.isDefault), asc(shippingZones.governorate))
      if (zones.length === 0) return []
      const methods = await db
        .select()
        .from(shippingMethods)
        .where(inArray(shippingMethods.zoneId, zones.map((z) => z.id)))
        .orderBy(asc(shippingMethods.sortOrder), asc(shippingMethods.name))
      return zones.map((z) => ({
        id: z.id,
        governorate: z.governorate ?? "",
        isDefault: z.isDefault,
        methods: methods
          .filter((m) => m.zoneId === z.id)
          .map((m) => ({
            id: m.id,
            name: m.name,
            desc: m.description ?? "",
            price: m.price,
            icon: m.icon,
          })),
      }))
    },
  }),
)

/**
 * حسابات الدفع المفعّلة فقط — تُعرض للعميل في صفحة إتمام الطلب.
 * الحسابات المعطّلة أو غير المكتملة لا تصل للعميل إطلاقاً.
 */
export const getPaymentAccounts = cache(async (): Promise<PaymentAccount[]> =>
  dbCached({
    keyParts: ["store", "payment-accounts"],
    tags: [CACHE_TAGS.paymentAccounts],
    fallback: [],
    load: async () => {
      const rows = await db
        .select()
        .from(paymentAccounts)
        .where(eq(paymentAccounts.isActive, true))
        .orderBy(asc(paymentAccounts.sortOrder), asc(paymentAccounts.providerName))
      return rows
        .filter((a) => a.providerName && a.accountHolderName && a.accountNumber)
        .map((a) => ({
          id: a.id,
          providerName: a.providerName,
          accountDisplayName: a.accountDisplayName ?? "",
          accountHolderName: a.accountHolderName,
          accountNumber: a.accountNumber,
          imageUrl: resolveOptionalImageUrl(a.imageKey),
          instructions: a.instructions ?? "",
          sortOrder: a.sortOrder,
        }))
    },
  }),
)

/** حساب دفع واحد بمعرّفه — يُستخدم في الخادم فقط لبناء Snapshot موثوق. */
export async function getPaymentAccountById(
  id: string,
): Promise<(PaymentAccount & { isActive: boolean }) | null> {
  if (!id || !UUID.test(id)) return null
  return dbCached<(PaymentAccount & { isActive: boolean }) | null>({
    keyParts: ["store", "payment-account", id],
    tags: [CACHE_TAGS.paymentAccounts],
    fallback: null,
    load: async () => {
      const [a] = await db.select().from(paymentAccounts).where(eq(paymentAccounts.id, id)).limit(1)
      if (!a) return null
      return {
        id: a.id,
        providerName: a.providerName,
        accountDisplayName: a.accountDisplayName ?? "",
        accountHolderName: a.accountHolderName,
        accountNumber: a.accountNumber,
        imageUrl: resolveOptionalImageUrl(a.imageKey),
        instructions: a.instructions ?? "",
        sortOrder: a.sortOrder,
        isActive: a.isActive,
      }
    },
  })
}

export async function validateCoupon(
  code: string,
  subtotal: number,
): Promise<{ valid: boolean; coupon?: Coupon; discountAmount: number; message: string }> {
  const list = await getCoupons()
  const coupon = list.find((c) => c.code.toUpperCase() === code.toUpperCase())

  if (!coupon) {
    return { valid: false, discountAmount: 0, message: "كود الخصم غير صحيح" }
  }
  if (coupon.minOrder && subtotal < coupon.minOrder) {
    return {
      valid: false,
      discountAmount: 0,
      message: `الحد الأدنى للطلب ${coupon.minOrder} ريال`,
    }
  }
  const discountAmount =
    coupon.type === "percent" ? Math.round((subtotal * coupon.discount) / 100) : coupon.discount
  return { valid: true, coupon, discountAmount, message: "تم تطبيق الكود بنجاح" }
}

export const getCurrencySettings = cache(async (): Promise<CurrencySettings> => {
  const data = await dbCached({
    keyParts: ["store", "currency-settings"],
    tags: [CACHE_TAGS.settings],
    fallback: null as { currencies: { code: string; name: string; symbol: string; rate: number }[]; defaultCode: string | null } | null,
    load: async () => {
      const [rows, [settings]] = await Promise.all([
        db.select().from(currencies).orderBy(asc(currencies.sortOrder), asc(currencies.code)),
        db.select({ defaultCurrency: siteSettings.defaultCurrency }).from(siteSettings).limit(1),
      ])
      return {
        currencies: rows.map((c) => ({ code: c.code, name: c.name, symbol: c.symbol, rate: c.rate })),
        defaultCode: settings?.defaultCurrency ?? null,
      }
    },
  })
  const list = normalizeCurrencies(data?.currencies)
  if (list.length === 0) return DEFAULT_CURRENCY_SETTINGS
  const hasDefault = data?.defaultCode && list.some((c) => c.code === data.defaultCode)
  return { currencies: list, defaultCode: hasDefault ? (data!.defaultCode as string) : list[0].code }
})

export const getReviews = cache(async (): Promise<Review[]> =>
  dbCached({
    keyParts: ["store", "reviews"],
    tags: [CACHE_TAGS.reviews],
    fallback: [],
    load: async () => {
      const rows = await db.select().from(reviews).orderBy(desc(reviews.reviewDate), desc(reviews.createdAt))
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        rating: r.rating,
        comment: r.comment,
        date: r.reviewDate,
        avatar: resolveOptionalImageUrl(r.avatarKey),
      }))
    },
  }),
)

/**
 * تُرجع الإعلانات المفعّلة، مع إمكانية الفلترة حسب سلاج القسم.
 * - الإعلان بلا أقسام يظهر في كل الأقسام.
 * - الإعلان بأقسام محددة يظهر فقط عند تطابق السلاج.
 */
export const getAds = cache(async (categorySlug?: string): Promise<Ad[]> => {
  const all = await dbCached<Ad[]>({
    keyParts: ["store", "ads"],
    tags: [CACHE_TAGS.ads, CACHE_TAGS.categoryReferences],
    fallback: [],
    load: async () => {
      const rows = await db.select().from(ads).where(eq(ads.active, true)).orderBy(asc(ads.sortOrder))
      if (rows.length === 0) return []
      const links = await db
        .select({ adId: adCategories.adId, slug: categories.slug })
        .from(adCategories)
        .innerJoin(categories, eq(categories.id, adCategories.categoryId))
        .where(inArray(adCategories.adId, rows.map((r) => r.id)))
      return rows.map((a) => ({
        id: a.id,
        title: a.title,
        image: resolveImageUrl(a.imageKey),
        href: nullToUndefined(a.href),
        categories: links.filter((l) => l.adId === a.id).map((l) => l.slug),
        active: a.active,
        frequency: a.frequency,
        order: a.sortOrder,
      }))
    },
  })
  return all
    .filter((a) => Boolean(a.image))
    .filter((a) => {
      if (!categorySlug) return true
      const cats = a.categories
      if (!cats || cats.length === 0 || cats.includes("all")) return true
      return cats.includes(categorySlug)
    })
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
})
