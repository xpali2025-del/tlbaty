import type { Metadata } from "next"
import { Header } from "@/components/header"
import { Footer } from "@/components/footer"
import { MobileNav } from "@/components/mobile-nav"
import { SearchClient } from "@/components/search-client"
import { getProducts, getBrands } from "@/lib/data"

export const metadata: Metadata = {
  title: "البحث",
  description: "ابحث عن المنتجات في متجر تاج لاين بسهولة من بين كافة الأقسام والمنتجات.",
  robots: { index: false, follow: true },
}

// On-Demand Revalidation: الصفحة ثابتة وتُحدَّث فوراً
// عبر إجراءات لوحة الإدارة (revalidateStore في lib/manage-helpers.ts)

export default async function SearchPage() {
  const [products, brands] = await Promise.all([getProducts(), getBrands()])

  return (
    <>
      <Header />
      <main className="pb-24 lg:pb-12">
        <SearchClient products={products} brands={brands} />
      </main>
      <Footer />
      <MobileNav />
    </>
  )
}
