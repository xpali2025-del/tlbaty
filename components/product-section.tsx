import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { toCardProduct, type Product } from "@/lib/types"
import { ProductCard } from "./product-card"

export function ProductSection({
  title,
  products,
  viewAllHref = "/categories",
  limit = 8,
  id,
}: {
  title: string
  products: Product[]
  viewAllHref?: string
  limit?: number
  id?: string
}) {
  if (products.length === 0) return null
  return (
    <section id={id} className="py-9 md:py-12" aria-label={title}>
      <div className="mx-auto max-w-7xl px-4">
        <div className="mb-5 flex items-end justify-between gap-4 md:mb-7">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-xs font-bold tracking-wide text-primary">مختارات ترف</span>
            <h2 className="text-xl font-bold tracking-tight text-foreground md:text-3xl">{title}</h2>
          </div>
          <Link
            href={viewAllHref}
            className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-full bg-secondary px-4 text-sm font-bold text-secondary-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            عرض الكل
            <ArrowLeft className="size-4" aria-hidden="true" />
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 md:gap-6">
          {products.slice(0, limit).map(toCardProduct).map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      </div>
    </section>
  )
}
