import type { Metadata } from "next"
import { SearchPageView } from "@/components/search-page-view"
import { getSiteConfig } from "@/lib/site-config"

export async function generateMetadata(): Promise<Metadata> {
  const site = await getSiteConfig()
  return {
    title: "البحث",
    description: `ابحث عن المنتجات في متجر ${site.name} بالاسم أو رمز المنتج أو اللون أو الصورة.`,
    robots: { index: false, follow: true },
  }
}

// الصفحة ديناميكية: النتائج تُحسب على الخادم من معاملات الرابط (انظر SearchPageView).
export default async function SearchPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <SearchPageView searchParams={await searchParams} basePath="/search" />
}
