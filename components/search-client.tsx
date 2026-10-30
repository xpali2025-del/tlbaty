"use client"

import { useEffect, useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import dynamic from "next/dynamic"
import { Flame, LayoutGrid, Search as SearchIcon, SlidersHorizontal, Tag, X } from "lucide-react"
import { ProductCard } from "@/components/product-card"
import { AdBanner, interleaveAds } from "@/components/ad-banner"
import { adsForPlacement } from "@/lib/ads"
import { BrandCard } from "@/components/brand-card"
import { useCurrency } from "@/components/currency-provider"
import { SearchFilterSheet, type FilterDraft } from "@/components/search-filter-sheet"
import { Button } from "@/components/ui/button"
import type { ImageMode } from "@/components/image-search"
import { activeFilterCount, buildSearchQuery, SEARCH_PAGE_SIZE, type SearchParams } from "@/lib/search-params"
import type { SearchFacets, SearchResult } from "@/lib/search-types"
import type { Ad, Brand } from "@/lib/types"

// The image feature is a separate client chunk; the disabled page never renders it.
const ImageSearchButton = dynamic(() => import("@/components/image-search").then(m => m.ImageSearchButton), { ssr: false })
const ImageSearchResults = dynamic(() => import("@/components/image-search").then(m => m.ImageSearchResults), { ssr: false })

const QUICK: { key: "all" | "sale" | "bestseller"; label: string; icon: typeof LayoutGrid }[] = [
  { key: "all", label: "الكل", icon: LayoutGrid },
  { key: "sale", label: "العروض", icon: Tag },
  { key: "bestseller", label: "الأكثر مبيعاً", icon: Flame },
]

export function SearchClient({
  imageSearchEnabled,
  params,
  result,
  facets,
  brands,
  ads = [],
  basePath = "/search",
}: {
  imageSearchEnabled: boolean
  params: SearchParams
  result: SearchResult
  facets: SearchFacets
  brands: Brand[]
  ads?: Ad[]
  /** مسار الصفحة الحالية (/search أو /categories) — كل التنقلات تبقى عليه. */
  basePath?: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [text, setText] = useState(params.q ?? "")
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [image, setImage] = useState<ImageMode | null>(null)
  const [imageError, setImageError] = useState("")

  // الرابط هو مصدر الحقيقة: كل تغيير يحدّث الرابط فيعيد الخادم النتائج (يمكن مشاركة الرابط).
  const go = (next: SearchParams) => {
    startTransition(() => {
      const qs = buildSearchQuery(next)
      router.replace(qs ? `${basePath}?${qs}` : basePath, { scroll: false })
    })
  }
  const update = (patch: Partial<SearchParams>) => go({ ...params, ...patch, limit: undefined })

  // بحث أثناء الكتابة مع تأخير حتى لا يُرسَل طلب لكل حرف.
  useEffect(() => {
    if ((params.q ?? "") === text.trim()) return
    const t = setTimeout(() => update({ q: text.trim() || undefined }), 350)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text])

  const filterCount = activeFilterCount(params)
  const shown = result.items
  const hasMore = shown.length < result.total && shown.length >= result.limit
  const quick = params.onSale ? "sale" : params.bestseller ? "bestseller" : "all"

  const matchingBrands = useMemo(() => {
    const q = (params.q ?? "").trim().toLowerCase()
    if (!q) return []
    return brands.filter((b) => b.name.toLowerCase().includes(q) || b.slug.toLowerCase().includes(q)).slice(0, 4)
  }, [params.q, brands])

  // الإعلانات داخل الشبكة: بلا أقسام محددة تظهر العامة فقط، ومع أقسام تظهر العامة + إعلانات هذه الأقسام.
  const visibleAds = useMemo(() => {
    const selected = params.categories ?? []
    return adsForPlacement(ads, "grid").filter((a) => {
      const cats = a.categories
      const isGlobal = !cats || cats.length === 0 || cats.includes("all")
      if (selected.length === 0) return isGlobal
      return isGlobal || selected.some((c) => cats!.includes(c))
    })
  }, [ads, params.categories])
  const gridItems = useMemo(() => interleaveAds(shown, visibleAds), [shown, visibleAds])

  useEffect(() => () => { if (image) URL.revokeObjectURL(image.previewUrl) }, [image])
  function clearImage() {
    setImage(null)
    setImageError("")
  }

  const applyFilters = (d: FilterDraft) => {
    setFiltersOpen(false)
    // الفلتر لا يمسّ النص ولا الشرائح السريعة. subcategory يُمسح مع تغيير الأقسام.
    update({ ...d, subcategory: d.categories?.join() === params.categories?.join() ? params.subcategory : undefined })
  }

  const pickQuick = (key: (typeof QUICK)[number]["key"]) => update({ onSale: key === "sale" ? true : undefined, bestseller: key === "bestseller" ? true : undefined })

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <h1 className="mb-1 text-2xl font-bold md:text-3xl">{params.q ? "نتائج البحث" : "كافة المنتجات"}</h1>
      <p className="mb-4 text-sm text-muted-foreground">ابحث بالاسم أو رمز المنتج{imageSearchEnabled ? " أو بصورة" : ""}، وفلتر لتصل لما يناسبك</p>

      <div className="mb-3 flex items-center gap-2">
        <div className="relative flex-1">
          <SearchIcon className="pointer-events-none absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            type="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") update({ q: text.trim() || undefined })
            }}
            placeholder="ابحث بالاسم أو رمز المنتج"
            aria-label="ابحث بالاسم أو رمز المنتج أو الماركة"
            className="h-12 w-full rounded-full border border-border bg-card pl-24 pr-12 text-sm focus:outline-none focus:ring-2 focus:ring-primary [&::-webkit-search-cancel-button]:hidden"
            autoFocus={basePath === "/search"}
          />
          {/* زر الصورة داخل المربع كما في جوجل */}
          <div className="absolute left-1.5 top-1/2 flex -translate-y-1/2 items-center">
            {text && (
              <button type="button" onClick={() => { setText(""); update({ q: undefined }) }} aria-label="مسح النص" className="flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground hover:bg-muted">
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
            {imageSearchEnabled && <ImageSearchButton params={params} onError={setImageError} onSelect={setImage} />}
          </div>
        </div>
        {/* أيقونة الفلتر بلا نص */}
        <button
          type="button"
          onClick={() => setFiltersOpen(true)}
          aria-label={filterCount ? `الفلتر (${filterCount} مفعّل)` : "الفلتر"}
          title="الفلتر"
          className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-border bg-card hover:bg-muted"
        >
          <SlidersHorizontal className="h-5 w-5" aria-hidden="true" />
          {filterCount > 0 && (
            <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-xs font-bold text-primary-foreground">{filterCount}</span>
          )}
        </button>
      </div>

      {/* خيارات سريعة */}
      <div className="mb-4 flex flex-wrap items-center gap-2" role="group" aria-label="تصفية سريعة">
        {QUICK.map((q) => {
          const Icon = q.icon
          const active = quick === q.key
          return (
            <button
              key={q.key}
              type="button"
              aria-pressed={active}
              onClick={() => pickQuick(q.key)}
              className={`inline-flex min-h-11 items-center gap-1.5 rounded-full px-4 text-sm font-medium transition-colors ${active ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground hover:bg-accent"}`}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              {q.label}
            </button>
          )
        })}
      </div>

      {imageError && <p className="mb-3 rounded-xl bg-destructive/10 px-4 py-2 text-sm text-destructive">{imageError}</p>}

      <div className={`min-w-0 transition-opacity ${pending ? "opacity-60" : ""}`} aria-busy={pending}>
        {imageSearchEnabled && image ? (
          <ImageSearchResults image={image} onClear={clearImage} />
        ) : (
          <>
            <ActiveChips params={params} facets={facets} update={update} onClear={() => { setText(""); go({}) }} />

            {matchingBrands.length > 0 && (
              <section className="mb-6" aria-label="الماركات">
                <p className="mb-3 text-sm text-muted-foreground">الماركات</p>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  {matchingBrands.map((b) => (
                    <BrandCard key={b.id} brand={b} />
                  ))}
                </div>
              </section>
            )}

            <p className="mb-4 text-sm text-muted-foreground" role="status">
              {result.total} منتج
              {result.matchedCode ? <span className="mr-2 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">طابق الرمز {result.matchedCode}</span> : null}
            </p>

            {shown.length === 0 ? (
              <div className="rounded-2xl bg-secondary p-12 text-center">
                <p className="text-muted-foreground">لا توجد نتائج تطابق بحثك</p>
                {(filterCount > 0 || params.q || params.onSale || params.bestseller) && (
                  <Button variant="outline" className="mt-4" onClick={() => { setText(""); go({}) }}>
                    مسح البحث والفلاتر
                  </Button>
                )}
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-5 lg:grid-cols-4">
                  {gridItems.map((entry, i) =>
                    entry.type === "ad" ? <AdBanner key={`ad-${entry.value.id}-${i}`} ad={entry.value} /> : <ProductCard key={entry.value.id} product={entry.value} />,
                  )}
                </div>
                {hasMore && (
                  <div className="mt-6 text-center">
                    <Button variant="outline" onClick={() => go({ ...params, limit: shown.length + SEARCH_PAGE_SIZE })} disabled={pending}>
                      {pending ? "جارٍ التحميل..." : "عرض المزيد"}
                    </Button>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>

      <SearchFilterSheet
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        initial={{ categories: params.categories, colors: params.colors, sizes: params.sizes, minPrice: params.minPrice, maxPrice: params.maxPrice, sort: params.sort, brand: params.brand, inStock: params.inStock }}
        facets={facets}
        onApply={applyFilters}
      />
    </div>
  )
}


function ActiveChips({ params, facets, update, onClear }: { params: SearchParams; facets: SearchFacets; update: (p: Partial<SearchParams>) => void; onClear: () => void }) {
  const { currency } = useCurrency()
  const chips: { key: string; label: string; remove: () => void }[] = []
  for (const slug of params.categories ?? []) {
    chips.push({ key: `cat-${slug}`, label: facets.categories.find((c) => c.slug === slug)?.name ?? slug, remove: () => update({ categories: params.categories?.filter((x) => x !== slug), subcategory: undefined }) })
  }
  if (params.subcategory) {
    const sub = facets.categories.flatMap((c) => c.subcategories).find((s) => s.slug === params.subcategory)
    chips.push({ key: "sub", label: sub?.name ?? params.subcategory, remove: () => update({ subcategory: undefined }) })
  }
  if (params.brand) chips.push({ key: "brand", label: facets.brands.find((b) => b.slug === params.brand)?.name ?? params.brand, remove: () => update({ brand: undefined }) })
  for (const c of params.colors ?? []) chips.push({ key: `c-${c}`, label: facets.colors.find((x) => x.key === c)?.label ?? c, remove: () => update({ colors: params.colors?.filter((x) => x !== c) }) })
  for (const s of params.sizes ?? []) chips.push({ key: `s-${s}`, label: `المقاس ${s}`, remove: () => update({ sizes: params.sizes?.filter((x) => x !== s) }) })
  if (params.minPrice !== undefined || params.maxPrice !== undefined) {
    const from = params.minPrice !== undefined ? Math.round(params.minPrice / currency.rate) : null
    const to = params.maxPrice !== undefined ? Math.round(params.maxPrice / currency.rate) : null
    chips.push({ key: "price", label: `${from ?? 0} – ${to ?? "∞"} ${currency.symbol}`, remove: () => update({ minPrice: undefined, maxPrice: undefined }) })
  }
  if (params.inStock) chips.push({ key: "stock", label: "متوفر فقط", remove: () => update({ inStock: undefined }) })
  if (chips.length === 0) return null
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {chips.map((c) => (
        <button key={c.key} type="button" onClick={c.remove} className="flex min-h-9 items-center gap-1 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary hover:bg-primary/20">
          {c.label}
          <X className="h-3 w-3" aria-label="إزالة" />
        </button>
      ))}
      <button type="button" onClick={onClear} className="min-h-9 text-xs text-muted-foreground underline">
        مسح الكل
      </button>
    </div>
  )
}
