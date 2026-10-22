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
    <section id={id} className="py-8" aria-label={title}>
      <div className="mx-auto max-w-7xl px-4">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-xl md:text-2xl font-bold text-foreground">{title}</h2>
          <Link prefetch={false}
            href={viewAllHref}
            className="inline-flex items-center gap-1 text-sm text-primary font-bold hover:underline"
          >
            عرض الكل
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          </Link>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-5">
          {brands.slice(0, limit).map((brand) => (
            <BrandCard key={brand.id} brand={brand} />
          ))}
        </div>
      </div>
    </section>
  )
}
