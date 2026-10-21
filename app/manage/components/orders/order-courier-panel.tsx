"use client"

import { useState, useTransition } from "react"
import { Bike, Phone, UserX, History } from "lucide-react"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { describeOrderStatus, type OrderStatusHistoryEntry } from "@/lib/order-status"
import type { Courier, CourierSnapshot } from "@/lib/courier"
import { unassignCourier } from "../../orders-actions"
import { AssignCourierDialog } from "./assign-courier-dialog"

// ============================================
// قسم «مندوب التوصيل» داخل تفاصيل الطلب + سجل تغيير الحالات.
//
// الطلبات القديمة بلا مندوب أو بلا سجل تُعرض برسائل واضحة بدل الانكسار.
// ============================================

function formatDateTime(iso?: string): string {
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

export function OrderCourierPanel({
  orderId,
  city,
  courier,
  assignedAt,
  couriers,
}: {
  orderId: string
  city?: string
  /** لقطة المندوب المحفوظة في الطلب — تغيب في الطلبات غير الموزعة. */
  courier?: CourierSnapshot
  assignedAt?: string
  couriers: Courier[]
}) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  // حالة المندوب الحالية تُقرأ من قائمة المناديب، فقد تكون تغيّرت بعد التعيين.
  const live = courier?.courierId
    ? couriers.find((c) => c._id === courier.courierId)
    : undefined

  function handleUnassign() {
    startTransition(async () => {
      const result = await unassignCourier(orderId)
      if (result.ok) toast.success(result.message)
      else toast.error(result.error)
    })
  }

  const name = (courier?.name ?? "").trim()
  const phone = (courier?.phone ?? live?.phone ?? "").trim()

  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <p className="mb-2 flex items-center gap-1.5 text-sm font-bold">
        <Bike className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        مندوب التوصيل
      </p>

      {name ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-bold">{name}</span>
            {live ? (
              <span
                className={
                  live.status === "active"
                    ? "rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-600 dark:text-emerald-400"
                    : "rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground"
                }
              >
                {live.status === "active" ? "نشط" : "موقوف"}
              </span>
            ) : (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                بيانات محفوظة
              </span>
            )}
          </div>

          {phone ? (
            <span className="text-xs text-muted-foreground" dir="ltr">
              {phone}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">لا يوجد رقم هاتف مسجل</span>
          )}

          <span className="text-xs text-muted-foreground">
            وقت التعيين: {formatDateTime(assignedAt)}
          </span>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            {phone ? (
              <Button asChild variant="outline" size="sm" className="gap-1.5 bg-transparent">
                <a href={`tel:${phone}`}>
                  <Phone className="h-3.5 w-3.5" aria-hidden="true" />
                  اتصال بالمندوب
                </a>
              </Button>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              className="bg-transparent"
              onClick={() => setDialogOpen(true)}
            >
              تغيير المندوب
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-muted-foreground"
              disabled={pending}
              onClick={handleUnassign}
            >
              <UserX className="h-3.5 w-3.5" aria-hidden="true" />
              إلغاء التعيين
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm text-muted-foreground">لم يتم تعيين مندوب</span>
          <Button size="sm" className="gap-1.5" onClick={() => setDialogOpen(true)}>
            <Bike className="h-3.5 w-3.5" aria-hidden="true" />
            تعيين مندوب
          </Button>
        </div>
      )}

      {dialogOpen ? (
        <AssignCourierDialog
          orderIds={[orderId]}
          couriers={couriers}
          city={city}
          currentCourierId={courier?.courierId}
          onClose={() => setDialogOpen(false)}
        />
      ) : null}
    </div>
  )
}

/** سجل تغييرات حالة الطلب — الحالة السابقة والجديدة والوقت والمسؤول. */
export function OrderStatusHistory({ history }: { history?: OrderStatusHistoryEntry[] }) {
  const entries = history ?? []

  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <p className="mb-2 flex items-center gap-1.5 text-sm font-bold">
        <History className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        سجل تغيير الحالات
      </p>
      {entries.length === 0 ? (
        <p className="text-xs text-muted-foreground">لا يوجد سجل حالات لهذا الطلب</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {entries.map((entry, index) => (
            <li key={`${entry.changedAt ?? index}`} className="flex flex-col gap-0.5 text-xs">
              <span className="font-medium">
                {describeOrderStatus(entry.from)} ← {describeOrderStatus(entry.to)}
              </span>
              <span className="text-muted-foreground">
                {formatDateTime(entry.changedAt)} • {entry.changedBy || "مدير"}
              </span>
              {entry.note ? (
                <span className="text-muted-foreground">ملاحظة: {entry.note}</span>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
