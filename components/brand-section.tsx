import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import type { Brand } from "@/lib/types"
import { BrandCard } from "./brand-card"

export function BrandSection({
  title = "تسوّق حسب الماركة",
  brands,
  viewAllHref = "/brands",
  limit = 4,
  id = "brands",
}: {
  title?: string
  brands: Brand[]
  viewAllHref?: string
  limit?: number
  id?: string
}) {
  if (brands.length === 0) return null
  return (
    <section id={id} className="py-9 md:py-12" aria-label={title}>
      <div className="mx-auto max-w-7xl px-4">
        <div className="mb-6 flex items-end justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-xs font-bold tracking-wide text-primary">علامات مختارة</span>
            <h2 className="text-xl font-bold tracking-tight text-foreground md:text-3xl">{title}</h2>
          </div>
          <Link prefetch={false}
            href={viewAllHref}
            className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-full bg-secondary px-4 text-sm font-bold text-secondary-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            عرض الكل
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4 lg:gap-5">
          {brands.slice(0, limit).map((brand) => (
            <BrandCard key={brand.id} brand={brand} />
          ))}
        </div>
      </div>
    </section>
  )
}
