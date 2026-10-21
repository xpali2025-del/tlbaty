"use client"

import { useMemo, useState } from "react"
import { Bike, Phone, MapPin, Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import type { Courier } from "@/lib/courier"
import { assignCourier } from "../../orders-actions"

// ============================================
// اختيار مندوب لطلب واحد أو لمجموعة طلبات محددة.
//
// يعرض المناديب النشطين فقط، ويقدّم مناديب مدينة الطلب أولاً.
// التعيين نفسه يُنفَّذ على الخادم، وهو من يرفض المناديب الموقوفين نهائياً.
// ============================================

export function AssignCourierDialog({
  orderIds,
  couriers,
  city,
  currentCourierId,
  onClose,
  onAssigned,
}: {
  /** طلب واحد أو مجموعة طلبات. */
  orderIds: string[]
  couriers: Courier[]
  /** مدينة الطلب الحالية — تُستخدم لترتيب المناديب فقط. */
  city?: string
  currentCourierId?: string
  onClose: () => void
  onAssigned?: () => void
}) {
  const [search, setSearch] = useState("")
  const [saving, setSaving] = useState(false)

  // المناديب النشطون فقط، ومناديب مدينة الطلب في المقدمة.
  const ordered = useMemo(() => {
    const target = (city ?? "").trim()
    const active = couriers.filter((c) => c.status === "active")
    return [...active].sort((a, b) => {
      const aCity = target ? (a.cities.includes(target) ? 0 : 1) : 0
      const bCity = target ? (b.cities.includes(target) ? 0 : 1) : 0
      if (aCity !== bCity) return aCity - bCity
      return a.name.localeCompare(b.name, "ar")
    })
  }, [couriers, city])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return ordered
    return ordered.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.phone ?? "").toLowerCase().includes(q) ||
        c.cities.some((x) => x.toLowerCase().includes(q)),
    )
  }, [ordered, search])

  async function handleAssign(courier: Courier) {
    setSaving(true)
    const result = await assignCourier(orderIds, courier._id)
    setSaving(false)
    if (result.ok) {
      toast.success(result.message)
      onAssigned?.()
      onClose()
    } else {
      toast.error(result.error)
    }
  }

  const isBulk = orderIds.length > 1

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-md overflow-hidden">
        <DialogHeader>
          <DialogTitle>
            {isBulk ? `تعيين مندوب لـ ${orderIds.length} طلب` : "تعيين مندوب التوصيل"}
          </DialogTitle>
        </DialogHeader>

        <p className="text-xs text-muted-foreground">
          تعيين المندوب لا يغيّر حالة الطلب. حدّث الحالة إلى «تم تعيين مندوب» أو «في الطريق» بإجراء
          مستقل.
        </p>

        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="ابحث عن مندوب بالاسم أو الهاتف أو المدينة..."
        />

        {city ? (
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <MapPin className="h-3 w-3" aria-hidden="true" />
            مدينة الطلب: {city} — مناديب هذه المدينة معروضون أولاً
          </p>
        ) : null}

        <div className="-mx-1 max-h-72 overflow-y-auto px-1">
          {filtered.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-center">
              <Bike className="mx-auto mb-2 h-7 w-7 text-muted-foreground" aria-hidden="true" />
              <p className="text-sm font-bold">لا يوجد مناديب نشطون</p>
              <p className="mt-1 text-xs text-muted-foreground">
                أضف مندوباً أو فعّل مندوباً موقوفاً من قسم «إدارة المناديب».
              </p>
            </div>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {filtered.map((courier) => {
                const inCity = Boolean(city && courier.cities.includes(city))
                const isCurrent = courier._id === currentCourierId
                return (
                  <li key={courier._id}>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => handleAssign(courier)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-lg border p-2.5 text-right transition-colors hover:bg-muted disabled:opacity-60",
                        isCurrent && "border-primary bg-primary/5",
                      )}
                    >
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted">
                        <Bike className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-sm font-bold">{courier.name}</span>
                          {inCity ? (
                            <span className="rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                              مدينة الطلب
                            </span>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                          {courier.phone ? (
                            <span className="flex items-center gap-1" dir="ltr">
                              <Phone className="h-3 w-3" aria-hidden="true" />
                              {courier.phone}
                            </span>
                          ) : null}
                          <span>مسندة: {courier.stats.assigned}</span>
                          <span>في الطريق: {courier.stats.onTheWay}</span>
                        </div>
                      </div>
                      {isCurrent ? (
                        <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                      ) : null}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="flex justify-end border-t pt-3">
          <Button variant="outline" onClick={onClose} className="bg-transparent">
            إلغاء
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
