import imageUrlBuilder, { type SanityImageSource } from "@sanity/image-url"
import { dataset, isSanityConfigured, projectId } from "./env"

// ============================================
// أدوات صور Sanity CDN
// ============================================

const builder = isSanityConfigured ? imageUrlBuilder({ projectId, dataset }) : null

/** بناء رابط صورة من مرجع أصل Sanity */
export function urlFor(source: SanityImageSource) {
  if (!builder) return null
  return builder.image(source).auto("format").fit("max")
}

/**
 * تحسين رابط صورة Sanity CDN جاهز (asset->url) بإضافة
 * معاملات الضغط وتحديد العرض. الروابط غير التابعة لـ Sanity تُعاد كما هي.
 */
export function optimizedImageUrl(url: string | null | undefined, width?: number): string {
  if (!url) return "/placeholder.svg"
  if (!url.includes("cdn.sanity.io")) return url
  const params = new URLSearchParams({ auto: "format", fit: "max", q: "80" })
  if (width) params.set("w", String(width))
  return `${url}?${params.toString()}`
}
