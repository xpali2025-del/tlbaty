import type { Metadata } from "next"
import { Header } from "@/components/header"
import { Footer } from "@/components/footer"
import { MobileNav } from "@/components/mobile-nav"
import { SearchClient } from "@/components/search-client"
import { getBrands } from "@/lib/data"
import { searchProducts, getSearchFacets } from "@/lib/search"
import { parseSearchParams } from "@/lib/search-params"
import { getSiteConfig } from "@/lib/site-config"

export async function generateMetadata(): Promise<Metadata> {
  const site = await getSiteConfig()
  return {
    title: "البحث",
    description: `ابحث عن المنتجات في متجر ${site.name} بالاسم أو رمز المنتج أو اللون أو الصورة.`,
    robots: { index: false, follow: true },
  }
}

// الصفحة ديناميكية: النتائج تُحسب على الخادم من معاملات الرابط (نص، قسم، لون، سعر…)،
// فلا يُحمَّل كتالوج المتجر كله إلى المتصفح، والرابط قابل للمشاركة.
export default async function SearchPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = parseSearchParams(await searchParams)
  const [result, facets, brands] = await Promise.all([searchProducts(params), getSearchFacets(), getBrands()])

  return (
    <>
      <Header />
      <main className="pb-24 lg:pb-12">
        <SearchClient params={params} result={result} facets={facets} brands={brands} />
      </main>
      <Footer />
      <MobileNav />
    </>
  )
}
