import "server-only"

// أسماء الوسوم في مكان واحد حتى تبقى طبقة البيانات ومسار الـWebhook متطابقين.
// الحد الأقصى لوسم Next.js هو 256 حرفاً، لذلك نقيّد السلاج قبل إضافته للوسم.

export const SANITY_TAGS = {
  products: "sanity:products",
  productSlugs: "sanity:product-slugs",
  newProducts: "sanity:products:new",
  bestsellerProducts: "sanity:products:bestsellers",
  offerProducts: "sanity:products:offers",
  categoryReferences: "sanity:category-references",
  brandReferences: "sanity:brand-references",
  categories: "sanity:categories",
  categorySlugs: "sanity:category-slugs",
  brands: "sanity:brands",
  brandSlugs: "sanity:brand-slugs",
  slides: "sanity:slides",
  coupons: "sanity:coupons",
  shippingZones: "sanity:shipping-zones",
  paymentAccounts: "sanity:payment-accounts",
  reviews: "sanity:reviews",
  ads: "sanity:ads",
  settings: "sanity:settings",
} as const

function tagPart(value: string): string {
  return value.trim().slice(0, 180)
}

export function productTag(slug: string): string {
  return `sanity:product:${tagPart(slug)}`
}

export function categoryTag(slug: string): string {
  return `sanity:category:${tagPart(slug)}`
}

export function categoryProductsTag(slug: string): string {
  return `sanity:category-products:${tagPart(slug)}`
}

export function brandTag(slug: string): string {
  return `sanity:brand:${tagPart(slug)}`
}

export function brandProductsTag(slug: string): string {
  return `sanity:brand-products:${tagPart(slug)}`
}
