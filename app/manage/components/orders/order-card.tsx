"use client"

import { useState, useTransition } from "react"
import {
  Calendar,
  ChevronDown,
  MapPin,
  MapPinned,
  Navigation,
  ExternalLink,
  Package,
  Phone,
  StickyNote,
  Truck,
  Ticket,
  CheckCircle2,
  Bike,
} from "lucide-react"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import type { AdminOrder } from "@/lib/admin-orders"
import type { Courier } from "@/lib/courier"
import {
  ORDER_STATUS_BADGE,
  ORDER_STATUS_LABELS,
  allowedOrderTransitions,
} from "@/lib/order-status"
import {
  PAYMENT_STATUS_BADGE,
  describePaymentMethod,
  paymentStatusLabel,
} from "@/lib/payment"
import { DeleteButton } from "../shared"
import { OrderPaymentPanel } from "../order-payment-panel"
import { OrderItemsTable, money } from "./order-items-table"
import { OrderCourierPanel, OrderStatusHistory } from "./order-courier-panel"
import { updateOrderStatus } from "../../orders-actions"
import { deleteOrder } from "../../client-actions"

// ============================================
// بطاقة الطلب في لوحة الإدارة.
//
// حالة الطلب وحالة الدفع شارتان منفصلتان تماماً، وتحديث الحالة
// يعرض الانتقالات المسموحة فقط كأزرار واضحة.
// ============================================

