import { cache } from "react"
import { sanityFetch } from "@/sanity/client"
import {
  SANITY_TAGS,
  brandProductsTag,
  brandTag,
  categoryProductsTag,
  categoryTag,
  productTag,
} from "@/sanity/cache-tags"
import { optimizedImageUrl } from "@/sanity/image"
import {
  activeAdsQuery,
  currencySettingsQuery,
  allBrandsQuery,
  allCategoriesQuery,
  allCouponsQuery,
  allProductsQuery,
  allReviewsQuery,
  allShippingZonesQuery,
  allSlidesQuery,
  activePaymentAccountsQuery,
  paymentAccountByIdQuery,
  bestsellersQuery,
  brandBySlugQuery,
  brandSlugsQuery,
  categoryBySlugQuery,
  categorySlugsQuery,
  newArrivalsQuery,
  offerProductsQuery,
  productBySlugQuery,
  productSlugsQuery,
  productsByBrandQuery,
  productsByCategoryQuery,
} from "@/sanity/queries"
import type { Product, Category, Subcategory, Slide, Coupon, Review, Ad, Brand, ShippingZone } from "./types"
import type { PaymentAccount } from "./payment"
import {
  DEFAULT_CURRENCY_SETTINGS,
  normalizeCurrencies,
  type Currency,
  type CurrencySettings,
} from "./currency"

// ============================================
// طبقة البيانات — Sanity CMS
// - كل الدوال Server-only
// - كاش Next.js (On-Demand Revalidation عبر Tags) يمنع تكرار الطلبات
//   ولا يُحدَّث إلا عند وصول Sanity Webhook إلى /api/revalidate
// - React cache() يضمن جلب البيانات مرة واحدة لكل صفحة
// - عند غياب الإعدادات تُرجَع قيم فارغة آمنة بدون أخطاء
//
// الوسوم دقيقة حسب الاستعلام والمسار. فمثلاً تعديل منتج في قسم معيّن
// يُبطل كاش ذلك القسم والبراند والمنتج فقط، إضافة إلى القوائم العامة
// التي تعرض المنتج. أما تغيير قسم أو براند فيبطل وسم المراجع لأن حقول
// المنتجات تعرض سلاج القسم وبيانات البراند المرجعية.
// ============================================

/** كل إسقاطات المنتجات تعرض بيانات مرجعية من القسم والبراند. */
const PRODUCT_REFERENCE_TAGS = [
  SANITY_TAGS.categoryReferences,
  SANITY_TAGS.brandReferences,
]

// ============================================
// تحسين الصور — تمرير كل روابط Sanity CDN عبر
// معاملات الضغط (auto=format, q=80, w=…) قبل وصولها للواجهة
// ============================================

/** أقصى عرض لصور المنتجات وبطاقات الأقسام */
const CARD_IMAGE_WIDTH = 800
/** أقصى عرض لصور السلايدر والإعلانات (عرض كامل) */
const WIDE_IMAGE_WIDTH = 1600
/** أقصى عرض لصور الأفاتار الصغيرة */
const AVATAR_IMAGE_WIDTH = 160

function optimizeProduct(p: Product): Product {
  return {
    ...p,
    image: optimizedImageUrl(p.image, CARD_IMAGE_WIDTH),
    images: (p.images ?? []).map((img) => optimizedImageUrl(img, WIDE_IMAGE_WIDTH)),
  }
}

function optimizeCategory(c: Category): Category {
  return { ...c, image: optimizedImageUrl(c.image, CARD_IMAGE_WIDTH) }
}

function optimizeBrand(b: Brand): Brand {
  return { ...b, image: b.image ? optimizedImageUrl(b.image, CARD_IMAGE_WIDTH) : b.image }
}

export const getProducts = cache(async (): Promise<Product[]> => {
  const products = await sanityFetch<Product[]>({
    query: allProductsQuery,
    tags: [SANITY_TAGS.products, ...PRODUCT_REFERENCE_TAGS],
    fallback: [],
  })
  return products.map(optimizeProduct)
})

export const getProductBySlug = cache(async (slug: string): Promise<Product | undefined> => {
  const product = await sanityFetch<Product | null>({
    query: productBySlugQuery,
    params: { slug },
    tags: [productTag(slug), ...PRODUCT_REFERENCE_TAGS],
    fallback: null,
  })
  return product ? optimizeProduct(product) : undefined
})

export const getProductById = cache(async (id: string): Promise<Product | undefined> => {
  const products = await getProducts()
  return products.find((p) => p.id === id)
})

export const getProductsByCategory = cache(async (categorySlug: string): Promise<Product[]> => {
  const products = await sanityFetch<Product[]>({
    query: productsByCategoryQuery,
    params: { categorySlug },
    tags: [categoryProductsTag(categorySlug), ...PRODUCT_REFERENCE_TAGS],
    fallback: [],
  })
  return products.map(optimizeProduct)
})

