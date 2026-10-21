import type { Metadata } from "next"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CircleDashed,
  MapPin,
  Phone,
  StickyNote,
  Truck,
  User,
} from "lucide-react"

import { Header } from "@/components/header"
import { FooterClient } from "@/components/footer-client"
import { MobileNav } from "@/components/mobile-nav"
import { SafeImage } from "@/components/safe-image"
import { getCurrentCustomer } from "@/lib/otp/session"
import { getOrderForCustomer } from "@/lib/otp/customer-orders"
import {
  ORDER_STATUS_BADGE,
  ORDER_STATUS_LABELS,
  normalizeOrderStatus,
  type OrderStatus,
} from "@/lib/order-status"
import {
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_CUSTOMER_LABELS,
  type PaymentMethod,
  type PaymentStatus,
} from "@/lib/payment"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "تفاصيل الطلب | Tajline",
  description: "تفاصيل طلبك وحالته الحالية.",
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false },
  },
}

/** المراحل العامة المعروضة للعميل — assigned مدمجة في "جاهز للتوصيل". */
const CUSTOMER_STAGES: { status: OrderStatus; label: string }[] = [
  { status: "new", label: "تم استلام الطلب" },
  { status: "confirmed", label: "تم تأكيد الطلب" },
  { status: "processing", label: "قيد التجهيز" },
  { status: "ready", label: "جاهز للتوصيل" },
  { status: "on_the_way", label: "في الطريق" },
  { status: "delivered", label: "تم التسليم" },
]

const EXCEPTION_STATUSES: OrderStatus[] = ["failed", "cancelled", "returned"]

