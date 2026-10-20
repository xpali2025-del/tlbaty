"use client"

import { MapPin, Users, Package, Truck, CheckCircle2, Bike, ChevronLeft } from "lucide-react"
import type { CityStats } from "@/lib/admin-orders"

// ============================================
// «الطلبات حسب المدن» — بطاقة لكل مدينة مع عدّاداتها.
// الضغط على المدينة يفتح طلباتها في قائمة الطلبات مباشرة.
//
// عدد العملاء محسوب على الخادم بـ customerId أو الهاتف الموحّد
// حتى لا يُحتسب العميل نفسه أكثر من مرة.
// ============================================

function Metric({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Package
  label: string
  value: number
  tone?: string
}) {
  return (
    <div className="flex items-center gap-1.5">
      <Icon className={`h-3.5 w-3.5 shrink-0 ${tone ?? "text-muted-foreground"}`} aria-hidden="true" />
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className="text-xs font-bold tabular-nums">{value}</span>
    </div>
  )
}

export function OrdersByCity({
  cities,
  onSelectCity,
}: {
  cities: CityStats[]
  onSelectCity: (city: string) => void
}) {
  if (cities.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-10 text-center">
        <MapPin className="mx-auto mb-3 h-9 w-9 text-muted-foreground" aria-hidden="true" />
        <p className="font-bold">لا توجد طلبات بعد</p>
        <p className="mt-1 text-sm text-muted-foreground">
          سيظهر تقسيم المدن تلقائياً عند وصول أول طلب.
        </p>
      </div>
    )
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {cities.map((city) => (
        <button
          key={city.city}
          type="button"
          onClick={() => onSelectCity(city.city)}
          className="flex flex-col gap-3 rounded-xl border bg-card p-4 text-right transition-colors hover:border-primary hover:bg-muted/40"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-1.5">
              <MapPin className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              <span className="truncate font-bold">{city.city}</span>
            </span>
            <span className="flex items-center gap-1 text-sm">
              <span className="font-bold tabular-nums text-primary">{city.total}</span>
              <ChevronLeft className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            </span>
          </div>

          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 border-t pt-3">
            <Metric icon={Package} label="جديدة" value={city.newOrders} tone="text-blue-500" />
            <Metric
              icon={Bike}
              label="غير موزّعة"
              value={city.unassigned}
              tone={city.unassigned > 0 ? "text-amber-500" : undefined}
            />
            <Metric icon={Truck} label="في الطريق" value={city.onTheWay} tone="text-violet-500" />
            <Metric
              icon={CheckCircle2}
              label="منفذة"
              value={city.delivered}
              tone="text-emerald-500"
            />
            <Metric icon={Users} label="عملاء" value={city.customers} />
          </div>
        </button>
      ))}
    </div>
  )
}
