"use client"

import { useMemo, useState } from "react"
import { Ruler } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { recommendSize, SIZE_CHART_LIMITS, type SizeChart, type SizeRecommendation } from "@/lib/size-chart"

// دليل المقاسات في صفحة المنتج: جدول القياسات (سم) + «اعرف مقاسك». لا يغيّر شيئاً في المنتج بلا إذن العميل:
// المقاس المقترح يُحدَّد فقط بنقرة «اختيار المقاس».

/** مقاس المنتج المطابق لاسم مقاس في الجدول (بلا اعتبار لحالة الأحرف)، أو undefined. */
function matchProductSize(productSizes: string[], size: string): string | undefined {
  return productSizes.find((s) => s.trim().toLowerCase() === size.trim().toLowerCase())
}

export function SizeGuide({
  chart,
  productSizes,
  selectedSize,
  isSizeAvailable,
  isSizeAvailableInOtherColor,
  onSelectSize,
}: {
  chart: SizeChart
  productSizes: string[]
  selectedSize: string
  /** هل المقاس متوفر باللون المحدد؟ */
  isSizeAvailable: (size: string) => boolean
  /** هل المقاس متوفر بلون آخر للمنتج؟ (لاقتراح تغيير اللون بدل الاكتفاء بـ«غير متوفر»). */
  isSizeAvailableInOtherColor: (size: string) => boolean
  onSelectSize: (size: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [values, setValues] = useState<Record<string, string>>({})
  const [result, setResult] = useState<SizeRecommendation | "none" | null>(null)

  // نعرض مقاسات المنتج فقط إن طابق بعضها الجدول؛ وإلا الجدول كاملاً.
  const rows = useMemo(() => {
    const offered = chart.rows.filter((r) => matchProductSize(productSizes, r.size))
    return offered.length > 0 ? offered : chart.rows
  }, [chart, productSizes])

  const parsed = chart.columns.map((c) => ({ key: c.key, n: Number(values[c.key]) }))
  const invalid = parsed.some((p, i) => values[chart.columns[i].key] && (!Number.isFinite(p.n) || p.n < SIZE_CHART_LIMITS.minCm || p.n > SIZE_CHART_LIMITS.maxCm))
  const hasInput = parsed.some((p, i) => values[chart.columns[i].key] && Number.isFinite(p.n))

  const find = () => {
    const input: Record<string, number | undefined> = {}
    for (const p of parsed) input[p.key] = Number.isFinite(p.n) && p.n > 0 ? p.n : undefined
    setResult(recommendSize({ ...chart, rows }, input) ?? "none")
  }

  const recommended = result && result !== "none" ? result : null
  const recommendedLabel = recommended ? (matchProductSize(productSizes, recommended.size) ?? recommended.size) : null
  const recommendedOffered = recommended ? !!matchProductSize(productSizes, recommended.size) : false

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button type="button" className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline">
          <Ruler className="size-4" aria-hidden="true" />
          دليل المقاسات
        </button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>دليل المقاسات</DialogTitle>
          <DialogDescription>القياسات بالسنتيمتر وهي تقريبية. إن كنتَ بين مقاسين فاختر الأكبر للراحة.</DialogDescription>
        </DialogHeader>

        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs">
              <tr>
                <th className="p-2 text-start font-medium">المقاس</th>
                {chart.columns.map((c) => (
                  <th key={c.key} className="p-2 text-start font-medium">
                    {c.label} <span className="font-normal text-muted-foreground">(سم)</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => {
                const isRecommended = recommended?.size === r.size
                const own = matchProductSize(productSizes, r.size)
                return (
                  <tr key={r.size} className={cn(isRecommended && "bg-primary/10", own && own === selectedSize && !isRecommended && "bg-muted/60")}>
                    <th scope="row" className="p-2 text-start font-bold">{r.size}</th>
                    {chart.columns.map((c) => {
                      const [min, max] = r.ranges[c.key] ?? [0, 0]
                      return (
                        <td key={c.key} className="p-2 tabular-nums" dir="ltr">
                          {min === max ? min : `${min} – ${max}`}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="space-y-3 rounded-lg border p-3">
          <h3 className="text-sm font-bold">اعرف مقاسك</h3>
          <p className="text-xs text-muted-foreground">أدخل قياساً واحداً على الأقل (كلما أدخلت أكثر كان الاقتراح أدق).</p>
          <div className="grid grid-cols-2 gap-3">
            {chart.columns.map((c) => (
              <label key={c.key} className="block text-sm">
                <span className="mb-1 block text-xs font-medium">{c.label} (سم)</span>
                <input
                  inputMode="decimal"
                  dir="ltr"
                  value={values[c.key] ?? ""}
                  onChange={(e) => {
                    setValues((v) => ({ ...v, [c.key]: e.target.value }))
                    setResult(null)
                  }}
                  className="h-11 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
                />
              </label>
            ))}
          </div>
          {invalid ? <p className="text-xs text-destructive" role="alert">أدخل قياساً بين {SIZE_CHART_LIMITS.minCm} و{SIZE_CHART_LIMITS.maxCm} سم.</p> : null}
          <Button type="button" className="min-h-11 w-full" disabled={!hasInput || invalid} onClick={find}>
            اعرف مقاسي
          </Button>

          {result === "none" ? <p className="text-sm text-muted-foreground" role="status">لم نتمكن من اقتراح مقاس، تحقق من القياسات.</p> : null}
          {recommended && recommendedLabel ? (
            <div className="space-y-2 rounded-lg bg-primary/5 p-3" role="status">
              <p className="text-sm">
                المقاس المقترح: <span className="text-lg font-bold text-primary">{recommendedLabel}</span>
              </p>
              {!recommended.exact ? <p className="text-xs text-muted-foreground">قياساتك خارج مدى المقاسات قليلاً؛ هذا أقرب مقاس.</p> : null}
              {recommended.alternate ? <p className="text-xs text-muted-foreground">أنت بين مقاسين، والبديل القريب: {recommended.alternate}. اختر الأكبر للراحة.</p> : null}
              {recommendedOffered ? (
                isSizeAvailable(recommendedLabel) ? (
                  <Button
                    type="button"
                    className="min-h-11 w-full"
                    onClick={() => {
                      onSelectSize(recommendedLabel)
                      setOpen(false)
                    }}
                  >
                    اختيار المقاس {recommendedLabel}
                  </Button>
                ) : (
                  <p className="text-xs font-medium text-destructive">
                    المقاس {recommendedLabel} غير متوفر بهذا اللون{isSizeAvailableInOtherColor(recommendedLabel) ? "، لكنه متوفر بألوان أخرى: غيّر اللون ثم اختر المقاس." : " حالياً."}
                  </p>
                )
              ) : (
                <p className="text-xs font-medium text-destructive">المقاس {recommended.size} غير متاح لهذا المنتج.</p>
              )}
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
