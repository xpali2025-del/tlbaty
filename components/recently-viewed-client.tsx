"use client"

import { useMemo } from "react"
import Link from "next/link"
import { ArrowLeft, Clock3 } from "lucide-react"
import { Header } from "@/components/header"
import { FooterClient } from "@/components/footer-client"
import { MobileNav } from "@/components/mobile-nav"
import { ProductCard } from "@/components/product-card"
import { useRecentlyViewed } from "@/hooks/use-recently-viewed"
import { recentlyViewedToProduct } from "@/lib/recently-viewed"

export function RecentlyViewedClient() {
  const { items, hydrated } = useRecentlyViewed()

  // إعادة بناء منتجات مبسّطة لتمريرها إلى ProductCard دون إعادة الجلب
  const products = useMemo(() => items.map(recentlyViewedToProduct), [items])

  return (
    <>
      <Header />
      <main className="pb-24 lg:pb-12 mx-auto max-w-7xl px-4 py-6">
        <div className="mb-6 flex items-center gap-2">
          <Clock3 className="h-6 w-6 text-primary" aria-hidden="true" />
          <h1 className="text-2xl md:text-3xl font-bold">المنتجات المعروضة مؤخرًا</h1>
        </div>

        {/* لا نعرض أي شيء قبل قراءة localStorage لتجنّب وميض الحالة الفارغة */}
        {!hydrated ? null : products.length === 0 ? (
          <div className="bg-secondary rounded-3xl p-12 text-center">
            <Clock3 className="w-16 h-16 mx-auto text-muted-foreground mb-4" aria-hidden="true" />
            <h2 className="text-xl font-bold mb-2">لم تشاهد أي منتجات بعد</h2>
            <p className="text-muted-foreground mb-6">
              ستظهر هنا المنتجات التي تفتح صفحات تفاصيلها لتعود إليها بسهولة.
            </p>
            <Link
              href="/categories"
              className="inline-flex items-center gap-2 bg-primary text-primary-foreground rounded-full px-6 py-3 font-bold hover:bg-primary/90 transition-colors"
            >
              تصفح المنتجات
              <ArrowLeft className="w-4 h-4" />
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:gap-4 lg:grid-cols-4">
            {products.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        )}
      </main>

      <FooterClient />
      <MobileNav />
    </>
  )
}
