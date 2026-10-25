const resizing = process.env.IMAGE_RESIZING === 'cloudflare'
const r2Url = process.env.R2_PUBLIC_URL ? new URL(process.env.R2_PUBLIC_URL) : null

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    // IMAGE_RESIZING=cloudflare: الصور تُصغَّر عبر Cloudflare Image Resizing على نطاق R2 (lib/image-loader.ts).
    // بدونه تُخدَم الصور كما هي (لا تحسين من Next لأن الصور على R2 لا على Vercel).
    ...(resizing ? { loader: 'custom', loaderFile: './lib/image-loader.ts' } : { unoptimized: true }),
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
