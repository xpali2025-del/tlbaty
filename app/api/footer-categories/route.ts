import { NextResponse } from "next/server"
import { getFooterCategories } from "@/lib/data"

// ============================================
// مصدر أقسام الفوتر للمكوّنات على جهة العميل
// (صفحات السلة/التواصل/الدفع "use client")
// getFooterCategories يعتمد على وسم قائمة الأقسام، لذلك يتحدث عند تعديل
// قسم أو عند تغير عدد المنتجات نتيجة إضافة/حذف/نقل منتج.
// ============================================

export async function GET() {
  const categories = await getFooterCategories()
  return NextResponse.json({ categories })
}
