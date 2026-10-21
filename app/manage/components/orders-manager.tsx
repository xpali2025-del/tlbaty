"use client"

import { useCallback, useMemo, useRef, useState } from "react"
import { ClipboardList, Search, Bike, LayoutList, MapPin, X, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import type {
  AdminOrder,
  OrderFilters,
  OrderSortKey,
  OrderStats,
  OrdersPage,
} from "@/lib/admin-orders"
import type { Courier } from "@/lib/courier"
import {
  ORDER_STATUSES,
  ORDER_STATUS_LABELS,
  type OrderStatus,
} from "@/lib/order-status"
import {
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUSES,
  PAYMENT_STATUS_LABELS,
  type PaymentMethod,
  type PaymentStatus,
} from "@/lib/payment"
import { fetchOrdersPage } from "../orders-actions"
import { OrderCard } from "./orders/order-card"
import { OrdersByCity } from "./orders/orders-by-city"
import { AssignCourierDialog } from "./orders/assign-courier-dialog"
import { AutoDistributeButton } from "./auto-distribute-button"

// ============================================
// شاشة إدارة الطلبات المتكاملة.
//
// الأداء: الطلبات تُحمَّل على دفعات من الخادم عبر fetchOrdersPage،
// والفلاتر والبحث كلها تُنفَّذ في استعلام قاعدة البيانات وليس في المتصفح،
// فلا نحمّل كل الطلبات دفعة واحدة أبداً.
// ============================================

type ViewMode = "list" | "cities"

/** بطاقة ملخص واحدة في الشريط العلوي. */
type SummaryTab = {
  id: string
  label: string
  count: number
  filters: Partial<OrderFilters>
  tone?: string
}

export function OrdersManager({
  initialPage,
  stats,
  couriers,
}: {
  initialPage: OrdersPage
  stats: OrderStats
  couriers: Courier[]
}) {
  const [view, setView] = useState<ViewMode>("list")
  const [filters, setFilters] = useState<OrderFilters>({ status: "all", sort: "newest" })
  const [activeTab, setActiveTab] = useState("all")
  const [orders, setOrders] = useState<AdminOrder[]>(initialPage.orders)
  const [total, setTotal] = useState(initialPage.total)
  const [hasMore, setHasMore] = useState(initialPage.hasMore)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [bulkOpen, setBulkOpen] = useState(false)
  const [searchInput, setSearchInput] = useState("")
  const [showFilters, setShowFilters] = useState(false)

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  /** يجلب الدفعة الأولى لأي مجموعة فلاتر جديدة ويستبدل القائمة. */
  const load = useCallback(async (next: OrderFilters) => {
    setLoading(true)
    try {
      const result = await fetchOrdersPage(next, 0)
      setOrders(result.orders)
      setTotal(result.total)
      setHasMore(result.hasMore)
      setPage(0)
      setSelected([])
    } catch {
      toast.error("تعذّر تحميل الطلبات")
    } finally {
      setLoading(false)
    }
  }, [])

  /** يطبّق تعديلاً على الفلاتر ثم يعيد التحميل من الخادم. */
  const applyFilters = useCallback(
    (patch: Partial<OrderFilters>, tabId?: string) => {
      const next: OrderFilters = { ...filters, ...patch }
      setFilters(next)
      if (tabId) setActiveTab(tabId)
      void load(next)
    },
    [filters, load],
  )

  /** البحث مؤجَّل حتى يتوقف المستخدم عن الكتابة، لتقليل الاستعلامات. */
  function handleSearchChange(value: string) {
    setSearchInput(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      applyFilters({ search: value })
    }, 400)
  }

  async function loadMore() {
    setLoading(true)
    try {
      const nextPage = page + 1
      const result = await fetchOrdersPage(filters, nextPage)
      setOrders((prev) => [...prev, ...result.orders])
      setTotal(result.total)
      setHasMore(result.hasMore)
      setPage(nextPage)
    } catch {
      toast.error("تعذّر تحميل المزيد من الطلبات")
    } finally {
      setLoading(false)
    }
  }

  const summaryTabs: SummaryTab[] = useMemo(
    () => [
      {
        id: "all",
        label: "جميع الطلبات",
        count: stats.statusCounts.all,
        filters: { status: "all", unassignedOnly: false, paymentStatus: "all" },
      },
      {
        id: "new",
        label: "طلبات جديدة",
        count: stats.statusCounts.new,
        filters: { status: "new", unassignedOnly: false, paymentStatus: "all" },
        tone: "text-blue-600 dark:text-blue-400",
      },
      {
        id: "unassigned",
        label: "غير موزّعة",
        count: stats.unassigned,
        filters: { status: "all", unassignedOnly: true, paymentStatus: "all" },
        tone: "text-amber-600 dark:text-amber-500",
      },
      {
        id: "processing",
        label: "قيد التجهيز",
        count: stats.statusCounts.processing,
        filters: { status: "processing", unassignedOnly: false, paymentStatus: "all" },
        tone: "text-orange-600 dark:text-orange-400",
      },
      {
        id: "ready",
        label: "جاهزة للتوصيل",
        count: stats.statusCounts.ready,
        filters: { status: "ready", unassignedOnly: false, paymentStatus: "all" },
        tone: "text-teal-600 dark:text-teal-400",
      },
      {
        id: "on_the_way",
        label: "في الطريق",
        count: stats.statusCounts.on_the_way,
        filters: { status: "on_the_way", unassignedOnly: false, paymentStatus: "all" },
        tone: "text-violet-600 dark:text-violet-400",
      },
      {
        id: "delivered",
        label: "طلبات منفذة",
        count: stats.statusCounts.delivered,
        filters: { status: "delivered", unassignedOnly: false, paymentStatus: "all" },
        tone: "text-emerald-600 dark:text-emerald-400",
      },
      {
        id: "failed",
        label: "تعذّر تسليمها",
        count: stats.statusCounts.failed,
        filters: { status: "failed", unassignedOnly: false, paymentStatus: "all" },
        tone: "text-red-600 dark:text-red-400",
      },
      {
        id: "cancelled",
        label: "ملغاة",
        count: stats.statusCounts.cancelled,
        filters: { status: "cancelled", unassignedOnly: false, paymentStatus: "all" },
        tone: "text-muted-foreground",
      },
      {
        id: "pending_verification",
        label: "جارٍ التحقق من دفعها",
        count: stats.paymentCounts.pending_verification ?? 0,
        filters: { status: "all", unassignedOnly: false, paymentStatus: "pending_verification" },
        tone: "text-sky-600 dark:text-sky-400",
      },
    ],
    [stats],
  )

  function toggleSelect(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  /** الانتقال من عرض المدن إلى طلبات مدينة محددة. */
  function handleSelectCity(city: string) {
    setView("list")
    setShowFilters(true)
    applyFilters({ city, status: "all", unassignedOnly: false }, "all")
  }

  function resetAll() {
    setSearchInput("")
    setActiveTab("all")
    setShowFilters(false)
    const next: OrderFilters = { status: "all", sort: "newest" }
    setFilters(next)
    void load(next)
  }

  const activeFilterCount = [
    filters.city,
    filters.courierId,
    filters.paymentMethod && filters.paymentMethod !== "all" ? filters.paymentMethod : "",
    filters.dateFrom,
    filters.dateTo,
    filters.deliveredFrom,
    filters.deliveredTo,
  ].filter(Boolean).length

  // مدينة الطلبات المحددة — تُستخدم لترتيب المناديب في التعيين الجماعي.
  const bulkCity = useMemo(() => {
    const cities = new Set(
      selected.map((id) => orders.find((o) => o._id === id)?.city).filter(Boolean) as string[],
    )
    return cities.size === 1 ? [...cities][0] : undefined
  }, [selected, orders])

  return (
    <div>
      {/* العنوان وتبديل العرض */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">إدارة الطلبات</h1>
          <p className="text-sm text-muted-foreground">
            {stats.total} طلب في {stats.cities.length} مدينة
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-lg border p-1">
          <Button
            variant={view === "list" ? "default" : "ghost"}
            size="sm"
            className="gap-1.5"
            onClick={() => setView("list")}
          >
            <LayoutList className="h-4 w-4" aria-hidden="true" />
            الطلبات
          </Button>
          <Button
            variant={view === "cities" ? "default" : "ghost"}
            size="sm"
            className="gap-1.5"
            onClick={() => setView("cities")}
          >
            <MapPin className="h-4 w-4" aria-hidden="true" />
            حسب المدن
          </Button>
        </div>
      </div>

      {/* الملخص العلوي */}
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {summaryTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => {
              setView("list")
              applyFilters(tab.filters, tab.id)
            }}
            className={cn(
              "flex flex-col items-start gap-0.5 rounded-xl border bg-card p-3 text-right transition-colors hover:bg-muted/50",
              activeTab === tab.id && view === "list" && "border-primary bg-primary/5",
            )}
          >
            <span className={cn("text-xl font-bold tabular-nums", tab.tone)}>{tab.count}</span>
            <span className="text-[11px] leading-tight text-muted-foreground">{tab.label}</span>
          </button>
        ))}
      </div>

      {view === "cities" ? (
        <OrdersByCity cities={stats.cities} onSelectCity={handleSelectCity} />
      ) : (
        <>
          {/* البحث والمرشحات */}
          <div className="mb-4 flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-56 flex-1">
                <Search
                  className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  value={searchInput}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  placeholder="رقم الطلب، رقم المنتج، اسم العميل، الهاتف، رقم الحوالة، اسم المندوب"
                  className="pr-9"
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 bg-transparent"
                onClick={() => setShowFilters((v) => !v)}
                aria-expanded={showFilters}
              >
                مرشحات
                {activeFilterCount > 0 ? (
                  <span className="rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground">
                    {activeFilterCount}
                  </span>
                ) : null}
              </Button>
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />
              ) : null}
            </div>

            {showFilters ? (
              <div className="grid gap-3 rounded-xl border bg-muted/30 p-3 sm:grid-cols-2 lg:grid-cols-3">
                <FilterSelect
                  label="المدينة"
                  value={filters.city ?? ""}
                  onChange={(v) => applyFilters({ city: v })}
                  options={[
                    { value: "", label: "كل المدن" },
                    ...stats.cityNames.map((c) => ({ value: c, label: c })),
                  ]}
                />
                <FilterSelect
                  label="حالة الطلب"
                  value={filters.status ?? "all"}
                  onChange={(v) => applyFilters({ status: v as OrderStatus | "all" })}
                  options={[
                    { value: "all", label: "كل الحالات" },
                    ...ORDER_STATUSES.map((s) => ({ value: s, label: ORDER_STATUS_LABELS[s] })),
                  ]}
                />
                <FilterSelect
                  label="حالة الدفع"
                  value={filters.paymentStatus ?? "all"}
                  onChange={(v) => applyFilters({ paymentStatus: v as PaymentStatus | "all" })}
                  options={[
                    { value: "all", label: "كل حالات الدفع" },
                    ...PAYMENT_STATUSES.map((s) => ({ value: s, label: PAYMENT_STATUS_LABELS[s] })),
                  ]}
                />
                <FilterSelect
                  label="طريقة الدفع"
                  value={filters.paymentMethod ?? "all"}
                  onChange={(v) => applyFilters({ paymentMethod: v as PaymentMethod | "all" })}
                  options={[
                    { value: "all", label: "كل الطرق" },
                    ...PAYMENT_METHODS.map((m) => ({ value: m, label: PAYMENT_METHOD_LABELS[m] })),
                  ]}
                />
                <FilterSelect
                  label="المندوب"
                  value={filters.unassignedOnly ? "__unassigned" : (filters.courierId ?? "")}
                  onChange={(v) =>
                    applyFilters(
                      v === "__unassigned"
                        ? { unassignedOnly: true, courierId: "" }
                        : { unassignedOnly: false, courierId: v },
                    )
                  }
                  options={[
                    { value: "", label: "كل المناديب" },
                    { value: "__unassigned", label: "لم يُعيّن لها مندوب" },
                    ...couriers.map((c) => ({ value: c._id, label: c.name })),
                  ]}
                />
                <FilterSelect
                  label="الترتيب"
                  value={filters.sort ?? "newest"}
                  onChange={(v) => applyFilters({ sort: v as OrderSortKey })}
                  options={[
                    { value: "newest", label: "الأحدث أولاً" },
                    { value: "oldest", label: "الأقدم أولاً" },
                    { value: "total-desc", label: "الأعلى قيمة" },
                    { value: "total-asc", label: "الأقل قيمة" },
                  ]}
                />
                <DateRange
                  label="تاريخ الطلب"
                  from={filters.dateFrom ?? ""}
                  to={filters.dateTo ?? ""}
                  onChange={(from, to) => applyFilters({ dateFrom: from, dateTo: to })}
                />
                <DateRange
                  label="تاريخ التسليم"
                  from={filters.deliveredFrom ?? ""}
                  to={filters.deliveredTo ?? ""}
                  onChange={(from, to) =>
                    applyFilters({ deliveredFrom: from, deliveredTo: to })
                  }
                />
                <div className="flex items-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1.5"
                    onClick={resetAll}
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                    إزالة كل المرشحات
                  </Button>
                </div>
              </div>
            ) : null}

            {/* المدينة المختارة من عرض المدن */}
            {filters.city ? (
              <div className="flex items-center gap-2 text-sm">
                <span className="flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-bold text-primary">
                  <MapPin className="h-3 w-3" aria-hidden="true" />
                  {filters.city}
                </span>
                <button
                  type="button"
                  onClick={() => applyFilters({ city: "" })}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  إزالة تصفية المدينة
                </button>
              </div>
            ) : null}
          </div>

          {/* شريط التعيين الجماعي */}
          {selected.length > 0 ? (
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-primary bg-primary/5 p-3">
              <span className="text-sm font-bold">{selected.length} طلب محدد</span>
              <Button size="sm" className="gap-1.5" onClick={() => setBulkOpen(true)}>
                <Bike className="h-3.5 w-3.5" aria-hidden="true" />
                تعيين مندوب للمحدد
              </Button>
              <AutoDistributeButton
                orderIds={selected}
                label="توزيع تلقائي للمحدد"
                variant="outline"
                onDone={() => {
                  setSelected([])
                  void load(filters)
                }}
              />
              <Button variant="ghost" size="sm" onClick={() => setSelected([])}>
                إلغاء التحديد
              </Button>
            </div>
          ) : null}

          {/* عدد النتائج */}
          <p className="mb-3 text-xs text-muted-foreground tabular-nums">
            يُعرض {orders.length} من {total} طلب مطابق
          </p>

          {/* قائمة الطلبات */}
          {orders.length === 0 && !loading ? (
            <div className="rounded-xl border border-dashed p-10 text-center">
              <ClipboardList
                className="mx-auto mb-3 h-9 w-9 text-muted-foreground"
                aria-hidden="true"
              />
              <p className="font-bold">لا توجد طلبات مطابقة</p>
              <p className="mt-1 text-sm text-muted-foreground">
                جرّب تغيير البحث أو إزالة المرشحات.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {orders.map((order) => (
                <OrderCard
                  key={order._id}
                  order={order}
                  couriers={couriers}
                  selected={selected.includes(order._id)}
                  onToggleSelect={toggleSelect}
                />
              ))}
            </div>
          )}

          {hasMore ? (
            <div className="mt-4 flex justify-center">
              <Button
                variant="outline"
                className="bg-transparent"
                disabled={loading}
                onClick={loadMore}
              >
                {loading ? "جارٍ التحميل..." : "تحميل المزيد"}
              </Button>
            </div>
          ) : null}
        </>
      )}

      {bulkOpen ? (
        <AssignCourierDialog
          orderIds={selected}
          couriers={couriers}
          city={bulkCity}
          onClose={() => setBulkOpen(false)}
          onAssigned={() => {
            setSelected([])
            void load(filters)
          }}
        />
      ) : null}
    </div>
  )
}

/** قائمة اختيار مرشِّح واحدة. */
function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
}) {
  const id = `filter-${label}`
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 rounded-lg border bg-background px-2 text-sm"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  )
}

/** نطاق تاريخ من/إلى. */
function DateRange({
  label,
  from,
  to,
  onChange,
}: {
  label: string
  from: string
  to: string
  onChange: (from: string, to: string) => void
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1">
        <Input
          type="date"
          value={from}
          onChange={(e) => onChange(e.target.value, to)}
          className="h-9 text-xs"
          aria-label={`${label} من`}
        />
        <Input
          type="date"
          value={to}
          onChange={(e) => onChange(from, e.target.value)}
          className="h-9 text-xs"
          aria-label={`${label} إلى`}
        />
      </div>
    </div>
  )
}
