"use client"

import { useMemo, useState } from "react"
import { Search as SearchIcon } from "lucide-react"
import { ProductCard } from "@/components/product-card"
import { BrandCard } from "@/components/brand-card"
import type { Product, Brand } from "@/lib/types"

export function SearchClient({ products, brands = [] }: { products: Product[]; brands?: Brand[] }) {
  const [query, setQuery] = useState("")

  const q = query.trim().toLowerCase()

  const results = useMemo(() => {
    if (!q) return products
return products.filter(
  (p) =>
    p.name.toLowerCase().includes(q) ||
    p.description.toLowerCase().includes(q) ||
    p.category.toLowerCase().includes(q) ||
    (p.subcategory ?? "").toLowerCase().includes(q) ||
    (p.brand ?? "").toLowerCase().includes(q) ||
    p.id.toLowerCase().includes(q) ||
    (p.sku ?? "").toLowerCase().includes(q),
)
  }, [q, products])

  const brandResults = useMemo(() => {
    if (!q) return brands
    return brands.filter(
      (b) =>
        b.name.toLowerCase().includes(q) ||
        b.slug.toLowerCase().includes(q) ||
        (b.description ?? "").toLowerCase().includes(q),
    )
  }, [q, brands])

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <h1 className="text-2xl font-bold mb-4">البحث</h1>
      <div className="relative mb-6">
        <SearchIcon
          className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground"
          aria-hidden="true"
        />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
placeholder="ابحث باسم المنتج أو رقم الصنف أو الماركة..."
aria-label="ابحث باسم المنتج أو رقم الصنف أو الماركة"
          className="w-full bg-card border border-border rounded-full pr-12 pl-5 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          autoFocus
        />
      </div>

      {/* نتائج الماركات */}
      {brandResults.length > 0 && (
        <section className="mb-8" aria-label="الماركات">
          <p className="text-sm text-muted-foreground mb-4">الماركات ({brandResults.length})</p>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-5">
            {brandResults.map((brand) => (
              <BrandCard key={brand.id} brand={brand} />
            ))}
          </div>
        </section>
      )}

      {/* نتائج المنتجات */}
      <p className="text-sm text-muted-foreground mb-4">المنتجات ({results.length})</p>
      {results.length === 0 && brandResults.length === 0 ? (
        <div className="bg-secondary rounded-2xl p-12 text-center">
          <p className="text-muted-foreground">لا توجد نتائج تطابق بحثك</p>
        </div>
      ) : results.length === 0 ? null : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-5">
          {results.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      )}
    </div>
  )
}
