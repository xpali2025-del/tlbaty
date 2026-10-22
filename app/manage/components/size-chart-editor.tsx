"use client"

import { Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { SIZE_CHART_LIMITS, type SizeChart } from "@/lib/size-chart"

// محرر جدول المقاسات: أعمدة (قياسات الجسم) وصفوف (المقاسات) وأمام كل مقاس مدى من–إلى بالسنتيمتر.
// نفس المحرر لجدول مشترك ولجدول خاص بمنتج واحد.

export function emptyChart(): SizeChart {
  return {
    name: "",
    columns: [{ key: "chest", label: "الصدر" }],
    rows: [{ size: "S", ranges: { chest: [0, 0] } }],
  }
}

const num = (v: string) => (v === "" ? 0 : Number(v))

export function SizeChartEditor({ value, onChange, showName = true }: { value: SizeChart; onChange: (next: SizeChart) => void; showName?: boolean }) {
  const { columns, rows } = value

  const addColumn = () => {
    if (columns.length >= SIZE_CHART_LIMITS.columns) return
    const key = `c${Date.now().toString(36)}`
    onChange({ ...value, columns: [...columns, { key, label: "" }], rows: rows.map((r) => ({ ...r, ranges: { ...r.ranges, [key]: [0, 0] } })) })
  }
  const removeColumn = (key: string) => {
    if (columns.length <= 1) return
    onChange({ ...value, columns: columns.filter((c) => c.key !== key), rows: rows.map((r) => ({ ...r, ranges: Object.fromEntries(Object.entries(r.ranges).filter(([k]) => k !== key)) })) })
  }
  const addRow = () => {
    if (rows.length >= SIZE_CHART_LIMITS.rows) return
    onChange({ ...value, rows: [...rows, { size: "", ranges: Object.fromEntries(columns.map((c) => [c.key, [0, 0] as [number, number]])) }] })
  }
  const setRange = (rowIndex: number, key: string, end: 0 | 1, v: string) =>
    onChange({
      ...value,
      rows: rows.map((r, i) => {
        if (i !== rowIndex) return r
        const cur = r.ranges[key] ?? [0, 0]
        const next: [number, number] = end === 0 ? [num(v), cur[1]] : [cur[0], num(v)]
        return { ...r, ranges: { ...r.ranges, [key]: next } }
      }),
    })

  return (
    <div className="flex flex-col gap-3">
      {showName ? (
        <div className="space-y-1.5">
          <Label htmlFor="chart-name">اسم الجدول</Label>
          <Input id="chart-name" value={value.name} maxLength={SIZE_CHART_LIMITS.nameMax} onChange={(e) => onChange({ ...value, name: e.target.value })} placeholder="مثل: ملابس نسائية" />
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[480px] text-sm">
          <thead className="bg-muted/50 text-xs">
            <tr>
              <th className="p-2 text-start font-medium">المقاس</th>
              {columns.map((c) => (
                <th key={c.key} className="p-2 text-start font-medium">
                  <div className="flex items-center gap-1">
                    <Input
                      value={c.label}
                      maxLength={SIZE_CHART_LIMITS.labelMax}
                      onChange={(e) => onChange({ ...value, columns: columns.map((x) => (x.key === c.key ? { ...x, label: e.target.value } : x)) })}
                      placeholder="القياس (مثل الصدر)"
                      aria-label="اسم القياس"
                      className="h-8 min-w-[110px]"
                    />
                    {columns.length > 1 ? (
                      <button type="button" onClick={() => removeColumn(c.key)} aria-label={`حذف القياس ${c.label}`} className="p-1 text-muted-foreground hover:text-destructive">
                        <Trash2 className="size-4" />
                      </button>
                    ) : null}
                  </div>
                  <span className="text-[11px] font-normal text-muted-foreground">من – إلى (سم)</span>
                </th>
              ))}
              <th className="w-10" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((r, i) => (
              <tr key={i}>
                <td className="p-2">
                  <Input value={r.size} maxLength={SIZE_CHART_LIMITS.sizeMax} onChange={(e) => onChange({ ...value, rows: rows.map((x, j) => (j === i ? { ...x, size: e.target.value } : x)) })} aria-label="اسم المقاس" placeholder="M" className="h-8 w-20" dir="ltr" />
                </td>
                {columns.map((c) => {
                  const [min, max] = r.ranges[c.key] ?? [0, 0]
                  return (
                    <td key={c.key} className="p-2">
                      <div className="flex items-center gap-1" dir="ltr">
                        <Input type="number" step="0.1" min={0} value={min || ""} onChange={(e) => setRange(i, c.key, 0, e.target.value)} aria-label={`${c.label} من (${r.size})`} className="h-8 w-[72px] text-center" />
                        <span className="text-muted-foreground">–</span>
                        <Input type="number" step="0.1" min={0} value={max || ""} onChange={(e) => setRange(i, c.key, 1, e.target.value)} aria-label={`${c.label} إلى (${r.size})`} className="h-8 w-[72px] text-center" />
                      </div>
                    </td>
                  )
                })}
                <td className="p-2">
                  {rows.length > 1 ? (
                    <button type="button" onClick={() => onChange({ ...value, rows: rows.filter((_, j) => j !== i) })} aria-label={`حذف المقاس ${r.size}`} className="p-1 text-muted-foreground hover:text-destructive">
                      <Trash2 className="size-4" />
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={addRow} disabled={rows.length >= SIZE_CHART_LIMITS.rows}>
          <Plus className="me-1 size-4" aria-hidden /> مقاس
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={addColumn} disabled={columns.length >= SIZE_CHART_LIMITS.columns}>
          <Plus className="me-1 size-4" aria-hidden /> قياس
        </Button>
      </div>
    </div>
  )
}
