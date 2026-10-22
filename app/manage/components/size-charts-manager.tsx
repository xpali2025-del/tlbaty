"use client"

import { useState, useTransition } from "react"
import { Pencil, Plus, Ruler, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import type { AdminSizeChart } from "@/lib/admin"
import { validateSizeChart, type SizeChart } from "@/lib/size-chart"
import { deleteSizeChart, saveSizeChart, seedCommonSizeCharts } from "../size-chart-actions"
import { SizeChartEditor, emptyChart } from "./size-chart-editor"
import { SectionHeader } from "./shared"

// جداول المقاسات المشتركة: تُعرَّف مرة وتُختار لكل منتج بنقرة. القياسات بالسنتيمتر.

export function SizeChartsManager({ charts }: { charts: AdminSizeChart[] }) {
  const [editing, setEditing] = useState<{ id: string | null; chart: SizeChart } | null>(null)
  const [pending, startTransition] = useTransition()

  const run = (fn: () => Promise<{ ok: boolean } & ({ message: string } | { error: string })>, after?: () => void) =>
    startTransition(async () => {
      const r = await fn()
      if (r.ok) {
        toast.success((r as { message: string }).message)
        after?.()
      } else toast.error((r as { error: string }).error)
    })

  const problem = editing ? validateSizeChart(editing.chart) : null

  return (
    <div className="space-y-6">
      <SectionHeader title="جداول المقاسات" description="قياسات الجسم لكل مقاس (بالسنتيمتر). تعرّف الجدول مرة وتختاره لأي منتج، ويظهر للعميل مع «اعرف مقاسك»." />

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setEditing({ id: null, chart: emptyChart() })}>
          <Plus className="me-1 size-4" aria-hidden /> جدول جديد
        </Button>
        <Button variant="outline" disabled={pending} onClick={() => run(seedCommonSizeCharts)}>
          <Ruler className="me-1 size-4" aria-hidden /> إضافة الجداول الشائعة
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        الجداول الشائعة (نسائي، رجالي، أطفال، أحذية) تقديرات عامة وليست معيار مصنّع؛ راجعها وعدّل أرقامها لمقاسات متجرك قبل الاعتماد عليها. لا يُلزمك دليل المقاسات بإدخال بيانات في كل منتج.
      </p>

      {editing ? (
        <Card className="space-y-4 p-4">
          <h3 className="font-bold">{editing.id ? "تعديل الجدول" : "جدول جديد"}</h3>
          <SizeChartEditor value={editing.chart} onChange={(chart) => setEditing({ ...editing, chart })} />
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-destructive" role="status">{problem}</p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setEditing(null)}>إلغاء</Button>
              <Button disabled={pending || problem !== null} onClick={() => run(() => saveSizeChart(editing.id, editing.chart), () => setEditing(null))}>حفظ</Button>
            </div>
          </div>
        </Card>
      ) : null}

      {charts.length === 0 ? (
        <p className="text-sm text-muted-foreground">لا توجد جداول بعد. أضف الجداول الشائعة أو أنشئ جدولاً.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {charts.map((c) => (
            <li key={c._id}>
              <Card className="flex items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="truncate font-bold">{c.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {c.rows.length} مقاس · {c.columns.map((x) => x.label).join("، ")} · {c.productCount} منتج
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button variant="ghost" size="icon" aria-label={`تعديل ${c.name}`} onClick={() => setEditing({ id: c._id, chart: { name: c.name, columns: c.columns, rows: c.rows } })}>
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`حذف ${c.name}`}
                    disabled={pending}
                    onClick={() => {
                      if (window.confirm(`حذف جدول «${c.name}»؟${c.productCount ? ` ${c.productCount} منتج يستعمله سيعود بلا دليل مقاسات.` : ""}`)) run(() => deleteSizeChart(c._id))
                    }}
                  >
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
