import { redirect } from "next/navigation"
import Link from "next/link"
import { Header } from "@/components/header"
import { getCurrentCustomer } from "@/lib/otp/session"
import { getCurrencySettings, getPaymentAccounts } from "@/lib/data"
import { getSiteConfig } from "@/lib/site-config"
import { getWalletSummary } from "@/lib/wallet/customer"
import { WalletClient } from "./wallet-client"

export const dynamic = "force-dynamic"

export const metadata = {
  title: "رصيدي | Tajline",
  description: "رصيد المحفظة وشحنه والدفع منه.",
}

export default async function WalletPage() {
  const customer = await getCurrentCustomer()
  if (!customer) redirect("/login?next=/account/wallet")

  const [{ payments }, summary, accounts, currencySettings] = await Promise.all([
    getSiteConfig(),
    getWalletSummary(customer.id),
    getPaymentAccounts(),
    getCurrencySettings(),
  ])

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="mx-auto w-full max-w-2xl px-4 py-10">
        <div className="mb-6 flex items-center justify-between gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-balance">رصيدي</h1>
          <Link href="/account" className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline-offset-4 hover:underline">
            حسابي
          </Link>
        </div>
        {payments.wallet ? (
          <WalletClient
            summary={summary}
            accounts={accounts.map((a) => ({ id: a.id, providerName: a.providerName, accountHolderName: a.accountHolderName, accountNumber: a.accountNumber }))}
            currencies={currencySettings.currencies}
            defaultCurrency={currencySettings.defaultCode}
          />
        ) : (
          <p className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">خدمة الرصيد غير متاحة حالياً.</p>
        )}
      </main>
    </div>
  )
}
