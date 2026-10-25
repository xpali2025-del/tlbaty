"use client"

import { useMemo, useState } from "react"
import { Check } from "lucide-react"
import { useCurrency } from "@/components/currency-provider"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Slider } from "@/components/ui/slider"
import { useIsMobile } from "@/hooks/use-mobile"
import type { SearchParams, SearchSort } from "@/lib/search-params"
import type { SearchFacets } from "@/lib/search-types"

/** الحقول التي يتحكم بها الفلتر؛ الباقي (النص والشرائح السريعة) خارجه. */
export type FilterDraft = Pick<SearchParams, "categories" | "colors" | "sizes" | "minPrice" | "maxPrice" | "sort" | "brand" | "inStock">

const SORT_OPTIONS: { value: SearchSort; label: string }[] = [
  { value: "relevance", label: "الافتراضي" },
  { value: "newest", label: "الأحدث" },
  { value: "popular", label: "الأكثر مبيعاً" },
  { value: "price_asc", label: "السعر: من الأقل" },
  { value: "price_desc", label: "السعر: من الأعلى" },
]

export const EMPTY_DRAFT: FilterDraft = {
  categories: undefined,
  colors: undefined,
  sizes: undefined,
  minPrice: undefined,
  maxPrice: undefined,
  sort: undefined,
  brand: undefined,
  inStock: undefined,
}

/** خطوة منزلقة السعر مناسبة للمدى (قيم الأساس بالريال): 1 أو 10 أو 100… بحيث تكون ~50–500 خطوة. */
export function priceStep(min: number, max: number): number {
  const range = Math.max(max - min, 1)
  return Math.max(1, 10 ** Math.floor(Math.log10(range / 50)))
}

/**
 * «تحديد الكل» + عناصر: القائمة الفارغة تعني الكل. إلغاء عنصر والكل محدد = كل شيء ما عداه.
 * إن عادت الاختيارات إلى الكل (أو فرغت) رجعنا إلى «الكل» (undefined) فلا يظهر فلتر زائف في الرابط.
 */
export function toggleMulti(selected: string[] | undefined, all: string[], value: string): string[] | undefined {
  const effective = new Set(selected?.length ? selected : all)
  if (effective.has(value)) effective.delete(value)
  else effective.add(value)
  if (effective.size === 0 || effective.size >= all.length) return undefined
  return all.filter((x) => effective.has(x))
}

export function SearchFilterSheet({
  open,
  onOpenChange,
  initial,
  facets,
  onApply,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  initial: FilterDraft
  facets: SearchFacets
  onApply: (draft: FilterDraft) => void
}) {
  const isMobile = useIsMobile()
  // يُعاد إنشاء النموذج عند كل فتح (key) فيبدأ من القيم المطبّقة حالياً.
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={isMobile ? "bottom" : "left"}
        dir="rtl"
        className={isMobile ? "max-h-[88vh] gap-0 rounded-t-2xl p-0" : "w-full gap-0 p-0 sm:max-w-md"}
      >
        {open && <FilterForm initial={initial} facets={facets} onApply={onApply} />}
      </SheetContent>
    </Sheet>
  )
}

