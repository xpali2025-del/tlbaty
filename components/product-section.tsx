import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import type { Product } from "@/lib/types"
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
    <section id={id} className="py-8" aria-label={title}>
      <div className="mx-auto max-w-7xl px-4">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-xl md:text-2xl font-bold text-foreground">{title}</h2>
          <Link
            href={viewAllHref}
            className="inline-flex items-center gap-1 text-sm text-primary font-bold hover:underline"
          >
            عرض الكل
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          </Link>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-5">
          {products.slice(0, limit).map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      </div>
    </section>
  )
}
