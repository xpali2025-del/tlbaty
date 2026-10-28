"use client"

import { useMemo, useState, useTransition } from "react"
import { Coins, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { AdminCurrency } from "@/lib/admin"
import { BASE_CURRENCY_CODE, DEFAULT_CURRENCIES, convertPrice } from "@/lib/currency"
import { saveCurrencies } from "../client-actions"
import { SectionHeader } from "./shared"

// إدارة العملات وأسعار الصرف والعملة الافتراضية للمتجر.
//
// أسعار المنتجات مخزَّنة دائماً بالريال اليمني القديم (YER)؛ سعر صرف أي عملة = كم ريالاً قديماً يساوي 1 منها.
// المعروض للعميل = السعر الأساسي ÷ سعر الصرف. تغيير الأسعار لا يمسّ الطلبات السابقة (تحفظ عملتها وقت الطلب).

type Row = { code: string; name: string; symbol: string; rate: string; updatedAt?: string }

const STALE_DAYS = 30

/** عملات شائعة بسعر تقريبي مقترح — يراجعه المدير قبل الحفظ لأن أسعار الصرف تتغير. */
const SUGGESTIONS: { code: string; name: string; symbol: string; rate: number }[] = [
  { code: "SAR", name: "ريال سعودي", symbol: "ر.س", rate: 140 },
  { code: "USD", name: "دولار أمريكي", symbol: "$", rate: 535 },
  { code: "YER_NEW", name: "ريال يمني (جديد)", symbol: "ر.ي.ج", rate: Number((1 / 2.8).toFixed(6)) },
  { code: "AED", name: "درهم إماراتي", symbol: "د.إ", rate: 146 },
]

const toRow = (c: AdminCurrency): Row => ({ code: c.code, name: c.name, symbol: c.symbol, rate: String(c.rate), updatedAt: c.updatedAt })
const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 })
const daysSince = (iso?: string) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000) : null)

