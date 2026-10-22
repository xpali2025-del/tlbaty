import Link from "next/link"
import { SearchX } from "lucide-react"
import { Header } from "@/components/header"
import { Footer } from "@/components/footer"
import { MobileNav } from "@/components/mobile-nav"

export const metadata = { title: "الصفحة غير موجودة" }

export default function NotFound() {
  return (
    <>
      <Header />
      <main className="mx-auto flex min-h-[55vh] max-w-md flex-col items-center justify-center gap-3 px-4 py-16 text-center pb-24 lg:pb-16">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
          <SearchX className="h-7 w-7 text-muted-foreground" aria-hidden="true" />
        </span>
        <h1 className="text-xl font-bold">الصفحة غير موجودة</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">ربما حُذف المنتج أو تغيّر الرابط. تصفّح المنتجات أو ابحث عمّا تريد.</p>
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          <Link href="/categories" className="flex min-h-11 items-center rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground">
            تصفح المنتجات
          </Link>
          <Link href="/" className="flex min-h-11 items-center rounded-xl border border-border px-4 text-sm font-bold">
            الرئيسية
          </Link>
        </div>
      </main>
      <Footer />
      <MobileNav />
    </>
  )
}
