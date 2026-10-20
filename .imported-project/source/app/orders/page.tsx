import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { ChevronLeft, PackageSearch, ShoppingBag } from "lucide-react"

import { Header } from "@/components/header"
import { FooterClient } from "@/components/footer-client"
import { MobileNav } from "@/components/mobile-nav"
import { SafeImage } from "@/components/safe-image"
import { getCurrentCustomer } from "@/lib/otp/session"
import { listOrdersByCustomerId } from "@/lib/otp/customer-orders"
import { ORDER_STATUS_BADGE, ORDER_STATUS_LABELS, normalizeOrderStatus } from "@/lib/order-status"

/**
 * شاشة "طلباتي".
 *
 * تعتمد بالكامل على تسجيل الدخول: تُشتق هوية العميل من الجلسة على الخادم،
 * وتُجلب جميع طلباته تلقائياً دون إدخال رقم طلب أو رقم هاتف. لا يُقبل أي
 * معرّف يرسله العميل. الصفحة خاصة ولا تُفهرس.
 */
export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "طلباتي | Tajline",
  description: "جميع طلباتك وحالتها الحالية، مرتبة من الأحدث إلى الأقدم.",
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false },
  },
}

function formatDateTime(value: string | null): string {
  if (!value) return "—"
  const t = Date.parse(value)
  if (Number.isNaN(t)) return "—"
  return new Intl.DateTimeFormat("ar", {
    dateStyle: "medium",
    timeStyle: "short",
    numberingSystem: "latn",
  }).format(new Date(t))
}

function money(value: number | null, currency: string | null, currencyCode: string | null): string {
  if (typeof value !== "number") return "—"
  const symbol = currency ?? currencyCode ?? ""
  return `${value.toLocaleString("en-US")} ${symbol}`.trim()
}

export default async function OrdersPage() {
  // المصادقة إلزامية: هوية العميل من الجلسة وحدها.
  const customer = await getCurrentCustomer()
  if (!customer) {
    redirect("/login?next=/orders")
  }

  const orders = await listOrdersByCustomerId(customer.customerId, customer.phone ?? "")

  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-3xl px-4 py-8 pb-24 sm:py-12 md:pb-12">
        <header className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight text-balance sm:text-3xl">طلباتي</h1>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground text-pretty">
            جميع طلباتك مرتبة من الأحدث إلى الأقدم. اضغط أي طلب لعرض تفاصيله الكاملة.
          </p>
        </header>

        {orders.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border bg-card px-6 py-16 text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
              <PackageSearch className="h-7 w-7 text-primary" aria-hidden="true" />
            </div>
            <h2 className="text-lg font-bold">لا توجد طلبات بعد</h2>
            <p className="mx-auto mt-1.5 max-w-xs text-sm leading-relaxed text-muted-foreground">
              عند إتمام أول طلب ستظهر جميع طلباتك هنا تلقائياً.
            </p>
            <Link
              href="/shop"
              className="mt-5 inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-primary px-6 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
            >
              <ShoppingBag className="h-4 w-4" aria-hidden="true" />
              ابدأ التسوق
            </Link>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {orders.map((order) => {
              const status = normalizeOrderStatus(order.status)
              return (
                <li key={order.orderNumber}>
                  <Link
                    href={`/orders/${encodeURIComponent(order.orderNumber)}`}
                    className="group flex items-center gap-4 rounded-2xl border bg-card p-4 shadow-sm transition hover:border-primary/40 hover:bg-accent/40"
                  >
                    <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-muted">
                      <SafeImage
                        src={order.firstItemImage ?? "/placeholder.svg"}
                        alt={order.firstItemName ?? "منتج"}
                        fill
                        className="object-cover"
                        sizes="64px"
                      />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-mono text-sm font-bold" dir="ltr">
                          {order.orderNumber}
                        </p>
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${ORDER_STATUS_BADGE[status]}`}
                        >
                          {ORDER_STATUS_LABELS[status]}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatDateTime(order.createdAt)}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                        <span>
                          {order.itemsCount} {order.itemsCount === 1 ? "منتج" : "منتجات"}
                        </span>
                        <span className="font-semibold text-foreground">
                          {money(order.total, order.currency, order.currencyCode)}
                        </span>
                      </div>
                    </div>

                    <ChevronLeft
                      className="h-5 w-5 shrink-0 text-muted-foreground transition group-hover:text-primary"
                      aria-hidden="true"
                    />
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </main>
      <FooterClient />
      <MobileNav />
    </>
  )
}
