import type { Metadata } from "next"
import { SearchPageView } from "@/components/search-page-view"

export const metadata: Metadata = {
  title: "كافة المنتجات",
  description:
    "تصفح كافة منتجات متجر تاج لاين مع بحث متقدم وفلترة حسب القسم والسعر واللون والمقاس والأكثر مبيعاً والعروض.",
}

// نفس صفحة البحث بتصميم واحد؛ الروابط القديمة /categories?filter=new|offers|bestsellers ما زالت تعمل (parseSearchParams).
export default async function CategoriesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <SearchPageView searchParams={await searchParams} basePath="/categories" />
}
