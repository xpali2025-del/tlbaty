"use client"

import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import type { AdminColor } from "@/lib/admin"

// مخزون كل لون ومقاس: شبكة (لون × مقاس) لكل خانة كمية. المنتج بلا ألوان أو بلا مقاسات يظهر صفاً/عموداً واحداً.
// المفتاح لون + محرف فاصل + مقاس، و'' لبُعد غير مستعمل (مطابق لجدول product_variants).

export const variantKey = (color: string, size: string) => `${color}\u0000${size}`

export function variantCombos(colors: AdminColor[], sizes: string[]): { color: string; size: string }[] {
  const colorNames = colors.length ? colors.map((c) => c.name) : [""]
  const sizeNames = sizes.length ? sizes : [""]
  return colorNames.flatMap((color) => sizeNames.map((size) => ({ color, size })))
}

export function VariantStockEditor({
  colors,
  sizes,
  values,
  onChange,
}: {
  colors: AdminColor[]
  sizes: string[]
  values: Record<string, string>
  onChange: (next: Record<string, string>) => void
}) {
  const combos = variantCombos(colors, sizes)
  const total = combos.reduce((sum, c) => sum + (Math.max(0, Math.trunc(Number(values[variantKey(c.color, c.size)])) || 0)), 0)
  const hasDimensions = colors.length > 0 || sizes.length > 0

  if (!hasDimensions) {
    return <p className="text-xs text-muted-foreground">أضف ألواناً أو مقاسات أعلاه لتظهر شبكة المخزون.</p>
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        {combos.map((c) => {
          const key = variantKey(c.color, c.size)
          const label = [c.color, c.size].filter(Boolean).join(" — ")
          const hex = colors.find((x) => x.name === c.color)?.hex
          return (
            <div key={key} className="flex items-center justify-between gap-2 rounded-md bg-muted/40 px-3 py-2">
              <Label htmlFor={`variant-${key}`} className="flex min-w-0 items-center gap-2 text-sm">
                {hex ? <span className="size-3.5 shrink-0 rounded-full border" style={{ backgroundColor: hex }} aria-hidden="true" /> : null}
                <span className="truncate">{label}</span>
              </Label>
              <Input
                id={`variant-${key}`}
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                value={values[key] ?? ""}
                placeholder="0"
                onChange={(e) => onChange({ ...values, [key]: e.target.value })}
                className="h-9 w-24 text-center"
                dir="ltr"
                aria-label={`كمية ${label}`}
              />
            </div>
          )
        })}
      </div>
      <p className="text-sm font-medium">
        الإجمالي: <span className="tabular-nums">{total}</span> قطعة
        <span className="ms-2 text-xs font-normal text-muted-foreground">(يُحدَّث مخزون المنتج الإجمالي تلقائياً)</span>
      </p>
    </div>
  )
}
