import { Header } from "@/components/header"
import { Footer } from "@/components/footer"
import { MobileNav } from "@/components/mobile-nav"
import { SearchClient } from "@/components/search-client"
import { getAds, getBrands } from "@/lib/data"
import { getSearchFacets, searchProducts } from "@/lib/search"
import { isImageSearchEnabled } from "@/lib/site-config"
import { parseSearchParams } from "@/lib/search-params"

/**
 * صفحة المنتجات الموحّدة: /search و/categories (كافة المنتجات) تعرضان التصميم والمنطق نفسه.
 * النتائج تُحسب على الخادم من معاملات الرابط (نص، أقسام، لون، سعر…) فلا يُحمَّل الكتالوج كله إلى المتصفح،
 * والرابط قابل للمشاركة.
 */
export async function SearchPageView({
  searchParams,
  basePath,
}: {
  searchParams: Record<string, string | string[] | undefined>
  basePath: "/search" | "/categories"
}) {
  const params = parseSearchParams(searchParams)
  const [result, facets, brands, ads, imageSearchEnabled] = await Promise.all([searchProducts(params), getSearchFacets(), getBrands(), getAds(), isImageSearchEnabled()])

  return (
    <>
      <Header />
      <main className="pb-24 lg:pb-12">
        <SearchClient imageSearchEnabled={imageSearchEnabled} params={params} result={result} facets={facets} brands={brands} ads={ads} basePath={basePath} />
      </main>
      <Footer />
      <MobileNav />
    </>
  )
}
