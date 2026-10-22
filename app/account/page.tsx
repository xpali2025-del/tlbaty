import { redirect } from "next/navigation"
import Link from "next/link"
import { Header } from "@/components/header"
import { getCurrentCustomer } from "@/lib/otp/session"
import { countOrdersForCustomer } from "@/lib/otp/customer-orders"
import { AccountActions } from "@/components/auth/account-actions"
import { Phone, Hash, CalendarClock, LogIn, Package } from "lucide-react"

export const dynamic = "force-dynamic"

export const metadata = {
  title: "حسابي | Tajline",
  description: "إدارة حساب العميل وتسجيل الخروج وتغيير رقم الهاتف.",
}

function formatDate(value?: string | null): string {
  if (!value) return "—"
  const t = Date.parse(value)
  if (Number.isNaN(t)) return "—"
  return new Intl.DateTimeFormat("ar", {
    dateStyle: "medium",
    timeStyle: "short",
    numberingSystem: "latn",
  }).format(new Date(t))
}

export default async function AccountPage() {
  const customer = await getCurrentCustomer()
  if (!customer) {
    redirect("/login?next=/account")
  }

  const orderCount = await countOrdersForCustomer(customer)

  const rows = [
    { icon: Phone, label: "رقم الهاتف", value: customer.phone, ltr: true },
    { icon: Hash, label: "معرّف العميل", value: customer.publicId, ltr: true },
    { icon: CalendarClock, label: "تاريخ إنشاء الحساب", value: formatDate(customer.createdAt.toISOString()) },
    { icon: LogIn, label: "آخر تسجيل دخول", value: formatDate(customer.lastLoginAt?.toISOString()) },
    { icon: Package, label: "عدد الطلبات", value: String(orderCount) },
  ]

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="mx-auto w-full max-w-2xl px-4 py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight text-balance">حسابي</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            معلومات حسابك وإدارة تسجيل الدخول.
          </p>
        </div>

        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <dl className="divide-y divide-border">
            {rows.map((row) => (
              <div key={row.label} className="flex items-center justify-between gap-4 px-4 py-4">
                <dt className="flex items-center gap-2 text-sm text-muted-foreground">
                  <row.icon className="size-4 shrink-0" aria-hidden />
                  {row.label}
                </dt>
                <dd
                  className="text-sm font-medium tabular-nums"
                  dir={row.ltr ? "ltr" : undefined}
                >
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="mt-6">
          <Link
            href="/orders"
            className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            عرض طلباتي
          </Link>
          <span className="mx-3 text-muted-foreground">·</span>
          <Link
            href="/account/wallet"
            className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            رصيدي
          </Link>
        </div>

        <AccountActions />
      </main>
    </div>
  )
}
