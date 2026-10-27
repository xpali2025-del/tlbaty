"use client"

import { useEffect, useMemo, useState } from "react"
import { useUrlParam } from "@/hooks/use-url-param"
import { LayoutGrid } from "lucide-react"
import type { Ad, Product, Subcategory } from "@/lib/types"
import { ProductCard } from "@/components/product-card"
import { AdBanner, interleaveAds } from "@/components/ad-banner"
import { adsForPlacement } from "@/lib/ads"

type SubWithCount = Subcategory & { count: number }

export function CategoryProducts({
  products,
  subcategories,
  ads = [],
}: {
  products: Product[]
  subcategories: SubWithCount[]
  ads?: Ad[]
}) {
  const [subFromUrl, setSubParam] = useUrlParam("sub")

  const validSlugs = useMemo(() => subcategories.map((s) => s.slug), [subcategories])

  const [active, setActive] = useState<string>("all")

  useEffect(() => {
    setActive(subFromUrl && validSlugs.includes(subFromUrl) ? subFromUrl : "all")
  }, [subFromUrl, validSlugs])

  const changeSub = (slug: string) => {
    setActive(slug)
    setSubParam(slug === "all" ? null : slug)
  }

  const results = useMemo(() => {
    if (active === "all") return products
    return products.filter((p) => p.subcategory === active)
  }, [products, active])

  const hasSubcategories = subcategories.length > 0

  const gridItems = useMemo(() => interleaveAds(results, adsForPlacement(ads, "category")), [results, ads])

  return (
    <div>
      {hasSubcategories && (
        <div
          className="flex flex-wrap items-center gap-2 mb-6"
          role="tablist"
          aria-label="الأقسام الفرعية"
        >
          <button
            role="tab"
            aria-selected={active === "all"}
            onClick={() => changeSub("all")}
            className={`inline-flex min-h-11 items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition-colors ${
              active === "all"
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-foreground hover:bg-accent"
            }`}
          >
            <LayoutGrid className="w-4 h-4" aria-hidden="true" />
            الكل
            <span className="text-xs opacity-80">({products.length})</span>
          </button>

          {subcategories.map((sub) => (
            <button
              key={sub.id}
              role="tab"
              aria-selected={active === sub.slug}
              onClick={() => changeSub(sub.slug)}
              disabled={sub.count === 0}
              className={`inline-flex min-h-11 items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                active === sub.slug
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-foreground hover:bg-accent"
              }`}
            >
              {sub.name}
              <span className="text-xs opacity-80">({sub.count})</span>
            </button>
          ))}
        </div>
      )}

      {results.length === 0 ? (
        <div className="bg-secondary rounded-2xl p-12 text-center">
          <p className="text-muted-foreground">لا توجد منتجات في هذا القسم حالياً</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-5">
          {gridItems.map((entry, i) =>
            entry.type === "ad" ? (
              <AdBanner key={`ad-${entry.value.id}-${i}`} ad={entry.value} />
            ) : (
              <ProductCard key={entry.value.id} product={entry.value} />
            ),
          )}
        </div>
      )}
    </div>
  )
}
