import type { Product, RecentlyViewedItem } from "@/lib/types"

/** مفتاح التخزين في localStorage */
export const RECENTLY_VIEWED_KEY = "taraf_recently_viewed"

/** الحد الأقصى لعدد المنتجات المحفوظة */
export const MAX_RECENTLY_VIEWED = 20

/** يحوّل المنتج إلى عنصر «معروض مؤخرًا» بالحقول اللازمة فقط للعرض والإضافة للرغبات */
export function toRecentlyViewedItem(product: Product): RecentlyViewedItem {
  const images = Array.isArray(product.images) ? product.images : []
  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    price: product.price,
    oldPrice: product.oldPrice,
    image: images[0] || product.image,
    images,
    colors: Array.isArray(product.colors) ? product.colors : [],
    sizes: Array.isArray(product.sizes) ? product.sizes : [],
    stock: typeof product.stock === "number" ? product.stock : 0,
    isNew: product.isNew,
    sku: product.sku,
  }
}

/** يتحقق أن العنصر المخزَّن صالح ويملك الحد الأدنى من الحقول */
function isValidItem(value: unknown): value is RecentlyViewedItem {
  if (typeof value !== "object" || value === null) return false
  const item = value as Record<string, unknown>
  return (
    typeof item.id === "string" &&
    typeof item.slug === "string" &&
    typeof item.name === "string" &&
    typeof item.price === "number" &&
    typeof item.image === "string"
  )
}

/** يقرأ ويُنظّف بيانات localStorage غير الصحيحة دون انهيار */
export function readRecentlyViewed(): RecentlyViewedItem[] {
  // حماية أثناء التصيير على الخادم
  if (typeof window === "undefined") return []
  let raw: string | null = null
  try {
    raw = window.localStorage.getItem(RECENTLY_VIEWED_KEY)
  } catch {
    return []
  }
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(isValidItem)
      .slice(0, MAX_RECENTLY_VIEWED)
      .map((item) => ({
        ...item,
        images: Array.isArray(item.images) ? item.images : [item.image],
        colors: Array.isArray(item.colors) ? item.colors : [],
        sizes: Array.isArray(item.sizes) ? item.sizes : [],
        stock: typeof item.stock === "number" ? item.stock : 0,
      }))
  } catch {
    return []
  }
}

/**
 * يعيد بناء منتج مبسّط من العنصر المحفوظ حتى يمكن تمريره إلى
 * ProductCard و«الرغبات» دون إعادة الجلب من الشبكة.
 */
export function recentlyViewedToProduct(item: RecentlyViewedItem): Product {
  return {
    id: item.id,
    slug: item.slug,
    name: item.name,
    description: "",
    price: item.price,
    oldPrice: item.oldPrice,
    image: item.image,
    images: item.images.length > 0 ? item.images : [item.image],
    category: "",
    rating: 0,
    reviewsCount: 0,
    colors: item.colors,
    sizes: item.sizes,
    stock: item.stock,
    isNew: item.isNew,
    sku: item.sku,
  }
}
