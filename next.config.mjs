const resizing = process.env.IMAGE_RESIZING === 'cloudflare'
// نفس أولوية lib/env.ts: الاسم البديل R2_PUBLIC_URL_2 ثم الأصلي.
const r2Public = process.env.R2_PUBLIC_URL_2 || process.env.R2_PUBLIC_URL
const r2Url = r2Public ? new URL(r2Public) : null

/** @type {import('next').NextConfig} */
const nextConfig = {
  // صفحة الفحص تطبّق ترحيلات القاعدة من ملفات drizzle/ وقت التشغيل، فيجب أن تُرفق مع الدالة.
  outputFileTracingIncludes: { '/api/diagnose': ['./drizzle/**/*'] },
  images: {
    // نستخدم Cloudflare Image Resizing عند تفعيله، وإلا نترك Next/Vercel يحسّن صور R2 تلقائياً.
    // تعطيل التحسين كان يرسل الصور الأصلية الكبيرة إلى الجوال ويؤخر ظهور أول محتوى عدة ثوانٍ.
    ...(resizing ? { loader: 'custom', loaderFile: './lib/image-loader.ts' } : {}),
    formats: ['image/avif', 'image/webp'],
    minimumCacheTTL: 2678400,
    remotePatterns: [
      ...(r2Url ? [{ protocol: r2Url.protocol.replace(':', ''), hostname: r2Url.hostname }] : []),
    ],
  },
  env: {
    NEXT_PUBLIC_IMAGE_RESIZING: resizing ? 'cloudflare' : '',
    // رقم النسخة المعروض في «عن المتجر»: أول 7 خانات من commit النشر على Vercel (فارغ محلياً).
    NEXT_PUBLIC_BUILD_ID: (process.env.VERCEL_GIT_COMMIT_SHA ?? '').slice(0, 7),
  },
  async headers() {
    const common = [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
      // geolocation is used by checkout to capture the delivery location
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self), payment=()' },
    ]
    return [
      { source: '/:path*', headers: common },
      // the admin panel and its APIs must never be indexed or cached by shared caches
      { source: '/manage/:path*', headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }, { key: 'Cache-Control', value: 'no-store' }] },
      { source: '/api/manage/:path*', headers: [{ key: 'Cache-Control', value: 'no-store' }] },
    ]
  },
}

export default nextConfig