export function CurrenciesManager({ currencies, defaultCurrency }: { currencies: AdminCurrency[]; defaultCurrency: string }) {
  // لا عملات محفوظة بعد: نعرض ما يستخدمه المتجر فعلاً الآن (القيم الافتراضية) ليحفظها المدير أو يعدّلها.
  const savedBefore = currencies.length > 0
  const initial = useMemo<Row[]>(
    () => (savedBefore ? currencies.map(toRow) : DEFAULT_CURRENCIES.map((c) => ({ code: c.code, name: c.name, symbol: c.symbol, rate: String(c.rate) }))),
    [currencies, savedBefore],
  )
  const initialDefault = savedBefore ? defaultCurrency : "YER"
  const [rows, setRows] = useState<Row[]>(initial)
  const [def, setDef] = useState(initialDefault)
  const [sample, setSample] = useState("10000")
  const [isPending, startTransition] = useTransition()

  const patch = (i: number, p: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)))
  const dirty = !savedBefore || def !== initialDefault || JSON.stringify(rows.map(({ updatedAt: _u, ...r }) => r)) !== JSON.stringify(initial.map(({ updatedAt: _u, ...r }) => r))

  const problems = useMemo(() => {
    const out = new Map<number, string>()
    const seen = new Set<string>()
    rows.forEach((r, i) => {
      const code = r.code.trim().toUpperCase()
      if (!/^[A-Z][A-Z0-9_]{1,11}$/.test(code)) out.set(i, "رمز العملة: حروف إنجليزية كبيرة وأرقام (2 إلى 12)")
      else if (seen.has(code)) out.set(i, "رمز مكرر")
      else if (!r.name.trim() || !r.symbol.trim()) out.set(i, "الاسم والرمز المعروض مطلوبان")
      else if (!(Number(r.rate) > 0)) out.set(i, "سعر الصرف يجب أن يكون أكبر من صفر")
      seen.add(code)
    })
    return out
  }, [rows])

  function save() {
    if (problems.size > 0) {
      toast.error([...problems.values()][0])
      return
    }
    startTransition(async () => {
      try {
        await saveCurrencies(
          rows.map((r) => ({ code: r.code.trim().toUpperCase(), name: r.name.trim(), symbol: r.symbol.trim(), rate: Number(r.rate) })),
          def,
        )
        toast.success("تم حفظ العملات وأسعار الصرف")
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "تعذّر الحفظ")
      }
    })
  }

  const sampleNumber = Math.max(0, Number(sample) || 0)
  const available = SUGGESTIONS.filter((s) => !rows.some((r) => r.code.trim().toUpperCase() === s.code))
  const defRow = rows.find((r) => r.code === def)

  return (
    <div>
      <SectionHeader
        title="العملات وأسعار الصرف"
        description="حدّد العملات التي يعرض بها المتجر أسعاره، وسعر صرف كل عملة، والعملة الافتراضية التي يراها الزائر أول مرة."
      />

      <Card className="mb-4 flex gap-3 border-primary/20 bg-primary/5 p-4 text-sm leading-relaxed">
        <Coins className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
        <div>
          <p>
            أسعار المنتجات مخزَّنة بالعملة الأساسية <b>الريال اليمني القديم ({BASE_CURRENCY_CODE})</b>، وسعر صرفها ثابت 1.
          </p>
          <p className="mt-1 text-muted-foreground">
            سعر صرف أي عملة = كم ريالاً يمنياً قديماً يساوي <b>1</b> منها. السعر المعروض = السعر الأساسي ÷ سعر الصرف. مثلاً الريال السعودي = 140 يعني أن منتجاً بـ 14,000 ر.ي يظهر 100 ر.س. تغيير الأسعار لا يغيّر الطلبات السابقة.
          </p>
        </div>
      </Card>

      <Card className="mb-4 flex flex-wrap items-center gap-3 p-4">
        <div className="min-w-48 flex-1">
          <Label htmlFor="default-currency" className="font-bold">
            العملة الافتراضية للمتجر
          </Label>
          <p className="mt-0.5 text-xs text-muted-foreground">يراها الزائر قبل أن يختار عملة أخرى من أعلى الموقع، ثم تُحفظ اختياراته.</p>
        </div>
        <select
          id="default-currency"
          value={def}
          onChange={(e) => setDef(e.target.value)}
          className="h-10 min-w-56 rounded-md border bg-background px-3 text-sm"
        >
          {rows.map((r) => (
            <option key={r.code} value={r.code}>
              {r.name || r.code} ({r.code})
            </option>
          ))}
        </select>
      </Card>

      <div className="mb-2 hidden grid-cols-[6rem_1fr_6.5rem_8rem_7rem_2.5rem] gap-2 px-3 text-xs font-medium text-muted-foreground md:grid">
        <span>الرمز</span>
        <span>اسم العملة</span>
        <span>الرمز المعروض</span>
        <span>سعر الصرف</span>
        <span>آخر تحديث</span>
        <span />
      </div>
      <div className="flex flex-col gap-2">
        {rows.map((r, i) => {
          const isBase = r.code === BASE_CURRENCY_CODE
          const age = daysSince(r.updatedAt)
          const stale = !isBase && age !== null && age >= STALE_DAYS
          const problem = problems.get(i)
          return (
            <Card key={i} className={`p-3 ${problem ? "border-destructive/50" : ""}`}>
              <div className="grid items-center gap-2 md:grid-cols-[6rem_1fr_6.5rem_8rem_7rem_2.5rem]">
                <Input aria-label="رمز العملة" placeholder="SAR" dir="ltr" value={r.code} disabled={isBase} onChange={(e) => patch(i, { code: e.target.value.toUpperCase() })} />
                <Input aria-label="اسم العملة" placeholder="ريال سعودي" value={r.name} onChange={(e) => patch(i, { name: e.target.value })} />
                <Input aria-label="الرمز المعروض" placeholder="ر.س" value={r.symbol} onChange={(e) => patch(i, { symbol: e.target.value })} />
                <Input aria-label="سعر الصرف" type="number" step="any" min={0} dir="ltr" value={r.rate} disabled={isBase} onChange={(e) => patch(i, { rate: e.target.value })} />
                <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                  {isBase ? (
                    <Badge variant="secondary">الأساسية</Badge>
                  ) : age === null ? (
                    <span>غير محفوظة</span>
                  ) : (
                    <>
                      <span>{age === 0 ? "اليوم" : `منذ ${age} يوم`}</span>
                      {stale && <Badge variant="outline" className="border-amber-500/50 text-amber-700">راجع السعر</Badge>}
                    </>
                  )}
                  {r.code === def && <Badge>افتراضية</Badge>}
                </div>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  disabled={isBase || r.code === def}
                  title={isBase ? "العملة الأساسية لا تُحذف" : r.code === def ? "غيّر العملة الافتراضية أولاً" : "حذف العملة"}
                  onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                  aria-label={`حذف ${r.name || r.code}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              {problem && <p className="mt-2 text-xs text-destructive">{problem}</p>}
            </Card>
          )
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" className="gap-1" onClick={() => setRows((rs) => [...rs, { code: "", name: "", symbol: "", rate: "1" }])}>
          <Plus className="h-4 w-4" /> عملة جديدة
        </Button>
        {available.map((s) => (
          <Button
            key={s.code}
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setRows((rs) => [...rs, { code: s.code, name: s.name, symbol: s.symbol, rate: String(s.rate) }])}
            title="يُضاف بسعر تقريبي؛ عدّله إلى سعر السوق قبل الحفظ"
          >
            + {s.name} ({s.rate})
          </Button>
        ))}
      </div>

      <Card className="mt-6 p-4">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <h2 className="font-bold">معاينة الأسعار</h2>
          <div className="flex items-center gap-2 text-sm">
            <Label htmlFor="sample">سعر منتج بالريال القديم</Label>
            <Input id="sample" type="number" min={0} dir="ltr" className="h-9 w-32" value={sample} onChange={(e) => setSample(e.target.value)} />
          </div>
        </div>
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {rows
            .filter((r) => Number(r.rate) > 0 && r.symbol.trim())
            .map((r) => (
              <li key={r.code + r.symbol} className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-2 text-sm">
                <span className="text-muted-foreground">{r.name || r.code}</span>
                <b dir="ltr">
                  {fmt(convertPrice(sampleNumber, { code: r.code, name: r.name, symbol: r.symbol, rate: Number(r.rate) }))} {r.symbol}
                </b>
              </li>
            ))}
        </ul>
      </Card>

      <div className="sticky bottom-0 mt-6 flex flex-wrap items-center justify-between gap-3 border-t bg-background/95 py-3 backdrop-blur">
        <p className="text-sm text-muted-foreground">
          {dirty ? (
            <span className="text-amber-700">{savedBefore ? "لديك تغييرات غير محفوظة." : "هذه القيم الافتراضية المستخدمة الآن؛ احفظها لتصبح من إعداداتك."}</span>
          ) : (
            <>العملة الافتراضية الحالية: <b>{defRow?.name || def}</b></>
          )}
        </p>
        <Button type="button" onClick={save} disabled={isPending || (!dirty && savedBefore)}>
          {isPending ? "جارٍ الحفظ..." : "حفظ العملات"}
        </Button>
      </div>
    </div>
  )
}
