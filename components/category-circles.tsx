import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { SafeImage } from "@/components/safe-image"
import type { Category } from "@/lib/types"

export function CategoryCircles({ categories }: { categories: Category[] }) {
  if (categories.length === 0) return null
  return (
    <section className="py-6" aria-label="الأقسام الرئيسية">
      <div className="mx-auto max-w-7xl px-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl md:text-2xl font-bold text-foreground">الأقسام الرئيسية</h2>
          <Link
            href="/shop"
            className="inline-flex items-center gap-1 text-sm text-primary font-bold hover:underline"
          >
            عرض الكل
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          </Link>
        </div>
        <div className="flex gap-4 md:gap-6 overflow-x-auto scrollbar-hide pb-2">
          {categories.map((cat) => (
            <Link
              key={cat.id}
              href={`/category/${cat.slug}`}
              className="flex flex-col items-center gap-2 shrink-0 group"
            >
              <div className="relative w-20 h-20 md:w-24 md:h-24 rounded-full overflow-hidden bg-secondary ring-2 ring-transparent group-hover:ring-primary transition-all">
                <SafeImage
                  src={cat.image}
                  alt={cat.name}
                  fill
                  className="object-cover"
                  sizes="96px"
                />
              </div>
              <span className="text-xs md:text-sm font-medium text-foreground text-center line-clamp-1 w-20 md:w-24">
                {cat.name}
              </span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  )
}
