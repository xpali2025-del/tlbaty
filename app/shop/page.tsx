import type { Metadata } from "next"
import Link from "next/link"
import { SafeImage } from "@/components/safe-image"
import { ArrowLeft } from "lucide-react"
import { Header } from "@/components/header"
import { Footer } from "@/components/footer"
import { MobileNav } from "@/components/mobile-nav"
import { getCategories } from "@/lib/data"

export const metadata: Metadata = {
  title: "الأقسام",
  description: "تصفح جميع أقسام متجر تاج لاين من ملابس رجالية ونسائية وأطفال وحقائب وأحذية وعطور وإكسسوارات.",
}

// On-Demand Revalidation: الصفحة ثابتة وتُحدَّث فوراً
// عبر Sanity Webhook -> /api/revalidate (revalidateTag)

export default async function SectionsPage() {
  const categories = await getCategories()

  return (
    <>
      <Header />
      <main className="pb-24 lg:pb-12">
        <div className="mx-auto max-w-7xl px-4 py-6">
          <h1 className="text-2xl md:text-3xl font-bold text-foreground mb-1">الأقسام</h1>
          <p className="text-muted-foreground text-sm mb-6">
            اختر القسم الذي ترغب بتصفحه من بين {categories.length} قسماً
          </p>

          <ul className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-5">
            {categories.map((cat) => (
              <li key={cat.id}>
                <Link
                  href={`/category/${cat.slug}`}
                  className="group block bg-card border border-border rounded-3xl overflow-hidden hover:border-primary/40 hover:shadow-lg transition-all"
                >
                  <div className="relative aspect-[4/3] bg-secondary overflow-hidden">
                    <SafeImage
                      src={cat.image}
                      alt={cat.name}
                      fill
                      sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
                      className="object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
                  </div>
                  <div className="flex items-center justify-between gap-2 p-3 md:p-4">
                    <div className="min-w-0">
                      <h2 className="font-bold text-foreground line-clamp-1">{cat.name}</h2>
                      {cat.productCount ? (
                        <p className="text-xs text-muted-foreground">{cat.productCount} منتج</p>
                      ) : null}
                    </div>
                    <ArrowLeft className="w-5 h-5 text-primary shrink-0" aria-hidden="true" />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </main>
      <Footer />
      <MobileNav />
    </>
  )
}
