import { safeJsonLd } from "@/lib/json-ld"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { Header } from "@/components/header"
import { Footer } from "@/components/footer"
import { MobileNav } from "@/components/mobile-nav"
import { ProductDetail } from "@/components/product-detail"
import { ProductSection } from "@/components/product-section"
import { getBrands, getCategoryBySlug, getProductBySlug, getProductSlugs, getProductsByCategory } from "@/lib/data"
import { SITE_CONFIG } from "@/lib/site"
import { getSiteConfig } from "@/lib/site-config"
import { decodeSlug } from "@/lib/utils"

// On-Demand Revalidation: الصفحة ثابتة وتُحدَّث فوراً
// عبر إجراءات لوحة الإدارة (revalidateStore في lib/manage-helpers.ts)

export async function generateStaticParams() {
  const slugs = await getProductSlugs()
  return slugs.map((slug) => ({ slug }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug: rawSlug } = await params
  const slug = decodeSlug(rawSlug)
  const product = await getProductBySlug(slug)
  if (!product) return { title: "المنتج غير موجود" }

  const title = product.metaTitle ?? product.name
  const description = product.metaDescription ?? product.description
  const url = `${SITE_CONFIG.url}/product/${product.slug}`

  return {
    title,
    description,
    keywords: product.keywords ? [...product.keywords] : undefined,
    alternates: { canonical: url },
    openGraph: {
      type: "website",
      title,
      description,
      url,
      images: product.images.map((img) => ({ url: img })),
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [product.image],
    },
  }
}

export default async function ProductPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug: rawSlug } = await params
  const slug = decodeSlug(rawSlug)
  const product = await getProductBySlug(slug)
  if (!product) notFound()

  // جلب البيانات المرتبطة بالتوازي
  const [categoryProducts, category, brands] = await Promise.all([
    getProductsByCategory(product.category),
    getCategoryBySlug(product.category),
    getBrands(),
  ])

  const related = categoryProducts.filter((p) => p.id !== product.id).slice(0, 4)

  // إيجاد سلاج البراند المطابق لاسم البراند في المنتج (للربط بصفحة البراند)
  const brandMatch = product.brand
    ? brands.find(
        (b) =>
          b.name.trim().toLowerCase() === product.brand!.trim().toLowerCase() ||
          b.slug.trim().toLowerCase() === product.brand!.trim().toLowerCase(),
      )
    : undefined
  const brandSlug = brandMatch?.slug

  // روابط صور مطلقة أصلاً — لا نضيف الدومين إلا للمسارات المحلية
  const toAbsoluteUrl = (src: string) => (src.startsWith("http") ? src : `${SITE_CONFIG.url}${src}`)

  // JSON-LD للمنتج (مهم جداً للـ SEO)
  // ملاحظة: لا نضيف aggregateRating إلا عند وجود مراجعات فعلية،
  // لأن قيمة صفرية تسبب تحذيرات في Google Search Console
  const hasRatings = (product.reviewsCount ?? 0) > 0 && (product.rating ?? 0) > 0

  const productJsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: product.description,
    image: product.images.map(toAbsoluteUrl),
    sku: product.sku ?? product.id,
    brand: {
      "@type": "Brand",
      name: product.brand ?? (await getSiteConfig()).name,
    },
    category: category?.name,
    offers: {
      "@type": "Offer",
      price: product.price,
      priceCurrency: "YER",
      availability: product.stock > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
      itemCondition: "https://schema.org/NewCondition",
      url: `${SITE_CONFIG.url}/product/${product.slug}`,
      seller: { "@id": SITE_CONFIG.ids.store },
      areaServed: { "@type": "Country", name: "اليمن" },
    },
    ...(hasRatings
      ? {
          aggregateRating: {
            "@type": "AggregateRating",
            ratingValue: product.rating,
            reviewCount: product.reviewsCount,
          },
        }
      : {}),
  }

  // JSON-LD: مسار التنقل (Breadcrumb)
  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "الرئيسية", item: SITE_CONFIG.url },
      ...(category
        ? [
            {
              "@type": "ListItem",
              position: 2,
              name: category.name,
              item: `${SITE_CONFIG.url}/category/${category.slug}`,
            },
          ]
        : []),
      {
        "@type": "ListItem",
        position: category ? 3 : 2,
        name: product.name,
        item: `${SITE_CONFIG.url}/product/${product.slug}`,
      },
    ],
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(productJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(breadcrumbJsonLd) }}
      />
      <Header />
      <main className="pb-24 lg:pb-12">
        <ProductDetail product={product} brandSlug={brandSlug} />
        {related.length > 0 && (
          <ProductSection title="منتجات مشابهة" products={related} viewAllHref={`/category/${product.category}`} />
        )}
      </main>
      <Footer />
      <MobileNav />
    </>
  )
}
