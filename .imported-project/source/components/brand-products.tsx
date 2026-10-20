"use client"

import { useMemo, useState } from "react"
import { LayoutGrid } from "lucide-react"
import type { Product, Category } from "@/lib/types"
import { ProductCard } from "@/components/product-card"

export function BrandProducts({
  products,
  categories,
}: {
  products: Product[]
  categories: Category[]
}) {
  const [active, setActive] = useState<string>("all")

  // الأقسام التي يتواجد فيها هذا البراند فعلياً
  const availableCategories = useMemo(() => {
    const slugs = new Set(products.map((p) => p.category))
    return categories
      .filter((c) => slugs.has(c.slug))
      .map((c) => ({
        ...c,
        count: products.filter((p) => p.category === c.slug).length,
      }))
  }, [products, categories])

  const results = useMemo(() => {
    if (active === "all") return products
    return products.filter((p) => p.category === active)
  }, [products, active])

  if (products.length === 0) {
    return (
      <div className="rounded-3xl bg-secondary p-12 text-center">
        <p className="text-muted-foreground">لا توجد منتجات لهذا البراند حالياً</p>
      </div>
    )
  }

  return (
    <div>
      {availableCategories.length > 1 && (
        <div
          className="mb-6 flex flex-wrap items-center gap-2"
          role="tablist"
          aria-label="فلترة منتجات البراند حسب القسم"
        >
          <button
            role="tab"
            aria-selected={active === "all"}
            onClick={() => setActive("all")}
            className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition-colors ${
              active === "all"
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-foreground hover:bg-accent"
            }`}
          >
            <LayoutGrid className="h-4 w-4" aria-hidden="true" />
            كل الأقسام
            <span className="text-xs opacity-80">({products.length})</span>
          </button>

          {availableCategories.map((cat) => (
            <button
              key={cat.id}
              role="tab"
              aria-selected={active === cat.slug}
              onClick={() => setActive(cat.slug)}
              className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                active === cat.slug
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-foreground hover:bg-accent"
              }`}
            >
              {cat.name}
              <span className="text-xs opacity-80">({cat.count})</span>
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-5 lg:grid-cols-4">
        {results.map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </div>
    </div>
  )
}
