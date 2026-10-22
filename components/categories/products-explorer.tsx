"use client"

import { useEffect, useMemo, useState } from "react"
import { useUrlParam } from "@/hooks/use-url-param"
import { Search, X, LayoutGrid, Flame, Sparkles, Tag } from "lucide-react"
import type { Ad, Product, Category } from "@/lib/types"
import { ProductCard } from "@/components/product-card"
import { AdBanner, interleaveAds } from "@/components/ad-banner"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

type FilterKey = "all" | "bestsellers" | "new" | "offers"

const FILTERS: { key: FilterKey; label: string; icon: typeof LayoutGrid }[] = [
  { key: "all", label: "عرض الكل", icon: LayoutGrid },
  { key: "bestsellers", label: "الأكثر مبيعاً", icon: Flame },
  { key: "new", label: "المضاف حديثاً", icon: Sparkles },
  { key: "offers", label: "العروض", icon: Tag },
]

const VALID_FILTERS: FilterKey[] = ["all", "bestsellers", "new", "offers"]

function normalizeFilter(value: string | null): FilterKey {
  if (value && VALID_FILTERS.includes(value as FilterKey)) {
    return value as FilterKey
  }

  return "all"
}

function hasTag(p: Product, tag: string) {
  return Array.isArray(p.tags) && p.tags.includes(tag)
}

export function ProductsExplorer({
  products,
  categories,
  ads = [],
}: {
  products: Product[]
  categories: Category[]
  ads?: Ad[]
}) {
  const [filterParam, setFilterParam] = useUrlParam("filter")
  const filterFromUrl = normalizeFilter(filterParam)

  const [query, setQuery] = useState("")
  const [category, setCategory] = useState<string>("all")
  const [filter, setFilter] = useState<FilterKey>(filterFromUrl)

  useEffect(() => {
    setFilter(filterFromUrl)
  }, [filterFromUrl])

  const changeFilter = (nextFilter: FilterKey) => {
    setFilter(nextFilter)

    setFilterParam(nextFilter === "all" ? null : nextFilter)
  }

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()

    return products.filter((p) => {
      if (category !== "all" && p.category !== category) return false

      if (filter === "bestsellers" && !(hasTag(p, "bestseller") || p.isBestseller)) {
        return false
      }

      if (filter === "new" && !(hasTag(p, "new") || p.isNew)) {
        return false
      }

      const hasDiscount = typeof p.oldPrice === "number" && p.oldPrice > p.price
      if (filter === "offers" && !(hasTag(p, "offer") || hasDiscount)) {
        return false
      }

      if (q) {
        const haystack = `${p.name} ${p.description} ${p.category}`.toLowerCase()
        if (!haystack.includes(q)) return false
      }

      return true
    })
  }, [products, query, category, filter])

  // الإعلانات الظاهرة حسب القسم المختار:
  // - "كل الأقسام": تظهر فقط الإعلانات العامة (بلا أقسام أو "all").
  // - قسم محدد: تظهر إعلانات هذا القسم + الإعلانات العامة.
  const visibleAds = useMemo(() => {
    return ads.filter((a) => {
      const cats = a.categories
      const isGlobal = !cats || cats.length === 0 || cats.includes("all")
      if (category === "all") return isGlobal
      return isGlobal || cats!.includes(category)
    })
  }, [ads, category])

  const gridItems = useMemo(
    () => interleaveAds(results, visibleAds),
    [results, visibleAds],
  )

  const resetAll = () => {
    setQuery("")
    setCategory("all")
    changeFilter("all")
  }

  const isFiltered = query.trim() !== "" || category !== "all" || filter !== "all"

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <div className="mb-6">
        <h1 className="text-2xl md:text-3xl font-bold text-foreground mb-1">
          كافة المنتجات
        </h1>

        <p className="text-sm text-muted-foreground">
  ابحث وفلتر بين المنتجات للعثور على ما يناسبك
</p>
      </div>

      {/* شريط البحث المتقدم */}
      <div className="bg-card border border-border rounded-3xl p-4 md:p-5 shadow-sm mb-6">
        <div className="flex flex-col md:flex-row gap-3 md:items-center">
          <div className="relative flex-1">
            <Search
              className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground"
              aria-hidden="true"
            />

            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ابحث باسم المنتج..."
              aria-label="البحث باسم المنتج"
              className="w-full bg-secondary/60 border border-border rounded-2xl pr-12 pl-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
            />

            {query && (
              <button
                onClick={() => setQuery("")}
                aria-label="مسح البحث"
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <div className="md:w-56">
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger
                className="w-full rounded-2xl bg-secondary/60 py-6"
                aria-label="فلترة حسب القسم"
              >
                <SelectValue placeholder="كل الأقسام" />
              </SelectTrigger>

              <SelectContent>
                <SelectItem value="all">كل الأقسام</SelectItem>

                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.slug}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* فلاتر سريعة */}
        <div className="flex flex-wrap items-center gap-2 mt-4">
          {FILTERS.map((f) => {
            const Icon = f.icon
            const active = filter === f.key

            return (
              <button
                key={f.key}
                onClick={() => changeFilter(f.key)}
                className={`inline-flex min-h-11 items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                  active
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-foreground hover:bg-accent"
                }`}
              >
                <Icon className="w-4 h-4" aria-hidden="true" />
                {f.label}
              </button>
            )
          })}

          {isFiltered && (
            <button
              onClick={resetAll}
              className="inline-flex min-h-11 items-center gap-1 rounded-full px-3 py-2 text-sm text-muted-foreground hover:text-primary"
            >
              <X className="w-4 h-4" aria-hidden="true" />
              إعادة تعيين
            </button>
          )}
        </div>
      </div>


      {results.length === 0 ? (
        <div className="bg-secondary rounded-3xl p-12 text-center">
          <p className="text-muted-foreground">لا توجد منتجات مطابقة لبحثك</p>
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
