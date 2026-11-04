import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { SafeImage } from "@/components/safe-image"
import type { Category } from "@/lib/types"

export function CategoryCircles({ categories }: { categories: Category[] }) {
  if (categories.length === 0) return null
  return (
    <section className="py-8 md:py-10" aria-label="الأقسام الرئيسية">
      <div className="mx-auto max-w-7xl px-4">
        <div className="mb-5 flex items-end justify-between gap-4">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-bold tracking-wide text-primary">اكتشفي مجموعتنا</span>
            <h2 className="text-xl font-bold tracking-tight text-foreground md:text-3xl">الأقسام الرئيسية</h2>
          </div>
          <Link prefetch={false}
            href="/shop"
            className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-full bg-secondary px-4 text-sm font-bold text-secondary-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            عرض الكل
            <ArrowLeft className="size-4" aria-hidden="true" />
          </Link>
        </div>
        <div className="scrollbar-hide flex gap-3 overflow-x-auto pb-3 md:gap-4">
          {categories.map((cat) => (
            <Link prefetch={false}
              key={cat.id}
              href={`/category/${cat.slug}`}
              className="group flex w-[7.25rem] shrink-0 flex-col gap-2 rounded-[1.4rem] border border-border/70 bg-card p-2 shadow-[0_12px_30px_-28px_rgba(57,24,33,0.55)] transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:w-[8.5rem]"
            >
              <div className="relative aspect-square overflow-hidden rounded-[1rem] bg-secondary">
                <SafeImage
                  src={cat.image}
                  alt={cat.name}
                  fill
                  className="object-cover transition-transform duration-500 group-hover:scale-105"
                  sizes="136px"
                />
              </div>
              <span className="line-clamp-1 px-1 pb-1 text-center text-xs font-bold text-foreground md:text-sm">
                {cat.name}
              </span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  )
}
