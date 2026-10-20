// ============================================
// تحسين روابط صور مشروع الإشعارات
// نعمل على رابط الأصل الجاهز (image.asset->url) فنبقى مستقلين تماماً
// عن باني صور مشروع المحتوى (sanity/image.ts).
// ============================================

/**
 * يضيف معاملات الضغط وتحديد العرض لرابط Sanity CDN.
 * الروابط غير التابعة لـ Sanity تُعاد كما هي، و null يبقى null
 * ليتولى SafeImage عرض صورة الاحتياط.
 */
export function notificationImageUrl(
  url: string | null | undefined,
  width?: number,
): string | null {
  if (!url) return null
  if (!url.includes("cdn.sanity.io")) return url

  const params = new URLSearchParams({ auto: "format", fit: "max", q: "80" })
  if (width) params.set("w", String(width))
  return `${url}?${params.toString()}`
}
