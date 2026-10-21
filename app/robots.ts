import type { MetadataRoute } from "next"
import { SITE_CONFIG } from "@/lib/site"

export default function robots(): MetadataRoute.Robots {
  return {
    // شاشة "طلباتي" والحساب خاصة بالعميل ولا قيمة لفهرستها.
    rules: { userAgent: "*", allow: "/", disallow: ["/cart", "/checkout", "/orders", "/account"] },
    sitemap: `${SITE_CONFIG.url}/sitemap.xml`,
  }
}
