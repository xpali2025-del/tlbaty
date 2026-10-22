// محمّل صور Next مخصص لتصغير الصور عبر Cloudflare Image Resizing على نطاق R2 العام.
// يُفعَّل بالبيئة: NEXT_PUBLIC_IMAGE_RESIZING=cloudflare (انظر next.config.mjs) وإلا تُخدَم الصور كما هي.
//
// الصيغة: https://cdn.example.com/cdn-cgi/image/width=640,quality=75,format=auto/products/<uuid>.jpg
// format=auto يقدّم AVIF/WebP للمتصفحات الداعمة. الصور المحلية (public/) والمسارات النسبية لا تُمسّ.

const R2_FOLDERS = /^\/(?:products|categories|brands|slides|ads|reviews|payment-accounts|couriers|notifications|site)\//

export default function imageLoader({ src, width, quality }: { src: string; width: number; quality?: number }): string {
  let url: URL
  try {
    url = new URL(src)
  } catch {
    return src // مسار نسبي: ملف محلي من public/
  }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || !R2_FOLDERS.test(url.pathname)) return src
  const options = `width=${Math.round(width)},quality=${quality ?? 75},format=auto,fit=scale-down`
  return `${url.origin}/cdn-cgi/image/${options}${url.pathname}`
}
