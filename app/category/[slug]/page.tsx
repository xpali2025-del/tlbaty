import type { Metadata } from "next"
import { Suspense } from "react"
import { notFound } from "next/navigation"
import { Header } from "@/components/header"
import { Footer } from "@/components/footer"
import { MobileNav } from "@/components/mobile-nav"
import { CategoryProducts } from "@/components/categories/category-products"
import {
  getAds,
  getCategorySlugs,
  getCategoryBySlug,
  getProductsByCategory,
  getSubcategoriesWithCounts,
} from "@/lib/data"
import { SITE_CONFIG } from "@/lib/site"
import { decodeSlug } from "@/lib/utils"

// On-Demand Revalidation: الصفحة ثابتة وتُحدَّث فوراً
// عبر إجراءات لوحة الإدارة (revalidateStore في lib/manage-helpers.ts)

export async function generateStaticParams() {
  const slugs = await getCategorySlugs()
  return slugs.map((slug) => ({ slug }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug: rawSlug } = await params
  const slug = decodeSlug(rawSlug)
  const category = await getCategoryBySlug(slug)
  if (!category) return { title: "القسم غير موجود" }

  const title = category.metaTitle ?? category.name
  const description =
    category.metaDescription ??
    category.description ??
    `تسوق أحدث ${category.name} من متجر تاج لاين بأفضل الأسعار وجودة عالية وشحن سريع.`
  const url = `${SITE_CONFIG.url}/category/${category.slug}`

  return {
    title,
    description,
    keywords: category.keywords ? [...category.keywords] : undefined,
    alternates: { canonical: url },
    openGraph: {
      type: "website",
      title,
      description,
      url,
      images: category.image ? [{ url: category.image }] : undefined,
    },
  }
}

export default async function CategoryPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug: rawSlug } = await params
  const slug = decodeSlug(rawSlug)
  const category = await getCategoryBySlug(slug)
  if (!category) notFound()

  // جلب البيانات بالتوازي مرة واحدة للصفحة كاملة
  const [products, subcategories, ads] = await Promise.all([
    getProductsByCategory(slug),
    getSubcategoriesWithCounts(slug),
    getAds(slug),
  ])

  // JSON-LD: مسار التنقل (Breadcrumb) لتقوية السيو
  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "الرئيسية", item: SITE_CONFIG.url },
      { "@type": "ListItem", position: 2, name: "الأقسام", item: `${SITE_CONFIG.url}/shop` },
      {
        "@type": "ListItem",
        position: 3,
        name: category.name,
        item: `${SITE_CONFIG.url}/category/${category.slug}`,
      },
    ],
  }

  // JSON-LD: قائمة المنتجات داخل القسم
  const itemListJsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: category.name,
    description: category.description,
    numberOfItems: products.length,
    itemListElement: products.map((p, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: `${SITE_CONFIG.url}/product/${p.slug}`,
      name: p.name,
    })),
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListJsonLd) }}
      />
      <Header />
      <main className="pb-24 lg:pb-12">
        <div className="mx-auto max-w-7xl px-4 py-6">
          <nav aria-label="مسار التنقل" className="text-sm text-muted-foreground mb-3">
            <a href="/" className="hover:text-primary">الرئيسية</a>
            <span className="mx-2">/</span>
            <a href="/shop" className="hover:text-primary">الأقسام</a>
            <span className="mx-2">/</span>
            <span className="text-foreground">{category.name}</span>
          </nav>

          <header className="mb-6">
            <h1 className="text-2xl md:text-3xl font-bold text-foreground mb-2 text-balance">
              {category.name}
            </h1>
            {category.description && (
              <p className="text-sm text-muted-foreground max-w-2xl leading-relaxed text-pretty">
                {category.description}
              </p>
            )}
          </header>

          <Suspense fallback={<div className="p-6 text-center text-muted-foreground">جاري تحميل المنتجات...</div>}>
            <CategoryProducts products={products} subcategories={subcategories} ads={ads} />
          </Suspense>
        </div>
      </main>
      <Footer />
      <MobileNav />
    </>
  )
}