export const getProductsBySubcategory = cache(async (subcategorySlug: string): Promise<Product[]> => {
  const products = await getProducts()
  return products.filter((p) => p.subcategory === subcategorySlug)
})

export const getBestsellers = cache(async (): Promise<Product[]> => {
  const products = await sanityFetch<Product[]>({
    query: bestsellersQuery,
    tags: [SANITY_TAGS.bestsellerProducts, ...PRODUCT_REFERENCE_TAGS],
    fallback: [],
  })
  return products.map(optimizeProduct)
})

export const getNewArrivals = cache(async (): Promise<Product[]> => {
  const products = await sanityFetch<Product[]>({
    query: newArrivalsQuery,
    tags: [SANITY_TAGS.newProducts, ...PRODUCT_REFERENCE_TAGS],
    fallback: [],
  })
  return products.map(optimizeProduct)
})

export const getOfferProducts = cache(async (): Promise<Product[]> => {
  const products = await sanityFetch<Product[]>({
    query: offerProductsQuery,
    tags: [SANITY_TAGS.offerProducts, ...PRODUCT_REFERENCE_TAGS],
    fallback: [],
  })
  return products.map(optimizeProduct)
})

export async function searchProducts(query: string): Promise<Product[]> {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const products = await getProducts()
  return products.filter(
    (p) =>
      p.name.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q) ||
      p.category.toLowerCase().includes(q),
  )
}

/** سلاجات المنتجات — للاستخدام في generateStaticParams و sitemap */
export const getProductSlugs = cache(async (): Promise<string[]> => {
  return sanityFetch<string[]>({
    query: productSlugsQuery,
    tags: [SANITY_TAGS.productSlugs],
    fallback: [],
  })
})

// ============================================
// الأقسام
// ============================================

export const getCategories = cache(async (): Promise<Category[]> => {
  const categories = await sanityFetch<Category[]>({
    query: allCategoriesQuery,
    tags: [SANITY_TAGS.categories],
    fallback: [],
  })
  return categories.map(optimizeCategory)
})

export const getCategoryBySlug = cache(async (slug: string): Promise<Category | undefined> => {
  const category = await sanityFetch<Category | null>({
    query: categoryBySlugQuery,
    params: { slug },
    tags: [categoryTag(slug)],
    fallback: null,
  })
  return category ? optimizeCategory(category) : undefined
})

export const getCategorySlugs = cache(async (): Promise<string[]> => {
  return sanityFetch<string[]>({
    query: categorySlugsQuery,
    tags: [SANITY_TAGS.categorySlugs],
    fallback: [],
  })
})

/**
 * روابط أقسام الفوتر — تُبنى ديناميكياً من أقسام Sanity الفعلية
 * حتى لا تظهر أقسام محذوفة أو روابط تؤدي إلى 404.
 * عند غياب البيانات (لم يُضبط Sanity بعد) تُرجَع قائمة فارغة آمنة.
 */
export const getFooterCategories = cache(
  async (): Promise<{ label: string; href: string }[]> => {
    const categories = await getCategories()
    return categories.map((c) => ({
      label: c.name,
      href: `/category/${c.slug}`,
    }))
  },
)

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
  const [subs, products] = await Promise.all([
    getSubcategories(categorySlug),
    getProductsByCategory(categorySlug),
  ])
  return subs.map((sub) => ({
    ...sub,
    count: products.filter((p) => p.subcategory === sub.slug).length,
  }))
}

// ============================================
// البراندات — عدد المنتجات يُحسب داخل استعلام GROQ مباشرة
// ============================================

export const getBrands = cache(async (): Promise<Brand[]> => {
  const brands = await sanityFetch<Brand[]>({
    query: allBrandsQuery,
    tags: [SANITY_TAGS.brands],
    fallback: [],
  })
  return brands.map(optimizeBrand)
})

export const getBrandBySlug = cache(async (slug: string): Promise<Brand | undefined> => {
  const brand = await sanityFetch<Brand | null>({
    query: brandBySlugQuery,
    params: { slug },
    tags: [brandTag(slug)],
    fallback: null,
  })
  return brand ? optimizeBrand(brand) : undefined
})

export const getBrandSlugs = cache(async (): Promise<string[]> => {
  return sanityFetch<string[]>({
    query: brandSlugsQuery,
    tags: [SANITY_TAGS.brandSlugs],
    fallback: [],
  })
})

/** كل المنتجات بنفس البراند مجمّعة من جميع الأقسام */
export const getProductsByBrand = cache(async (brandSlug: string): Promise<Product[]> => {
  const products = await sanityFetch<Product[]>({
    query: productsByBrandQuery,
    params: { brandSlug },
    tags: [brandProductsTag(brandSlug), ...PRODUCT_REFERENCE_TAGS],
    fallback: [],
  })
  return products.map(optimizeProduct)
})

