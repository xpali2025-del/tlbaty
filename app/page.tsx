import { Fragment } from "react"
import { HeroSlider } from "@/components/hero-slider"
import { CategoryCircles } from "@/components/category-circles"
import { ProductSection } from "@/components/product-section"
import { BrandSection } from "@/components/brand-section"
import { CustomerReviews } from "@/components/customer-reviews"
import { CategoryList } from "@/components/category-list"
import { AdBanner } from "@/components/ad-banner"
import { Header } from "@/components/header"
import { Footer } from "@/components/footer"
import { MobileNav } from "@/components/mobile-nav"
import {
  getSlides,
  getCategories,
  getBrands,
  getBestsellers,
  getNewArrivals,
  getOfferProducts,
  getProducts,
  getReviews,
  getAds,
} from "@/lib/data"

// On-Demand Revalidation: الصفحة ثابتة (Static) وتُحدَّث فوراً
// عبر إجراءات لوحة الإدارة (revalidateStore في lib/manage-helpers.ts)
// دون أي انتظار زمني — سرعة تعادل الملفات المحلية

export default async function HomePage() {
  // جلب كل البيانات بالتوازي مرة واحدة لكل الصفحة
  const [slides, categories, brands, bestsellers, newArrivals, offers, allProducts, reviews, ads] =
    await Promise.all([
      getSlides(),
      getCategories(),
      getBrands(),
      getBestsellers(),
      getNewArrivals(),
      getOfferProducts(),
      getProducts(),
      getReviews(),
      getAds(),
    ])

  // الإعلانات (مفلترة ومرتبة مسبقاً من getAds) نعرضها بالتناوب في مواضع مختلفة من الصفحة
  const homeAds = ads
  let adCursor = 0
  const renderAd = () => {
    if (homeAds.length === 0) return null
    const ad = homeAds[adCursor % homeAds.length]
    adCursor += 1
    return (
      <section className="mx-auto max-w-7xl px-4 py-4" aria-label={ad.title}>
        <AdBanner ad={ad} />
      </section>
    )
  }

  return (
    <>
      <Header />
      <main className="pb-24 lg:pb-0">
        {/* 1. السلايدر - صور فقط */}
        <HeroSlider slides={slides} />

        {/* 2. الأقسام الرئيسية - 5 أقسام مع سحب أفقي */}
        <CategoryCircles categories={categories.slice(0, 5)} />

        {/* 3. الماركات */}
        <BrandSection title="تسوّق حسب الماركة" brands={brands} limit={4} viewAllHref="/brands" />

        {/* 4. المضاف حديثاً */}
        <ProductSection
          title="المضاف حديثاً"
          products={newArrivals.length ? newArrivals : allProducts.slice(0, 6)}
          limit={6}
          viewAllHref="/categories?filter=new"
        />

        {/* إعلان بعد المضاف حديثاً */}
        {renderAd()}

        {/* 5. الأكثر مبيعاً */}
        <ProductSection
          title="الأكثر مبيعاً"
          products={bestsellers.length ? bestsellers : allProducts.slice(0, 6)}
          limit={6}
          viewAllHref="/categories?filter=bestsellers"
        />

        {/* إعلان بعد الأكثر مبيعاً */}
        {renderAd()}

        {/* 6. العروض — 6 منتجات عليها خصم */}
        {offers.length > 0 && (
          <ProductSection
            title="العروض"
            products={offers.slice(0, 6)}
            limit={6}
            viewAllHref="/categories?filter=offers"
          />
        )}

        {/* إعلان بعد العروض */}
        {renderAd()}

        {/* 7. قسم لكل تصنيف — 6 منتجات من كل قسم (بدون استعلام إضافي من قاعدة البيانات) */}
        {/* نقتطع لأول 6 منتجات فقط قبل التمرير لتقليل حجم بيانات الصفحة */}
        {categories.map((category, index) => {
          const categoryProducts = allProducts
            .filter((p) => p.category === category.slug)
            .slice(0, 6)
          if (categoryProducts.length === 0) return null
          return (
            <Fragment key={category.id}>
              <ProductSection
                title={category.name}
                products={categoryProducts}
                limit={6}
                viewAllHref={`/category/${category.slug}`}
              />
              {/* إعلان يظهر بالتناوب بين أقسام المنتجات */}
              {index % 2 === 1 && renderAd()}
            </Fragment>
          )
        })}

        {/* 8. آراء العملاء */}
        <CustomerReviews reviews={reviews} />

        {/* 9. الأقسام */}
        <CategoryList categories={categories} />
      </main>

      {/* 10. الفوتر */}
      <Footer />
      <MobileNav />
    </>
  )
}
