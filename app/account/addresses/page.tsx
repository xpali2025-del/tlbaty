import Link from "next/link"
import { redirect } from "next/navigation"
import { ArrowRight } from "lucide-react"
import { Header } from "@/components/header"
import { MobileNav } from "@/components/mobile-nav"
import { AddressesManager } from "@/components/account/addresses-manager"
import { getCurrentCustomer } from "@/lib/otp/session"

export const dynamic = "force-dynamic"

export const metadata = {
  title: "عناويني | Tajline",
  description: "عناوينك المحفوظة (المنزل، العمل...) لاختيارها بنقرة عند إتمام الطلب.",
  robots: { index: false, follow: false },
}

export default async function AddressesPage() {
  const customer = await getCurrentCustomer()
  if (!customer) redirect("/login?next=/account/addresses")

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="mx-auto w-full max-w-2xl px-4 py-8 pb-28">
        <Link href="/account" className="mb-4 inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
          الإعدادات
        </Link>
        <h1 className="mb-1 text-2xl font-bold tracking-tight">عناويني</h1>
        <p className="mb-6 text-sm text-muted-foreground">احفظ عدة عناوين، واختر أحدها بنقرة عند إتمام الطلب.</p>
        <AddressesManager />
      </main>
      <MobileNav />
    </div>
  )
}
