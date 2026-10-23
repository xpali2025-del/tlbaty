import { safeInternalPath } from "@/lib/safe-redirect"
import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { Header } from "@/components/header"
import { FooterClient } from "@/components/footer-client"
import { MobileNav } from "@/components/mobile-nav"
import { LoginForm } from "@/components/auth/login-form"
import { getCurrentCustomer } from "@/lib/otp/session"
import { OTP_LENGTH, OTP_RESEND } from "@/lib/otp/config"
import { getLoginCountryOptions } from "@/lib/otp/countries"

export const metadata: Metadata = {
  title: "تسجيل الدخول",
  description: "سجّل الدخول برقم هاتفك عبر رمز تحقق يصل برسالة نصية لإتمام طلبك.",
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
}

// صفحة خاصة بالعميل: نمنع الكاش لأنها تعتمد على حالة الجلسة.
export const dynamic = "force-dynamic"

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const { next } = await searchParams
  const target = safeInternalPath(next)

  // إن كان العميل مسجّلاً بالفعل، لا داعي لإعادة تسجيل الدخول.
  const customer = await getCurrentCustomer().catch(() => null)
  if (customer) redirect(target)

  const countries = await getLoginCountryOptions()

  return (
    <>
      <Header />
      <main className="flex min-h-screen items-start justify-center px-4 py-10 pb-24 md:items-center md:pb-10">
        <div className="w-full max-w-sm">
          <div className="mb-6 text-center">
            <h1 className="text-2xl font-bold tracking-tight text-balance">تسجيل الدخول</h1>
            <p className="mt-1 text-sm text-muted-foreground text-pretty">
              أدخل رقم هاتفك ليصلك رمز تحقق برسالة نصية.
            </p>
          </div>
          <div className="rounded-xl border border-border bg-card p-6">
            <LoginForm next={target} otpLength={OTP_LENGTH} resendSeconds={OTP_RESEND} countries={countries} />
          </div>
        </div>
      </main>
      <FooterClient />
      <MobileNav />
    </>
  )
}
