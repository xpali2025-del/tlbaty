"use client"

import { useRef, useState } from "react"
import { Camera, Loader2, X } from "lucide-react"
import { ProductCard } from "@/components/product-card"
import { Button } from "@/components/ui/button"
import { paletteFromFile } from "@/lib/image-palette-client"
import { buildSearchQuery, type SearchParams } from "@/lib/search-params"
import type { PaletteColor } from "@/lib/palette"
import type { Product } from "@/lib/types"

export type ImageMode = { previewUrl: string; palette: PaletteColor[]; items: (Product & { similarity: number })[]; total: number }

export function ImageSearchButton({ params, onSelect, onError }: { params: SearchParams; onSelect: (result: ImageMode) => void; onError: (error: string) => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  async function pick(file: File | undefined) {
    if (!file) return
    setBusy(true)
    onError("")
    let previewUrl: string | undefined
    try {
      const parsed = await paletteFromFile(file)
      previewUrl = parsed.previewUrl
      const filters: Record<string, string[]> = {}
      for (const [k, v] of new URLSearchParams(buildSearchQuery({ ...params, q: undefined, sort: undefined, limit: undefined }))) (filters[k] ??= []).push(v)
      const response = await fetch("/api/search/image", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ palette: parsed.palette, filters }) })
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.message ?? "تعذّر البحث بالصورة. حاول مرة أخرى.")
      const data = (await response.json()) as { items: ImageMode["items"]; total: number }
      onSelect({ previewUrl, palette: parsed.palette, items: data.items, total: data.total })
      previewUrl = undefined // ownership passed to the parent
    } catch (error) {
      onError(error instanceof Error ? error.message : "تعذّر البحث بالصورة.")
    } finally {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ""
    }
  }
  return <>
    <input ref={fileRef} type="file" accept="image/*" className="sr-only" aria-label="اختيار صورة للبحث" tabIndex={-1} onChange={(e) => pick(e.target.files?.[0])} />
    <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} aria-label="البحث بالصورة" title="البحث بالصورة" className="flex h-10 w-10 items-center justify-center rounded-full text-primary hover:bg-primary/10 disabled:opacity-60">
      {busy ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : <Camera className="h-5 w-5" aria-hidden="true" />}
    </button>
  </>
}

export function ImageSearchResults({ image, onClear }: { image: ImageMode; onClear: () => void }) {
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
