import { safeJsonLd } from "@/lib/json-ld"
import type { Metadata } from "next"
import { Header } from "@/components/header"
import { Footer } from "@/components/footer"
import { MobileNav } from "@/components/mobile-nav"
import { BrandCard } from "@/components/brand-card"
import { getBrands } from "@/lib/data"
import { SITE_CONFIG } from "@/lib/site"

export const metadata: Metadata = {
  title: "الماركات والبراندات",
  description:
    "تصفح جميع الماركات والبراندات في متجر تاج لاين، واكتشف منتجات كل علامة تجارية مجمّعة من جميع الأقسام في مكان واحد.",
  alternates: { canonical: `${SITE_CONFIG.url}/brands` },
}

// On-Demand Revalidation: الصفحة ثابتة وتُحدَّث فوراً
// عبر إجراءات لوحة الإدارة (revalidateStore في lib/manage-helpers.ts)

export default async function BrandsPage() {
  const brands = await getBrands()

  const itemListJsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "الماركات والبراندات",
    numberOfItems: brands.length,
    itemListElement: brands.map((b, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: `${SITE_CONFIG.url}/brand/${b.slug}`,
      name: b.name,
    })),
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(itemListJsonLd) }}
      />
      <Header />
      <main className="pb-24 lg:pb-12">
        <div className="mx-auto max-w-7xl px-4 py-6">
          <nav aria-label="مسار التنقل" className="mb-3 text-sm text-muted-foreground">
            <a href="/" className="hover:text-primary">
              الرئيسية
            </a>
            <span className="mx-2">/</span>
            <span className="text-foreground">الماركات</span>
          </nav>

          <header className="mb-6">
            <h1 className="mb-2 text-2xl font-bold text-foreground md:text-3xl text-balance">
              الماركات والبراندات
            </h1>
            <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground text-pretty">
              اكتشف علاماتنا التجارية المميزة. اضغط على أي براند لعرض جميع منتجاته مجمّعة من
              مختلف الأقسام في صفحة واحدة.
            </p>
          </header>

          {brands.length === 0 ? (
            <div className="rounded-3xl bg-secondary p-12 text-center">
              <p className="text-muted-foreground">لا توجد ماركات متاحة حالياً</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-5 lg:grid-cols-4">
              {brands.map((brand) => (
                <BrandCard key={brand.id} brand={brand} />
              ))}
            </div>
          )}
        </div>
      </main>
      <Footer />
      <MobileNav />
    </>
  )
}
