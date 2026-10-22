"use client"

import { useEffect, useMemo, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Camera, Loader2, Search as SearchIcon, SlidersHorizontal, X } from "lucide-react"
import { ProductCard } from "@/components/product-card"
import { BrandCard } from "@/components/brand-card"
import { useCurrency } from "@/components/currency-provider"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { paletteFromFile } from "@/lib/image-palette-client"
import type { PaletteColor } from "@/lib/palette"
import { activeFilterCount, buildSearchQuery, SEARCH_PAGE_SIZE, SEARCH_SORTS, type SearchParams, type SearchSort } from "@/lib/search-params"
import type { SearchFacets, SearchResult } from "@/lib/search-types"
import type { Brand, Product } from "@/lib/types"

const SORT_LABELS: Record<SearchSort, string> = {
  relevance: "الأكثر صلة",
  newest: "الأحدث",
  price_asc: "السعر: من الأقل",
  price_desc: "السعر: من الأعلى",
  popular: "الأكثر مبيعاً",
  rating: "الأعلى تقييماً",
}

type ImageMode = { previewUrl: string; palette: PaletteColor[]; items: (Product & { similarity: number })[]; total: number }

export function SearchClient({
  params,
  result,
  facets,
  brands,
}: {
  params: SearchParams
  result: SearchResult
  facets: SearchFacets
  brands: Brand[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [text, setText] = useState(params.q ?? "")
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [image, setImage] = useState<ImageMode | null>(null)
  const [imageBusy, setImageBusy] = useState(false)
  const [imageError, setImageError] = useState("")
  const fileRef = useRef<HTMLInputElement>(null)

  // الرابط هو مصدر الحقيقة: كل تغيير يحدّث الرابط فيعيد الخادم النتائج (يمكن مشاركة الرابط).
  const go = (next: SearchParams) => {
    startTransition(() => {
      const qs = buildSearchQuery(next)
      router.replace(qs ? `/search?${qs}` : "/search", { scroll: false })
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

  const matchingBrands = useMemo(() => {
    const q = (params.q ?? "").trim().toLowerCase()
    if (!q) return []
    return brands.filter((b) => b.name.toLowerCase().includes(q) || b.slug.toLowerCase().includes(q)).slice(0, 4)
  }, [params.q, brands])

  async function onPickImage(file: File | undefined) {
    if (!file) return
    setImageError("")
    setImageBusy(true)
    try {
      const { palette, previewUrl } = await paletteFromFile(file)
      const res = await fetch("/api/search/image", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ palette, filters: Object.fromEntries(new URLSearchParams(buildSearchQuery({ ...params, q: undefined, sort: undefined, limit: undefined }))) }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.message ?? "تعذّر البحث بالصورة. حاول مرة أخرى.")
      const data = (await res.json()) as { items: ImageMode["items"]; total: number }
      setImage((old) => {
        if (old) URL.revokeObjectURL(old.previewUrl)
        return { previewUrl, palette, items: data.items, total: data.total }
      })
    } catch (e) {
      setImageError(e instanceof Error ? e.message : "تعذّر البحث بالصورة.")
    } finally {
      setImageBusy(false)
      if (fileRef.current) fileRef.current.value = ""
    }
  }

  function clearImage() {
    if (image) URL.revokeObjectURL(image.previewUrl)
    setImage(null)
    setImageError("")
  }

  const panel = <FilterPanel params={params} facets={facets} update={update} />

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <h1 className="mb-4 text-2xl font-bold">البحث</h1>

      <div className="mb-3 flex gap-2">
        <div className="relative flex-1">
          <SearchIcon className="pointer-events-none absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            type="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") update({ q: text.trim() || undefined })
            }}
            placeholder="ابحث بالاسم أو رمز المنتج (مثل DR-012) أو الماركة أو اللون..."
            aria-label="ابحث بالاسم أو رمز المنتج أو الماركة"
            className="w-full rounded-full border border-border bg-card py-3 pl-5 pr-12 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            autoFocus
          />
        </div>
        <input ref={fileRef} type="file" accept="image/*" className="sr-only" aria-label="اختيار صورة للبحث" tabIndex={-1} onChange={(e) => onPickImage(e.target.files?.[0])} />
        <Button type="button" variant="outline" className="h-auto gap-2 rounded-full px-4" onClick={() => fileRef.current?.click()} disabled={imageBusy} aria-label="البحث بالصورة">
          {imageBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Camera className="h-4 w-4" aria-hidden="true" />}
          <span className="hidden sm:inline">بحث بالصورة</span>
        </Button>
        <Button type="button" variant="outline" className="h-auto gap-2 rounded-full px-4 lg:hidden" onClick={() => setFiltersOpen(true)}>
          <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
          <span>الفلاتر{filterCount ? ` (${filterCount})` : ""}</span>
        </Button>
      </div>

      {imageError && <p className="mb-3 rounded-xl bg-destructive/10 px-4 py-2 text-sm text-destructive">{imageError}</p>}

      <div className="flex flex-col gap-6 lg:flex-row">
        <aside className="hidden w-64 shrink-0 lg:block">
          <div className="sticky top-4 max-h-[calc(100vh-2rem)] overflow-y-auto rounded-2xl border border-border bg-card p-4">{panel}</div>
        </aside>

        <div className={`min-w-0 flex-1 transition-opacity ${pending ? "opacity-60" : ""}`} aria-busy={pending}>
          {image ? (
            <ImageResults image={image} onClear={clearImage} />
          ) : (
            <>
              <ActiveChips params={params} facets={facets} update={update} onClear={() => go({ q: params.q })} />

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

              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground" role="status">
                  {result.total} منتج
                  {result.matchedCode ? <span className="mr-2 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">طابق الرمز {result.matchedCode}</span> : null}
                </p>
                <select
                  value={params.sort ?? "relevance"}
                  onChange={(e) => update({ sort: e.target.value as SearchSort })}
                  className="h-11 rounded-lg border border-border bg-card px-3 text-sm"
                  aria-label="ترتيب النتائج"
                >
                  {SEARCH_SORTS.filter((s) => s !== "relevance" || params.q).map((s) => (
                    <option key={s} value={s}>
                      {s === "relevance" && !params.q ? "الافتراضي" : SORT_LABELS[s]}
                    </option>
                  ))}
                  {!params.q && <option value="relevance">الافتراضي</option>}
                </select>
              </div>

              {shown.length === 0 ? (
                <div className="rounded-2xl bg-secondary p-12 text-center">
                  <p className="text-muted-foreground">لا توجد نتائج تطابق بحثك</p>
                  {(filterCount > 0 || params.q) && (
                    <Button variant="outline" className="mt-4" onClick={() => { setText(""); go({}) }}>
                      مسح البحث والفلاتر
                    </Button>
                  )}
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-5 xl:grid-cols-4">
                    {shown.map((product) => (
                      <ProductCard key={product.id} product={product} />
                    ))}
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
      </div>

      <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
        <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-2xl p-4" dir="rtl">
          <SheetHeader className="mb-2 p-0">
            <SheetTitle>الفلاتر</SheetTitle>
          </SheetHeader>
          {panel}
          <Button className="mt-4 w-full" onClick={() => setFiltersOpen(false)}>
            عرض {result.total} منتج
          </Button>
        </SheetContent>
      </Sheet>
    </div>
  )
}

function ImageResults({ image, onClear }: { image: ImageMode; onClear: () => void }) {
  return (
    <section aria-label="نتائج البحث بالصورة">
      <div className="mb-4 flex items-center gap-3 rounded-2xl border border-border bg-card p-3">
        {/* معاينة محلية من ذاكرة المتصفح — الصورة لا تُرفع */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image.previewUrl} alt="الصورة التي بحثت بها" className="h-16 w-16 rounded-lg object-cover" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold">منتجات مشابهة لصورتك</p>
          <div className="mt-1 flex items-center gap-1.5" aria-label="ألوان الصورة">
            {image.palette.map((c) => (
              <span key={c.hex} title={c.hex} className="h-4 w-4 rounded-full border border-border" style={{ backgroundColor: c.hex }} />
            ))}
            <span className="mr-2 text-xs text-muted-foreground">نطابق الألوان والمظهر العام؛ حدّد القسم لنتائج أدق.</span>
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={onClear} aria-label="إغلاق البحث بالصورة">
          <X className="h-4 w-4" />
        </Button>
      </div>
      {image.items.length === 0 ? (
        <div className="rounded-2xl bg-secondary p-12 text-center">
          <p className="text-muted-foreground">لم نجد منتجات قريبة من هذه الصورة. جرّب صورة أخرى أو ابحث بالاسم.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-5 xl:grid-cols-4">
          {image.items.map((product) => (
            <div key={product.id} className="relative">
              <ProductCard product={product} />
              <span className="pointer-events-none absolute left-2 top-2 rounded-full bg-background/90 px-2 py-0.5 text-xs font-bold text-primary shadow">
                {Math.round(product.similarity * 100)}%
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function ActiveChips({ params, facets, update, onClear }: { params: SearchParams; facets: SearchFacets; update: (p: Partial<SearchParams>) => void; onClear: () => void }) {
  const { currency } = useCurrency()
  const chips: { key: string; label: string; remove: () => void }[] = []
  const cat = facets.categories.find((c) => c.slug === params.category)
  if (params.category) chips.push({ key: "cat", label: cat?.name ?? params.category, remove: () => update({ category: undefined, subcategory: undefined }) })
  if (params.subcategory) chips.push({ key: "sub", label: cat?.subcategories.find((s) => s.slug === params.subcategory)?.name ?? params.subcategory, remove: () => update({ subcategory: undefined }) })
  if (params.brand) chips.push({ key: "brand", label: facets.brands.find((b) => b.slug === params.brand)?.name ?? params.brand, remove: () => update({ brand: undefined }) })
  for (const c of params.colors ?? []) chips.push({ key: `c-${c}`, label: facets.colors.find((x) => x.key === c)?.label ?? c, remove: () => update({ colors: params.colors?.filter((x) => x !== c) }) })
  for (const s of params.sizes ?? []) chips.push({ key: `s-${s}`, label: `المقاس ${s}`, remove: () => update({ sizes: params.sizes?.filter((x) => x !== s) }) })
  if (params.minPrice !== undefined || params.maxPrice !== undefined) {
    const from = params.minPrice !== undefined ? Math.round(params.minPrice / currency.rate) : null
    const to = params.maxPrice !== undefined ? Math.round(params.maxPrice / currency.rate) : null
    chips.push({ key: "price", label: `${from ?? 0} – ${to ?? "∞"} ${currency.symbol}`, remove: () => update({ minPrice: undefined, maxPrice: undefined }) })
  }
  if (params.inStock) chips.push({ key: "stock", label: "متوفر فقط", remove: () => update({ inStock: undefined }) })
  if (params.onSale) chips.push({ key: "sale", label: "عليه تخفيض", remove: () => update({ onSale: undefined }) })
  if (chips.length === 0) return null
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {chips.map((c) => (
        <button key={c.key} type="button" onClick={c.remove} className="flex items-center gap-1 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary hover:bg-primary/20">
          {c.label}
          <X className="h-3 w-3" aria-label="إزالة" />
        </button>
      ))}
      <button type="button" onClick={onClear} className="text-xs text-muted-foreground underline">
        مسح الكل
      </button>
    </div>
  )
}

function FilterPanel({ params, facets, update }: { params: SearchParams; facets: SearchFacets; update: (p: Partial<SearchParams>) => void }) {
  const { currency } = useCurrency()
  const cat = facets.categories.find((c) => c.slug === params.category)
  const toDisplay = (base: number | undefined) => (base === undefined ? "" : String(Math.round(base / currency.rate)))
  const [min, setMin] = useState(toDisplay(params.minPrice))
  const [max, setMax] = useState(toDisplay(params.maxPrice))
  useEffect(() => {
    setMin(toDisplay(params.minPrice))
    setMax(toDisplay(params.maxPrice))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.minPrice, params.maxPrice, currency.code])

  const applyPrice = () => {
    const lo = min.trim() === "" ? undefined : Math.round(Number(min) * currency.rate)
    const hi = max.trim() === "" ? undefined : Math.round(Number(max) * currency.rate)
    if ((lo !== undefined && !Number.isFinite(lo)) || (hi !== undefined && !Number.isFinite(hi))) return
    update({ minPrice: lo, maxPrice: hi })
  }

  const toggle = (list: string[] | undefined, value: string) => {
    const set = new Set(list ?? [])
    if (set.has(value)) set.delete(value)
    else set.add(value)
    return set.size ? [...set] : undefined
  }

  return (
    <div className="flex flex-col gap-5 text-sm">
      <FilterGroup title="القسم">
        <div className="flex flex-col gap-1">
          <FilterOption active={!params.category} onClick={() => update({ category: undefined, subcategory: undefined })}>
            كل الأقسام
          </FilterOption>
          {facets.categories.map((c) => (
            <FilterOption key={c.slug} active={params.category === c.slug} count={c.count} onClick={() => update({ category: c.slug, subcategory: undefined })}>
              {c.name}
            </FilterOption>
          ))}
        </div>
        {cat && cat.subcategories.length > 0 && (
          <div className="mt-2 flex flex-col gap-1 border-r-2 border-primary/30 pr-3">
            {cat.subcategories.map((s) => (
              <FilterOption key={s.slug} active={params.subcategory === s.slug} count={s.count} onClick={() => update({ subcategory: params.subcategory === s.slug ? undefined : s.slug })}>
                {s.name}
              </FilterOption>
            ))}
          </div>
        )}
      </FilterGroup>

      {facets.colors.length > 0 && (
        <FilterGroup title="اللون">
          <div className="flex flex-wrap gap-2">
            {facets.colors.slice(0, 24).map((c) => {
              const active = params.colors?.includes(c.key)
              return (
                <button
                  key={c.key}
                  type="button"
                  title={`${c.label} (${c.count})`}
                  aria-label={c.label}
                  aria-pressed={Boolean(active)}
                  onClick={() => update({ colors: toggle(params.colors, c.key) })}
                  className={`h-11 w-11 rounded-full border-2 transition ${active ? "scale-110 border-primary ring-2 ring-primary/30" : "border-border"}`}
                  style={{ backgroundColor: c.hex }}
                />
              )
            })}
          </div>
        </FilterGroup>
      )}

      {facets.sizes.length > 0 && (
        <FilterGroup title="المقاس">
          <div className="flex flex-wrap gap-2">
            {facets.sizes.map((s) => {
              const active = params.sizes?.includes(s.size)
              return (
                <button
                  key={s.size}
                  type="button"
                  aria-pressed={Boolean(active)}
                  onClick={() => update({ sizes: toggle(params.sizes, s.size) })}
                  className={`min-w-10 rounded-lg border px-3 py-1.5 text-xs font-medium ${active ? "border-primary bg-primary text-primary-foreground" : "border-border hover:border-primary/50"}`}
                >
                  {s.size}
                </button>
              )
            })}
          </div>
        </FilterGroup>
      )}

      {facets.brands.length > 0 && (
        <FilterGroup title="الماركة">
          <div className="flex flex-col gap-1">
            {facets.brands.map((b) => (
              <FilterOption key={b.slug} active={params.brand === b.slug} count={b.count} onClick={() => update({ brand: params.brand === b.slug ? undefined : b.slug })}>
                {b.name}
              </FilterOption>
            ))}
          </div>
        </FilterGroup>
      )}

      <FilterGroup title={`السعر (${currency.symbol})`}>
        <div className="flex items-center gap-2">
          <input value={min} onChange={(e) => setMin(e.target.value.replace(/\D/g, ""))} onBlur={applyPrice} onKeyDown={(e) => e.key === "Enter" && applyPrice()} inputMode="numeric" placeholder="من" aria-label="السعر من" className="h-9 w-full rounded-lg border border-border bg-background px-2 text-center text-sm" dir="ltr" />
          <span className="text-muted-foreground">–</span>
          <input value={max} onChange={(e) => setMax(e.target.value.replace(/\D/g, ""))} onBlur={applyPrice} onKeyDown={(e) => e.key === "Enter" && applyPrice()} inputMode="numeric" placeholder="إلى" aria-label="السعر إلى" className="h-9 w-full rounded-lg border border-border bg-background px-2 text-center text-sm" dir="ltr" />
        </div>
      </FilterGroup>

      <FilterGroup title="خيارات">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={Boolean(params.inStock)} onChange={(e) => update({ inStock: e.target.checked || undefined })} />
          المتوفر فقط
        </label>
        <label className="mt-2 flex items-center gap-2">
          <input type="checkbox" checked={Boolean(params.onSale)} onChange={(e) => update({ onSale: e.target.checked || undefined })} />
          عليه تخفيض
        </label>
      </FilterGroup>
    </div>
  )
}

function FilterGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset>
      <legend className="mb-2 font-bold">{title}</legend>
      {children}
    </fieldset>
  )
}

function FilterOption({ active, count, onClick, children }: { active: boolean; count?: number; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={Boolean(active)} className={`flex items-center justify-between rounded-lg px-2 py-1.5 text-right ${active ? "bg-primary/10 font-bold text-primary" : "hover:bg-muted"}`}>
      <span>{children}</span>
      {count !== undefined && <span className="text-xs text-muted-foreground">{count}</span>}
    </button>
  )
}