// ============================================
// السلايدر والتقييمات والكوبونات والإعلانات
// ============================================

export const getSlides = cache(async (): Promise<Slide[]> => {
  const slides = await sanityFetch<Slide[]>({
    query: allSlidesQuery,
    tags: [SANITY_TAGS.slides],
    fallback: [],
  })
  return slides.map((s) => ({ ...s, image: optimizedImageUrl(s.image, WIDE_IMAGE_WIDTH) }))
})

export const getCoupons = cache(async (): Promise<Coupon[]> => {
  return sanityFetch<Coupon[]>({
    query: allCouponsQuery,
    tags: [SANITY_TAGS.coupons],
    fallback: [],
  })
})

/** طرق التوصيل حسب المحافظة — تُدار من الاستوديو */
export const getShippingZones = cache(async (): Promise<ShippingZone[]> => {
  return sanityFetch<ShippingZone[]>({
    query: allShippingZonesQuery,
    tags: [SANITY_TAGS.shippingZones],
    fallback: [],
  })
})

/**
 * حسابات الدفع المفعّلة — تُدار من الاستوديو ولوحة /manage.
 * الحسابات المعطّلة لا تصل للعميل إطلاقاً لأن الاستعلام يصفّيها في Sanity.
 */
export const getPaymentAccounts = cache(async (): Promise<PaymentAccount[]> => {
  const accounts = await sanityFetch<PaymentAccount[]>({
    query: activePaymentAccountsQuery,
    tags: [SANITY_TAGS.paymentAccounts],
    fallback: [],
  })
  return accounts
    .filter((a) => a.id && a.providerName && a.accountHolderName && a.accountNumber)
    .map((a) => ({
      ...a,
      imageUrl: a.imageUrl ? optimizedImageUrl(a.imageUrl, AVATAR_IMAGE_WIDTH * 2) : undefined,
    }))
})

/** حساب دفع واحد بمعرّفه — يُستخدم في الخادم فقط لبناء Snapshot موثوق. */
export async function getPaymentAccountById(
  id: string,
): Promise<(PaymentAccount & { isActive: boolean }) | null> {
  if (!id) return null
  return sanityFetch<(PaymentAccount & { isActive: boolean }) | null>({
    query: paymentAccountByIdQuery,
    params: { id },
    tags: [SANITY_TAGS.paymentAccounts],
    fallback: null,
  })
}

export async function validateCoupon(
  code: string,
  subtotal: number,
): Promise<{ valid: boolean; coupon?: Coupon; discountAmount: number; message: string }> {
  const coupons = await getCoupons()
  const coupon = coupons.find((c) => c.code.toUpperCase() === code.toUpperCase())
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

// ============================================
// العملات وأسعار الصرف — تُدار من لوحة تحكم Sanity
// عند غياب الإعدادات تُرجَع قيم افتراضية آمنة (ريال يمني/سعودي)
// ============================================
export const getCurrencySettings = cache(async (): Promise<CurrencySettings> => {
  const data = await sanityFetch<{ currencies: Currency[]; defaultCode?: string | null } | null>({
    query: currencySettingsQuery,
    tags: [SANITY_TAGS.settings],
    fallback: null,
  })

  const currencies = normalizeCurrencies(data?.currencies)
  const hasDefault = data?.defaultCode && currencies.some((c) => c.code === data.defaultCode)

  if (currencies.length === 0) return DEFAULT_CURRENCY_SETTINGS

  return {
    currencies,
    defaultCode: hasDefault ? (data!.defaultCode as string) : currencies[0].code,
  }
})

export const getReviews = cache(async (): Promise<Review[]> => {
  const reviews = await sanityFetch<Review[]>({
    query: allReviewsQuery,
    tags: [SANITY_TAGS.reviews],
    fallback: [],
  })
  return reviews.map((r) => ({
    ...r,
    avatar: r.avatar ? optimizedImageUrl(r.avatar, AVATAR_IMAGE_WIDTH) : r.avatar,
  }))
})

/**
 * تُرجع الإعلانات المفعّلة، مع إمكانية الفلترة حسب سلاج القسم.
 * - الإعلان بلا أقسام يظهر في كل الأقسام.
 * - الإعلان بأقسام محددة يظهر فقط عند تطابق السلاج.
 */
export const getAds = cache(async (categorySlug?: string): Promise<Ad[]> => {
  const ads = await sanityFetch<Ad[]>({
    query: activeAdsQuery,
    tags: [SANITY_TAGS.ads, SANITY_TAGS.categoryReferences],
    fallback: [],
  })

  return ads
    .filter((a) => Boolean(a.image))
    .filter((a) => {
      if (!categorySlug) return true
      const cats = a.categories
      if (!cats || cats.length === 0 || cats.includes("all")) return true
      return cats.includes(categorySlug)
    })
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((a) => ({ ...a, image: optimizedImageUrl(a.image, WIDE_IMAGE_WIDTH) }))
})
