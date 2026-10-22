"use server"

import { eq, sql } from "drizzle-orm"
import { assertManagePermission } from "@/lib/manage-auth"
import { db } from "@/lib/db/client"
import { products, sizeCharts } from "@/lib/db/store"
import { revalidateStore } from "@/lib/manage-helpers"
import { uuidParam } from "@/lib/manage-helpers"
import { COMMON_SIZE_CHARTS, parseSizeChart, validateSizeChart, type SizeChart } from "@/lib/size-chart"

export type SizeChartResult = { ok: true; message: string } | { ok: false; error: string }

/** يحفظ جدول مقاسات (جديد أو تعديل). التحقق كله على الخادم. */
export async function saveSizeChart(id: string | null, input: SizeChart): Promise<SizeChartResult> {
  try {
    await assertManagePermission("size-charts")
    const chart = parseSizeChart(input)
    if (!chart) return { ok: false, error: "بيانات الجدول غير صالحة" }
    const problem = validateSizeChart(chart)
    if (problem) return { ok: false, error: problem }
    const values = { name: chart.name, columns: chart.columns, rows: chart.rows, updatedAt: new Date() }
    if (id) {
      const updated = await db.update(sizeCharts).set(values).where(eq(sizeCharts.id, uuidParam(id))).returning({ id: sizeCharts.id })
      if (updated.length === 0) return { ok: false, error: "الجدول غير موجود" }
    } else {
      await db.insert(sizeCharts).values(values)
    }
    revalidateStore()
    return { ok: true, message: "تم حفظ جدول المقاسات" }
  } catch (error) {
    const text = error instanceof Error ? `${error.message} ${(error as { cause?: Error }).cause?.message ?? ""}` : ""
    if (/size_charts_name_lower_idx|unique|duplicate/i.test(text)) return { ok: false, error: "يوجد جدول بهذا الاسم" }
    console.error("saveSizeChart failed:", error instanceof Error ? error.message : "unknown")
    return { ok: false, error: "تعذّر الحفظ" }
  }
}

/** يحذف جدولاً. المنتجات التي تستعمله تعود بلا دليل مقاسات (لا تُحذف ولا تتعطل). */
export async function deleteSizeChart(id: string): Promise<SizeChartResult> {
  try {
    await assertManagePermission("size-charts")
    await db.delete(sizeCharts).where(eq(sizeCharts.id, uuidParam(id)))
    revalidateStore()
    return { ok: true, message: "تم حذف الجدول" }
  } catch {
    return { ok: false, error: "تعذّر الحذف" }
  }
}

/** يضيف الجداول الشائعة غير الموجودة (بالاسم)، ولا يمسّ جدولاً عدّلته. */
export async function seedCommonSizeCharts(): Promise<SizeChartResult> {
  try {
    await assertManagePermission("size-charts")
    const inserted = await db
      .insert(sizeCharts)
      .values(COMMON_SIZE_CHARTS.map((c, i) => ({ name: c.name, columns: c.columns, rows: c.rows, sortOrder: i })))
      .onConflictDoNothing()
      .returning({ id: sizeCharts.id })
    revalidateStore()
    return { ok: true, message: inserted.length ? `أُضيف ${inserted.length} جدول شائع` : "الجداول الشائعة موجودة بالفعل" }
  } catch {
    return { ok: false, error: "تعذّر إضافة الجداول" }
  }
}

/** عدد المنتجات التي تستعمل جدولاً (للتنبيه قبل الحذف). */
export async function countProductsUsingChart(id: string): Promise<number> {
  await assertManagePermission("size-charts")
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(products).where(eq(products.sizeChartId, uuidParam(id)))
  return row.n
}
