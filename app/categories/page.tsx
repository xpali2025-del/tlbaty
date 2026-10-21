import type { Metadata } from "next"
import { Suspense } from "react"
import { Header } from "@/components/header"
import { Footer } from "@/components/footer"
import { MobileNav } from "@/components/mobile-nav"
import { ProductsExplorer } from "@/components/categories/products-explorer"
import { getAds, getCategories, getProducts } from "@/lib/data"

export const metadata: Metadata = {
  title: "كافة المنتجات",
  description:
    "تصفح كافة منتجات متجر تاج لاين مع بحث متقدم وفلترة حسب القسم والأكثر مبيعاً والمضاف حديثاً والعروض.",
}

// On-Demand Revalidation: الصفحة ثابتة وتُحدَّث فوراً
// عبر Sanity Webhook -> /api/revalidate (revalidateTag)

export default async function CategoriesPage() {
  const [products, categories, ads] = await Promise.all([getProducts(), getCategories(), getAds()])

  return (
    <>
      <Header />
      <main className="pb-24 lg:pb-12">
        <Suspense fallback={<div className="p-6 text-center">جاري تحميل المنتجات...</div>}>
          <ProductsExplorer products={products} categories={categories} ads={ads} />
        </Suspense>
      </main>
      <Footer />
      <MobileNav />
    </>
  )
}