function FilterForm({ initial, facets, onApply }: { initial: FilterDraft; facets: SearchFacets; onApply: (draft: FilterDraft) => void }) {
  const { currency, format } = useCurrency()
  const [draft, setDraft] = useState<FilterDraft>(initial)
  const patch = (p: Partial<FilterDraft>) => setDraft((d) => ({ ...d, ...p }))

  const { min: priceMin, max: priceMax } = facets.price
  const hasPriceRange = priceMax > priceMin
  const step = priceStep(priceMin, priceMax)
  const [range, setRange] = useState<[number, number]>([
    Math.min(Math.max(initial.minPrice ?? priceMin, priceMin), priceMax),
    Math.min(Math.max(initial.maxPrice ?? priceMax, priceMin), priceMax),
  ])

  const categorySlugs = useMemo(() => facets.categories.map((c) => c.slug), [facets.categories])
  const colorKeys = useMemo(() => facets.colors.map((c) => c.key), [facets.colors])
  const sizeKeys = useMemo(() => facets.sizes.map((s) => s.size), [facets.sizes])

  const reset = () => {
    setDraft(EMPTY_DRAFT)
    setRange([priceMin, priceMax])
  }

  const apply = () => {
    // المدى الكامل = بلا فلتر سعر.
    const minPrice = range[0] > priceMin ? range[0] : undefined
    const maxPrice = range[1] < priceMax ? range[1] : undefined
    onApply({ ...draft, minPrice, maxPrice })
  }

  return (
    <>
      <SheetHeader className="border-b p-4 pr-14 text-right">
        <SheetTitle>الفلتر</SheetTitle>
        <SheetDescription className="sr-only">اختر الأقسام والسعر والألوان والمقاسات وطريقة الترتيب ثم اضغط موافق.</SheetDescription>
      </SheetHeader>

      <div className="flex-1 space-y-6 overflow-y-auto p-4 text-sm">
        <Section title="الأقسام">
          <SelectAllRow checked={!draft.categories?.length} onChange={() => patch({ categories: undefined })} />
          <div className="mt-1 grid grid-cols-1 gap-0.5 sm:grid-cols-2">
            {facets.categories.map((c) => {
              const checked = !draft.categories?.length || draft.categories.includes(c.slug)
              return (
                <label key={c.slug} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-2 hover:bg-muted">
                  <Checkbox checked={checked} onCheckedChange={() => patch({ categories: toggleMulti(draft.categories, categorySlugs, c.slug) })} />
                  <span className="flex-1">{c.name}</span>
                  <span className="text-xs text-muted-foreground">{c.count}</span>
                </label>
              )
            })}
          </div>
        </Section>

        {hasPriceRange && (
          <Section title={`السعر (${currency.symbol})`}>
            <div className="px-2 pt-2">
              <Slider
                dir="rtl"
                min={priceMin}
                max={priceMax}
                step={step}
                value={range}
                onValueChange={(v) => setRange([v[0], v[1]])}
                aria-label="نطاق السعر"
              />
              <div className="mt-3 flex items-center justify-between text-xs font-medium">
                <span className="rounded-lg bg-muted px-2 py-1">{format(range[0])}</span>
                <span className="text-muted-foreground">إلى</span>
                <span className="rounded-lg bg-muted px-2 py-1">{format(range[1])}</span>
              </div>
            </div>
          </Section>
        )}

        {facets.colors.length > 0 && (
          <Section title="الألوان">
            <SelectAllRow checked={!draft.colors?.length} onChange={() => patch({ colors: undefined })} />
            <div className="mt-2 flex flex-wrap gap-2">
              {facets.colors.slice(0, 30).map((c) => {
                const active = !draft.colors?.length || draft.colors.includes(c.key)
                return (
                  <button
                    key={c.key}
                    type="button"
                    aria-pressed={active}
                    onClick={() => patch({ colors: toggleMulti(draft.colors, colorKeys, c.key) })}
                    className={`flex min-h-11 items-center gap-2 rounded-full border px-3 text-xs font-medium transition ${
                      active ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"
                    }`}
                  >
                    <span className="h-5 w-5 shrink-0 rounded-full border border-border" style={{ backgroundColor: c.hex }} aria-hidden="true" />
                    {c.label}
                    {active && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
                  </button>
                )
              })}
            </div>
          </Section>
        )}

        {facets.sizes.length > 0 && (
          <Section title="المقاسات">
            <SelectAllRow checked={!draft.sizes?.length} onChange={() => patch({ sizes: undefined })} />
            <div className="mt-2 flex flex-wrap gap-2">
              {facets.sizes.map((s) => {
                const active = !draft.sizes?.length || draft.sizes.includes(s.size)
                return (
                  <button
                    key={s.size}
                    type="button"
                    aria-pressed={active}
                    onClick={() => patch({ sizes: toggleMulti(draft.sizes, sizeKeys, s.size) })}
                    className={`min-h-11 min-w-12 rounded-lg border px-3 text-sm font-medium transition ${
                      active ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground"
                    }`}
                  >
                    {s.size}
                  </button>
                )
              })}
            </div>
          </Section>
        )}

        <Section title="الترتيب">
          <RadioGroup value={draft.sort ?? "relevance"} onValueChange={(v) => patch({ sort: v === "relevance" ? undefined : (v as SearchSort) })} className="gap-0.5">
            {SORT_OPTIONS.map((o) => (
              <label key={o.value} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-2 hover:bg-muted">
                <RadioGroupItem value={o.value} />
                <span>{o.label}</span>
              </label>
            ))}
          </RadioGroup>
        </Section>

        <Section title="خيارات أخرى">
            {facets.brands.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2">
                {facets.brands.map((b) => {
                  const active = draft.brand === b.slug
                  return (
                    <button
                      key={b.slug}
                      type="button"
                      aria-pressed={active}
                      onClick={() => patch({ brand: active ? undefined : b.slug })}
                      className={`min-h-11 rounded-full border px-4 text-xs font-medium transition ${
                        active ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"
                      }`}
                    >
                      {b.name}
                    </button>
                  )
                })}
              </div>
            )}
            <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-2 hover:bg-muted">
              <Checkbox checked={Boolean(draft.inStock)} onCheckedChange={(v) => patch({ inStock: v === true ? true : undefined })} />
              <span>المتوفر فقط</span>
            </label>
        </Section>
      </div>

      <SheetFooter className="flex-row gap-2 border-t p-4">
        <Button type="button" variant="outline" className="h-11 flex-1" onClick={reset}>
          استعادة الافتراضي
        </Button>
        <Button type="button" className="h-11 flex-1" onClick={apply}>
          موافق
        </Button>
      </SheetFooter>
    </>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset>
      <legend className="mb-2 text-base font-bold">{title}</legend>
      {children}
    </fieldset>
  )
}

function SelectAllRow({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg bg-muted/60 px-2 font-medium">
      <Checkbox checked={checked} onCheckedChange={onChange} />
      <span>تحديد الكل</span>
    </label>
  )
}
