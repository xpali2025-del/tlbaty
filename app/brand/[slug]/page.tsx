import { safeJsonLd } from "@/lib/json-ld"
import type { Metadata } from "next"
import { Suspense } from "react"
import { notFound } from "next/navigation"
import { Header } from "@/components/header"
import { Footer } from "@/components/footer"
import { MobileNav } from "@/components/mobile-nav"
import { BrandProducts } from "@/components/brand-products"
import { SafeImage } from "@/components/safe-image"
import { getBrandSlugs, getBrandBySlug, getProductsByBrand, getCategories } from "@/lib/data"
import { SITE_CONFIG } from "@/lib/site"
import { decodeSlug } from "@/lib/utils"
import { toCardProduct } from "@/lib/types"

// On-Demand Revalidation: الصفحة ثابتة وتُحدَّث فوراً
// عبر إجراءات لوحة الإدارة (revalidateStore في lib/manage-helpers.ts)

export async function generateStaticParams() {
  const slugs = await getBrandSlugs()
  return slugs.map((slug) => ({ slug }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug: rawSlug } = await params
  const slug = decodeSlug(rawSlug)
  const brand = await getBrandBySlug(slug)
  if (!brand) return { title: "البراند غير موجود" }

  const title = brand.metaTitle ?? `${brand.name} | متجر تاج لاين`
  const description =
    brand.metaDescription ??
    brand.description ??
    `تسوق جميع منتجات ${brand.name} من متجر تاج لاين، مجمّعة من جميع الأقسام بأفضل الأسعار.`
  const url = `${SITE_CONFIG.url}/brand/${brand.slug}`

  return {
    title,
    description,
    keywords: brand.keywords ? [...brand.keywords] : undefined,
    alternates: { canonical: url },
    openGraph: {
      type: "website",
      title,
      description,
      url,
      images: brand.image ? [{ url: brand.image }] : undefined,
    },
  }
}

export default async function BrandPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug: rawSlug } = await params
  const slug = decodeSlug(rawSlug)
  const brand = await getBrandBySlug(slug)
  if (!brand) notFound()

  // جلب البيانات بالتوازي
  const [products, categories] = await Promise.all([getProductsByBrand(slug), getCategories()])

  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "الرئيسية", item: SITE_CONFIG.url },
      { "@type": "ListItem", position: 2, name: "الماركات", item: `${SITE_CONFIG.url}/brands` },
      {
        "@type": "ListItem",
        position: 3,
        name: brand.name,
        item: `${SITE_CONFIG.url}/brand/${brand.slug}`,
      },
    ],
  }

  const brandJsonLd = {
    "@context": "https://schema.org",
    "@type": "Brand",
    name: brand.name,
    description: brand.description,
    logo: brand.image
      ? brand.image.startsWith("http")
        ? brand.image
        : `${SITE_CONFIG.url}${brand.image}`
      : undefined,
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(breadcrumbJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(brandJsonLd) }}
      />
      <Header />
      <main className="pb-24 lg:pb-12">
        <div className="mx-auto max-w-7xl px-4 py-6">
          <nav aria-label="مسار التنقل" className="mb-4 text-sm text-muted-foreground">
            <a href="/" className="hover:text-primary">
              الرئيسية
            </a>
            <span className="mx-2">/</span>
            <a href="/brands" className="hover:text-primary">
              الماركات
            </a>
            <span className="mx-2">/</span>
            <span className="text-foreground">{brand.name}</span>
          </nav>

          {/* ترويسة البراند */}
          <header className="mb-6 overflow-hidden rounded-3xl border border-border bg-card">
            <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:gap-6 sm:p-6">
              <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-2xl bg-muted sm:h-28 sm:w-28">
                <SafeImage
                  src={brand.image}
                  alt={brand.name}
                  fill
                  sizes="112px"
                  className="object-cover"
                />
              </div>
              <div className="flex-1">
                <h1 className="mb-1 text-2xl font-bold text-foreground md:text-3xl text-balance">
                  {brand.name}
                </h1>
                <p className="mb-2 text-sm font-medium text-primary">
                  {products.length} منتج في هذا البراند
                </p>
                {brand.description && (
                  <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground text-pretty">
                    {brand.description}
                  </p>
                )}
              </div>
            </div>
          </header>

          <Suspense
            fallback={
              <div className="p-6 text-center text-muted-foreground">جاري تحميل المنتجات...</div>
            }
          >
            <BrandProducts products={products.map(toCardProduct)} categories={categories} />
          </Suspense>
        </div>
      </main>
      <Footer />
      <MobileNav />
    </>
  )
}
