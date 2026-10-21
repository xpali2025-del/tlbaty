import { defineQuery } from "next-sanity"

// ============================================
// جميع استعلامات GROQ في مكان واحد — بدون تكرار
// كل استعلام يُرجع الحقول المطلوبة فقط (Projections)
// ويحوّل المراجع إلى القيم التي تتوقعها الواجهة:
//   - category (reference)  => سلاج القسم
//   - brand (reference)     => اسم البراند
//   - image (asset)         => رابط CDN مباشر
// ============================================

/** حقول المنتج — مطابقة تماماً لنوع Product في lib/types.ts */
const PRODUCT_FIELDS = /* groq */ `
  "id": coalesce(productId, _id),
  "slug": slug.current,
  name,
  description,
  price,
  oldPrice,
  "image": mainImage.asset->url,
  "images": coalesce(images[].asset->url, []),
  "category": category->slug.current,
  subcategory,
  "rating": coalesce(rating, 5),
  "reviewsCount": coalesce(reviewsCount, 0),
  "colors": coalesce(colors[]{ name, hex }, []),
  "sizes": coalesce(sizes, []),
  "stock": coalesce(stock, 0),
  isNew,
  isBestseller,
  badge,
  tags,
  metaTitle,
  metaDescription,
  keywords,
  "brand": brand->name,
  sku
`

const PRODUCT_ORDER = /* groq */ `order(coalesce(sortOrder, 0) asc, name asc)`

export const allProductsQuery = defineQuery(`
  *[_type == "product" && defined(slug.current)] | ${PRODUCT_ORDER} { ${PRODUCT_FIELDS} }
`)

export const productBySlugQuery = defineQuery(`
  *[_type == "product" && slug.current == $slug][0] { ${PRODUCT_FIELDS} }
`)

export const productsByCategoryQuery = defineQuery(`
  *[_type == "product" && category->slug.current == $categorySlug] | ${PRODUCT_ORDER} { ${PRODUCT_FIELDS} }
`)

export const productsByBrandQuery = defineQuery(`
  *[_type == "product" && brand->slug.current == $brandSlug] | ${PRODUCT_ORDER} { ${PRODUCT_FIELDS} }
`)

export const bestsellersQuery = defineQuery(`
  *[_type == "product" && (isBestseller == true || "bestseller" in tags)] | ${PRODUCT_ORDER} { ${PRODUCT_FIELDS} }
`)

export const newArrivalsQuery = defineQuery(`
  *[_type == "product" && (isNew == true || "new" in tags)] | ${PRODUCT_ORDER} { ${PRODUCT_FIELDS} }
`)

export const offerProductsQuery = defineQuery(`
  *[_type == "product" && ((defined(oldPrice) && oldPrice > price) || "offer" in tags)] | ${PRODUCT_ORDER} { ${PRODUCT_FIELDS} }
`)

export const productSlugsQuery = defineQuery(`
  *[_type == "product" && defined(slug.current)].slug.current
`)

/** حقول القسم — عدد المنتجات يُحسب فعلياً من قاعدة البيانات */
const CATEGORY_FIELDS = /* groq */ `
  "id": slug.current,
  "slug": slug.current,
  name,
  "image": image.asset->url,
  "productCount": count(*[_type == "product" && references(^._id)]),
  description,
  metaTitle,
  metaDescription,
  keywords,
  "subcategories": coalesce(subcategories[]{
    "id": slug.current,
    "slug": slug.current,
    name,
    description
  }, [])
`

export const allCategoriesQuery = defineQuery(`
  *[_type == "category" && defined(slug.current)] | order(coalesce(sortOrder, 0) asc, name asc) { ${CATEGORY_FIELDS} }
`)

export const categoryBySlugQuery = defineQuery(`
  *[_type == "category" && slug.current == $slug][0] { ${CATEGORY_FIELDS} }
`)

export const categorySlugsQuery = defineQuery(`
  *[_type == "category" && defined(slug.current)].slug.current
`)

