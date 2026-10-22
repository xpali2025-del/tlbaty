import { Header } from "@/components/header"
import { MobileNav } from "@/components/mobile-nav"

// هيكل انتظار فوري أثناء تحميل الصفحات الديناميكية (البحث، الطلبات، الحساب، الدفع): الترويسة تبقى ظاهرة
// ويرى العميل استجابة لنقرته فوراً بدل شاشة جامدة حتى يصل رد الخادم.
export default function Loading() {
  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-7xl px-4 py-6 pb-24 lg:pb-12" aria-busy="true" aria-live="polite">
        <span className="sr-only">جاري التحميل…</span>
        <div className="mb-6 h-7 w-40 animate-pulse rounded-lg bg-muted" />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-5 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="overflow-hidden rounded-2xl border border-border bg-card">
              <div className="aspect-square animate-pulse bg-muted" />
              <div className="space-y-2 p-3">
                <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
                <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
              </div>
            </div>
          ))}
        </div>
      </main>
      <MobileNav />
    </>
  )
}
