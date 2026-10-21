const r2Url = process.env.R2_PUBLIC_URL ? new URL(process.env.R2_PUBLIC_URL) : null

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: true,
    remotePatterns: [
      ...(r2Url ? [{ protocol: r2Url.protocol.replace(':', ''), hostname: r2Url.hostname }] : []),
    ],
  },
}

export default nextConfig