/** حقول البراند — عدد المنتجات يُحسب فعلياً من قاعدة البيانات */
const BRAND_FIELDS = /* groq */ `
  "id": slug.current,
  "slug": slug.current,
  name,
  "image": image.asset->url,
  description,
  featured,
  metaTitle,
  metaDescription,
  keywords,
  "productCount": count(*[_type == "product" && references(^._id)])
`

export const allBrandsQuery = defineQuery(`
  *[_type == "brand" && defined(slug.current)] | order(coalesce(sortOrder, 0) asc, name asc) { ${BRAND_FIELDS} }
`)

export const brandBySlugQuery = defineQuery(`
  *[_type == "brand" && slug.current == $slug][0] { ${BRAND_FIELDS} }
`)

export const brandSlugsQuery = defineQuery(`
  *[_type == "brand" && defined(slug.current)].slug.current
`)

export const allSlidesQuery = defineQuery(`
  *[_type == "slide"] | order(coalesce(sortOrder, 0) asc) {
    "id": _id,
    title,
    "subtitle": coalesce(subtitle, ""),
    "cta": coalesce(cta, ""),
    "href": coalesce(href, "/"),
    "image": image.asset->url
  }
`)

export const allCouponsQuery = defineQuery(`
  *[_type == "coupon"] {
    code,
    discount,
    type,
    minOrder,
    description
  }
`)

export const allShippingZonesQuery = defineQuery(`
  *[_type == "shippingZone"] | order(isDefault desc, governorate asc) {
    "id": _id,
    "governorate": coalesce(governorate, ""),
    "isDefault": coalesce(isDefault, false),
    "methods": coalesce(methods[]{
      "id": _key,
      name,
      "desc": coalesce(description, ""),
      "price": coalesce(price, 0),
      "icon": coalesce(icon, "standard")
    }, [])
  }
`)

/**
 * حسابات الدفع المفعّلة فقط — تُعرض للعميل في صفحة إتمام الطلب.
 * الحسابات المعطّلة أو غير المكتملة (بلا رقم حساب) لا تظهر إطلاقاً.
 */
export const activePaymentAccountsQuery = defineQuery(`
  *[_type == "paymentAccount" && isActive == true && defined(accountNumber) && defined(providerName)]
    | order(coalesce(sortOrder, 0) asc, providerName asc) {
    "id": _id,
    providerName,
    "accountDisplayName": coalesce(accountDisplayName, ""),
    accountHolderName,
    accountNumber,
    "imageUrl": image.asset->url,
    "instructions": coalesce(instructions, ""),
    "sortOrder": coalesce(sortOrder, 0)
  }
`)

/** حساب دفع واحد بمعرّفه — يُستخدم في الخادم لبناء Snapshot موثوق. */
export const paymentAccountByIdQuery = defineQuery(`
  *[_type == "paymentAccount" && _id == $id][0]{
    "id": _id,
    providerName,
    "accountDisplayName": coalesce(accountDisplayName, ""),
    accountHolderName,
    accountNumber,
    "imageUrl": image.asset->url,
    "instructions": coalesce(instructions, ""),
    "isActive": coalesce(isActive, false)
  }
`)

export const allReviewsQuery = defineQuery(`
  *[_type == "review"] | order(date desc) {
    "id": _id,
    name,
    rating,
    comment,
    date,
    "avatar": avatar.asset->url
  }
`)

/** إعدادات العملات وأسعار الصرف — مستند الإعدادات المفرد */
export const currencySettingsQuery = defineQuery(`
  *[_type == "siteSettings"][0]{
    "currencies": coalesce(currencies[]{
      code,
      name,
      symbol,
      "rate": coalesce(rate, 1)
    }, []),
    "defaultCode": defaultCurrency
  }
`)

export const activeAdsQuery = defineQuery(`
  *[_type == "ad" && active == true && defined(image.asset)] | order(coalesce(sortOrder, 0) asc) {
    "id": _id,
    title,
    "image": image.asset->url,
    href,
    "categories": categories[]->slug.current,
    active,
    frequency,
    "order": sortOrder
  }
`)