function formatDate(iso?: string): string {
  if (!iso) return "-"
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return "-"
  return date.toLocaleString("ar-YE", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function OrderCard({
  order,
  couriers,
  selected,
  onToggleSelect,
}: {
  order: AdminOrder
  couriers: Courier[]
  selected: boolean
  onToggleSelect: (id: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [pending, startTransition] = useTransition()

  const transitions = allowedOrderTransitions(order.status)
  const itemsCount = order.items.reduce((sum, i) => sum + (i.quantity ?? 0), 0)

  function handleStatus(next: (typeof transitions)[number]) {
    startTransition(async () => {
      const result = await updateOrderStatus(order._id, next)
      if (result.ok) toast.success(result.message)
      else toast.error(result.error)
    })
  }

  function handleDelete() {
    startTransition(async () => {
      try {
        await deleteOrder(order._id)
        toast.success("تم حذف الطلب")
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "تعذّر الحذف")
      }
    })
  }

  const courierName = (order.courierSnapshot?.name ?? "").trim()

  return (
    <Card className={cn("overflow-hidden transition-opacity", pending && "opacity-60")}>
      <div className="flex flex-col gap-3 p-4">
        {/* الصف العلوي: التحديد والشارات والإجمالي */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 gap-3">
            <Checkbox
              checked={selected}
              onCheckedChange={() => onToggleSelect(order._id)}
              aria-label={`تحديد الطلب ${order.orderNumber ?? order._id}`}
              className="mt-1"
            />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                {/* حالة الطلب */}
                <Badge className={cn("border-0", ORDER_STATUS_BADGE[order.status])}>
                  {ORDER_STATUS_LABELS[order.status]}
                </Badge>
                {/* حالة الدفع — منفصلة تماماً */}
                {order.paymentStatus ? (
                  <Badge className={cn("border-0", PAYMENT_STATUS_BADGE[order.paymentStatus])}>
                    {paymentStatusLabel(order.paymentStatus, order.paymentMethod)}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-muted-foreground">
                    حالة الدفع غير مسجلة
                  </Badge>
                )}
                {order.duplicateTransferReference ? (
                  <Badge className="border-0 bg-destructive/15 text-destructive">حوالة مكررة</Badge>
                ) : null}
                <span className="font-mono text-sm font-semibold" dir="ltr">
                  {order.orderNumber ?? order._id.slice(0, 8)}
                </span>
              </div>
              <p className="mt-1 truncate text-base font-bold">{order.customerName || "عميل"}</p>
              <p className="text-xs text-muted-foreground">
                {describePaymentMethod(
                  order.paymentMethod,
                  order.paymentAccountSnapshot?.providerName,
                )}
              </p>
            </div>
          </div>
          <div className="text-left">
            <p className="text-lg font-bold text-primary">{money(order.total, order.currency)}</p>
            <p className="flex items-center justify-end gap-1 text-xs text-muted-foreground">
              <Calendar className="h-3 w-3" aria-hidden="true" />
              {formatDate(order.createdAt)}
            </p>
          </div>
        </div>

        {/* بيانات مختصرة */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          {order.phone ? (
            <a
              href={`tel:${order.phone}`}
              className="flex items-center gap-1 hover:text-foreground"
              dir="ltr"
            >
              <Phone className="h-3.5 w-3.5" aria-hidden="true" />
              {order.phone}
            </a>
          ) : null}
          {order.city ? (
            <span className="flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
              {order.city}
            </span>
          ) : null}
          <span className="flex items-center gap-1">
            <Package className="h-3.5 w-3.5" aria-hidden="true" />
            {itemsCount} قطعة
          </span>
          <span
            className={cn(
              "flex items-center gap-1",
              !courierName && "text-amber-600 dark:text-amber-500",
            )}
          >
            <Bike className="h-3.5 w-3.5" aria-hidden="true" />
            {courierName || "غير موزّع"}
          </span>
        </div>

        {/* أزرار تحديث الحالة — الانتقالات المسموحة فقط */}
        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          {transitions.length > 0 ? (
            transitions.map((next) => (
              <Button
                key={next}
                variant="outline"
                size="sm"
                className="bg-transparent"
                disabled={pending}
                onClick={() => handleStatus(next)}
              >
                {ORDER_STATUS_LABELS[next]}
              </Button>
            ))
          ) : (
            <span className="text-xs text-muted-foreground">
              لا توجد تغييرات متاحة على حالة هذا الطلب
            </span>
          )}

          <Button
            variant="ghost"
            size="sm"
            className="gap-1"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
          >
            التفاصيل
            <ChevronDown
              className={cn("h-4 w-4 transition-transform", expanded && "rotate-180")}
              aria-hidden="true"
            />
          </Button>

          <div className="ms-auto">
            <DeleteButton
              onConfirm={handleDelete}
              itemLabel={order.orderNumber ?? "الطلب"}
              disabled={pending}
            />
          </div>
        </div>

        {/* التفاصيل الكاملة */}
        {expanded ? (
          <div className="flex flex-col gap-4 border-t pt-3">
            {order.address ? (
              <p className="flex items-start gap-1.5 text-sm">
                <MapPin
                  className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <span>{order.address}</span>
              </p>
            ) : null}

            <OrderLocation order={order} />

            <OrderCourierPanel
              orderId={order._id}
              city={order.city}
              courier={order.courierSnapshot}
              assignedAt={order.courierAssignedAt}
              couriers={couriers}
            />

            <OrderPaymentPanel order={order} />

            {/* ملاحظة العميل */}
            <div className="rounded-lg border bg-muted/30 p-3">
              <p className="mb-1.5 flex items-center gap-1.5 text-sm font-bold">
                <StickyNote className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                ملاحظة العميل
              </p>
              {order.customerNote?.trim() ? (
                <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                  {order.customerNote}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">لا توجد ملاحظة على هذا الطلب</p>
              )}
            </div>

            {/* المنتجات مع أرقامها */}
            <OrderItemsTable items={order.items} currency={order.currency} />

            <OrderStatusHistory history={order.statusHistory} />

            {/* ملخص مالي */}
            <div className="grid gap-1.5 text-sm sm:ms-auto sm:max-w-xs">
              <SummaryLine label="إجمالي المنتجات" value={money(order.subtotal, order.currency)} />
              {order.shippingMethod || order.shippingPrice ? (
                <SummaryLine
                  label={
                    <span className="flex items-center gap-1">
                      <Truck className="h-3.5 w-3.5" aria-hidden="true" />
                      الشحن {order.shippingMethod ? `(${order.shippingMethod})` : ""}
                    </span>
                  }
                  value={money(order.shippingPrice, order.currency)}
                />
              ) : null}
              {order.discount ? (
                <SummaryLine
                  label={
                    <span className="flex items-center gap-1">
                      <Ticket className="h-3.5 w-3.5" aria-hidden="true" />
                      الخصم {order.couponCode ? `(${order.couponCode})` : ""}
                    </span>
                  }
                  value={`- ${money(order.discount, order.currency)}`}
                />
              ) : null}
              <SummaryLine
                label="الإجمالي النهائي"
                value={money(order.total, order.currency)}
                strong
              />
            </div>
          </div>
        ) : null}
      </div>
    </Card>
  )
}

/** موقع العميل ورابط فتحه على الخريطة. */
function OrderLocation({ order }: { order: AdminOrder }) {
  const lat = order.customerLocation?.lat
  const lng = order.customerLocation?.lng
  const hasLocation =
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    !(lat === 0 && lng === 0)

  return (
    <div className="rounded-lg border bg-muted/30 p-3 text-sm">
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        {order.addressSource ? (
          <span className="flex items-center gap-1 text-muted-foreground">
            <MapPinned className="h-3.5 w-3.5" aria-hidden="true" />
            {order.addressSource}
          </span>
        ) : null}
        {hasLocation ? (
          <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
            تم تحديد الموقع
          </span>
        ) : (
          <span className="text-muted-foreground">لا يوجد موقع محدد</span>
        )}
        {typeof order.locationAccuracy === "number" ? (
          <span className="text-muted-foreground">
            الدقة: {Math.round(order.locationAccuracy)} متر
          </span>
        ) : null}
        {order.locationCapturedAt ? (
          <span className="text-muted-foreground">
            وقت التحديد: {formatDate(order.locationCapturedAt)}
          </span>
        ) : null}
      </div>
      {hasLocation ? (
        <a
          href={`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted"
        >
          <Navigation className="h-4 w-4" aria-hidden="true" />
          فتح موقع العميل
          <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        </a>
      ) : null}
    </div>
  )
}

function SummaryLine({
  label,
  value,
  strong,
}: {
  label: React.ReactNode
  value: string
  strong?: boolean
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-2",
        strong && "border-t pt-1.5 text-base font-bold",
      )}
    >
      <span className={strong ? "" : "text-muted-foreground"}>{label}</span>
      <span className={strong ? "text-primary" : ""}>{value}</span>
    </div>
  )
}
