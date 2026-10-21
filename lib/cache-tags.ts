import "server-only"

// أسماء وسوم الكاش في مكان واحد: طبقة القراءة (lib/data.ts) وإجراءات الإدارة
// تستخدمها معاً، فيتطابق ما يُخزَّن مع ما يُبطَل.
// الحد الأقصى لوسم Next.js هو 256 حرفاً، لذلك نقيّد السلاج قبل إضافته للوسم.

export const CACHE_TAGS = {
  products: "store:products",
  productSlugs: "store:product-slugs",
  newProducts: "store:products:new",
  bestsellerProducts: "store:products:bestsellers",
  offerProducts: "store:products:offers",
  categoryReferences: "store:category-references",
  brandReferences: "store:brand-references",
  categories: "store:categories",
  categorySlugs: "store:category-slugs",
  brands: "store:brands",
  brandSlugs: "store:brand-slugs",
  slides: "store:slides",
  coupons: "store:coupons",
  shippingZones: "store:shipping-zones",
  paymentAccounts: "store:payment-accounts",
  reviews: "store:reviews",
  ads: "store:ads",
  settings: "store:settings",
} as const

const tagPart = (value: string) => value.trim().slice(0, 180)

export const productTag = (slug: string) => `store:product:${tagPart(slug)}`
export const categoryTag = (slug: string) => `store:category:${tagPart(slug)}`
export const categoryProductsTag = (slug: string) => `store:category-products:${tagPart(slug)}`
export const brandTag = (slug: string) => `store:brand:${tagPart(slug)}`
export const brandProductsTag = (slug: string) => `store:brand-products:${tagPart(slug)}`
