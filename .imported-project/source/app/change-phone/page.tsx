import { redirect } from "next/navigation"
import Link from "next/link"
import { Header } from "@/components/header"
import { getCurrentCustomer } from "@/lib/otp/session"
import { ChangePhoneForm } from "@/components/auth/change-phone-form"
import { OTP_LENGTH, OTP_RESEND } from "@/lib/otp/config"
import { ArrowRight } from "lucide-react"

export const dynamic = "force-dynamic"

export const metadata = {
  title: "تغيير رقم الهاتف | Tajline",
  description: "تغيير رقم هاتف الحساب مع الاحتفاظ بنفس معرّف العميل وكل الطلبات.",
}

export default async function ChangePhonePage() {
  const customer = await getCurrentCustomer()
  if (!customer) {
    redirect("/login?next=/change-phone")
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="mx-auto w-full max-w-md px-4 py-10">
        <Link
          href="/account"
          className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          <ArrowRight className="size-4" />
          العودة إلى حسابي
        </Link>

        <div className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight text-balance">تغيير رقم الهاتف</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            رقمك الحالي: <span dir="ltr" className="font-medium">{customer.phone}</span>. سيبقى
            معرّف حسابك وجميع طلباتك كما هي.
          </p>
        </div>

        <ChangePhoneForm otpLength={OTP_LENGTH} resendSeconds={OTP_RESEND} />
      </main>
    </div>
  )
}
