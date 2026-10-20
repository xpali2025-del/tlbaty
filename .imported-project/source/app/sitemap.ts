import type { MetadataRoute } from "next"
import { SITE_CONFIG } from "@/lib/site"
import { getProductSlugs, getCategorySlugs, getBrandSlugs } from "@/lib/data"

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = SITE_CONFIG.url

  // جلب السلاجات فقط بالتوازي — أخف استعلامات ممكنة
  const [productSlugs, categorySlugs, brandSlugs] = await Promise.all([
    getProductSlugs(),
    getCategorySlugs(),
    getBrandSlugs(),
  ])

  const staticRoutes: MetadataRoute.Sitemap = [
    "",
    "/categories",
    "/shop",
    "/brands",
    "/about",
    "/contact",
    "/faq",
    "/privacy",
    "/returns",
    "/cart",
  ].map((p) => ({
    url: `${base}${p}`,
    lastModified: new Date(),
    changeFrequency: "weekly",
    priority: p === "" ? 1 : 0.7,
  }))

  const products: MetadataRoute.Sitemap = productSlugs.map((slug) => ({
    url: `${base}/product/${slug}`,
    lastModified: new Date(),
    changeFrequency: "weekly",
    priority: 0.8,
  }))

  const categories: MetadataRoute.Sitemap = categorySlugs.map((slug) => ({
    url: `${base}/category/${slug}`,
    lastModified: new Date(),
    changeFrequency: "weekly",
    priority: 0.7,
  }))

  const brands: MetadataRoute.Sitemap = brandSlugs.map((slug) => ({
    url: `${base}/brand/${slug}`,
    lastModified: new Date(),
    changeFrequency: "weekly",
    priority: 0.7,
  }))

  return [...staticRoutes, ...products, ...categories, ...brands]
}