function formatDateTime(value: string | null): string {
  if (!value) return "—"
  const t = Date.parse(value)
  if (Number.isNaN(t)) return "—"
  return new Intl.DateTimeFormat("ar", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    numberingSystem: "latn",
  }).format(new Date(t))
}

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ orderNumber: string }>
}) {
  const { orderNumber } = await params

  // المصادقة إلزامية: هوية العميل من الجلسة وحدها.
  const customer = await getCurrentCustomer()
  if (!customer) {
    redirect(`/login?next=/orders/${encodeURIComponent(orderNumber)}`)
  }

  // رقم الطلب يأتي من الرابط لكنه لا يكفي: الاستعلام يشترط ملكية العميل
  // عبر معرّف الجلسة، فلا يُعاد أي طلب لا يخص صاحب الجلسة.
  const order = await getOrderForCustomer(customer, decodeURIComponent(orderNumber))
  if (!order) {
    notFound()
  }

  const status = normalizeOrderStatus(order.status)
  const isException = EXCEPTION_STATUSES.includes(status)
  const currentStageIndex = CUSTOMER_STAGES.findIndex((s) => s.status === status)

  const money = (value: number | null) => {
    if (typeof value !== "number") return "—"
    const symbol = order.currency ?? order.currencyCode ?? ""
    return `${value.toLocaleString("en-US")} ${symbol}`.trim()
  }

  const stageDate = (stageStatus: OrderStatus): string | null => {
    if (stageStatus === "new") return order.createdAt
    const entry = order.statusTimeline.find((t) => normalizeOrderStatus(t.status) === stageStatus)
    return entry?.changedAt ?? null
  }

  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-3xl px-4 py-8 pb-24 sm:py-12 md:pb-12">
        <Link
          href="/orders"
          className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition hover:text-primary"
        >
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
          العودة إلى طلباتي
        </Link>

        <section className="flex flex-col gap-4">
          {/* معلومات الطلب */}
          <div className="rounded-2xl border bg-card p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs text-muted-foreground">رقم الطلب</p>
                <p className="font-mono text-base font-bold" dir="ltr">
                  {order.orderNumber}
                </p>
              </div>
              <span
                className={`rounded-full px-3 py-1 text-xs font-semibold ${ORDER_STATUS_BADGE[status]}`}
              >
                {ORDER_STATUS_LABELS[status]}
              </span>
            </div>

            <dl className="mt-4 grid grid-cols-1 gap-3 border-t pt-4 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted-foreground">تاريخ إنشاء الطلب</dt>
                <dd className="mt-0.5 font-medium">{formatDateTime(order.createdAt)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">آخر تحديث</dt>
                <dd className="mt-0.5 font-medium">{formatDateTime(order.lastUpdatedAt)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">حالة الدفع</dt>
                <dd className="mt-0.5 font-medium">
                  {order.paymentStatus
                    ? (PAYMENT_STATUS_CUSTOMER_LABELS[order.paymentStatus as PaymentStatus] ??
                      order.paymentStatus)
                    : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">طريقة الدفع</dt>
                <dd className="mt-0.5 font-medium">
                  {order.paymentMethod
                    ? (PAYMENT_METHOD_LABELS[order.paymentMethod as PaymentMethod] ??
                      order.paymentMethod)
                    : "—"}
                </dd>
              </div>
            </dl>
          </div>

          {/* مراحل الطلب */}
          <div className="rounded-2xl border bg-card p-5 shadow-sm">
            <h2 className="mb-4 text-sm font-bold">مراحل الطلب</h2>

            {isException ? (
              <div className="flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/10 p-4">
                <AlertTriangle
                  className="mt-0.5 h-5 w-5 shrink-0 text-destructive"
                  aria-hidden="true"
                />
                <div>
                  <p className="text-sm font-bold text-destructive">{ORDER_STATUS_LABELS[status]}</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    للاستفسار عن تفاصيل هذه الحالة تواصل مع المتجر.
                  </p>
                </div>
              </div>
            ) : (
              <ol className="flex flex-col">
                {CUSTOMER_STAGES.map((stage, index) => {
                  const reached = currentStageIndex >= index
                  const isCurrent = currentStageIndex === index
                  const date = stageDate(stage.status)
                  const isLast = index === CUSTOMER_STAGES.length - 1

                  return (
                    <li key={stage.status} className="flex gap-3">
                      <div className="flex flex-col items-center">
                        {reached ? (
                          <CheckCircle2
                            className={`h-5 w-5 shrink-0 ${isCurrent ? "text-primary" : "text-emerald-600 dark:text-emerald-400"}`}
                            aria-hidden="true"
                          />
                        ) : (
                          <CircleDashed
                            className="h-5 w-5 shrink-0 text-muted-foreground/50"
                            aria-hidden="true"
                          />
                        )}
                        {!isLast ? (
                          <span
                            className={`w-0.5 flex-1 ${reached ? "bg-emerald-600/40 dark:bg-emerald-400/40" : "bg-border"}`}
                            aria-hidden="true"
                          />
                        ) : null}
                      </div>
                      <div className={isLast ? "pb-0" : "pb-5"}>
                        <p className={`text-sm ${reached ? "font-semibold" : "text-muted-foreground"}`}>
                          {stage.label}
                          {isCurrent ? (
                            <span className="mr-2 text-xs font-normal text-primary">
                              (الحالة الحالية)
                            </span>
                          ) : null}
                        </p>
                        {reached && date ? (
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {formatDateTime(date)}
                          </p>
                        ) : null}
                      </div>
                    </li>
                  )
                })}
              </ol>
            )}
          </div>

          {/* المنتجات */}
          <div className="rounded-2xl border bg-card p-5 shadow-sm">
            <h2 className="mb-4 text-sm font-bold">المنتجات</h2>
            <ul className="flex flex-col gap-4">
              {order.items.map((item, index) => (
                <li
                  key={`${item.productNumber ?? "item"}-${index}`}
                  className="flex gap-3 border-b pb-4 last:border-0 last:pb-0"
                >
                  <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-muted">
                    <SafeImage
                      src={item.image ?? "/placeholder.svg"}
                      alt={item.name ?? "منتج"}
                      fill
                      className="object-cover"
                      sizes="80px"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold leading-snug text-pretty">
                      {item.name ?? "منتج"}
                    </p>
                    {item.productNumber ? (
                      <p className="mt-0.5 font-mono text-xs text-muted-foreground" dir="ltr">
                        {item.productNumber}
                      </p>
                    ) : null}
                    {item.sku ? (
                      <p className="font-mono text-xs text-muted-foreground" dir="ltr">
                        SKU: {item.sku}
                      </p>
                    ) : null}
                    <p className="mt-1 text-xs text-muted-foreground">
                      المقاس: {item.size ?? "—"} • اللون: {item.color ?? "—"}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                      <span className="text-muted-foreground">
                        الكمية:{" "}
                        <span className="font-semibold text-foreground">{item.quantity ?? "—"}</span>
                      </span>
                      <span className="text-muted-foreground">السعر: {money(item.price)}</span>
                      <span className="font-semibold">الإجمالي: {money(item.lineTotal)}</span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {/* التكاليف */}
          <div className="rounded-2xl border bg-card p-5 shadow-sm">
            <h2 className="mb-3 text-sm font-bold">التكاليف</h2>
            <dl className="flex flex-col gap-2 text-sm">
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">إجمالي المنتجات</dt>
                <dd>{money(order.subtotal)}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">رسوم التوصيل</dt>
                <dd>{money(order.shippingPrice)}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">الخصم</dt>
                <dd className={order.discount ? "text-emerald-600 dark:text-emerald-400" : ""}>
                  {order.discount ? `- ${money(order.discount)}` : money(0)}
                </dd>
              </div>
              <div className="mt-1 flex items-center justify-between border-t pt-3 text-base font-bold">
                <dt>الإجمالي النهائي</dt>
                <dd>{money(order.total)}</dd>
              </div>
            </dl>
          </div>

          {/* بيانات التوصيل */}
          <div className="rounded-2xl border bg-card p-5 shadow-sm">
            <h2 className="mb-3 text-sm font-bold">بيانات التوصيل</h2>
            <dl className="flex flex-col gap-3 text-sm">
              <div className="flex items-start gap-2">
                <User className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div>
                  <dt className="text-xs text-muted-foreground">اسم العميل</dt>
                  <dd className="font-medium">{order.customerName ?? "—"}</dd>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Phone className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div>
                  <dt className="text-xs text-muted-foreground">رقم الهاتف</dt>
                  <dd className="font-mono font-medium" dir="ltr">
                    {order.phone ?? "—"}
                  </dd>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div>
                  <dt className="text-xs text-muted-foreground">العنوان</dt>
                  <dd className="font-medium">{order.city ?? "—"}</dd>
                  <dd className="mt-0.5 leading-relaxed text-muted-foreground">
                    {order.address ?? "—"}
                  </dd>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Truck className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div>
                  <dt className="text-xs text-muted-foreground">طريقة التوصيل</dt>
                  <dd className="font-medium">{order.shippingMethod ?? "—"}</dd>
                  <dd className="mt-1 text-xs text-muted-foreground">
                    {order.courierName ? `المندوب: ${order.courierName}` : "لم يتم تعيين مندوب بعد"}
                  </dd>
                </div>
              </div>
            </dl>
          </div>

          {/* ملاحظة العميل */}
          {order.customerNote ? (
            <div className="rounded-2xl border bg-card p-5 shadow-sm">
              <h2 className="mb-2 flex items-center gap-2 text-sm font-bold">
                <StickyNote className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                ملاحظتك على الطلب
              </h2>
              <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
                {order.customerNote}
              </p>
            </div>
          ) : null}
        </section>
      </main>
      <FooterClient />
      <MobileNav />
    </>
  )
}
