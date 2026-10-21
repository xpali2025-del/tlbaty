"use client"

import { useMemo, useState, useTransition } from "react"
import Image from "next/image"
import { Bike, Phone, MapPin, Package, Truck, CheckCircle2, XCircle, Pencil } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { toast } from "sonner"
import { SectionHeader, ImageField, DeleteButton } from "./shared"
import { uploadFormImages } from "@/lib/storage/upload-client"
import {
  COURIER_STATUS_BADGE,
  COURIER_STATUS_LABELS,
  type Courier,
  type CourierStatus,
} from "@/lib/courier"
import {
  createCourier,
  updateCourier,
  setCourierStatus,
  deleteCourier,
} from "../couriers-actions"

// ============================================
// إدارة المناديب — كل عملية تُنفَّذ على الخادم عبر Server Actions
// محمية بجلسة /manage. لا يوجد أي توكن Sanity في المتصفح.
// ============================================

/** بطاقة عدّاد صغيرة داخل بطاقة المندوب. */
function Stat({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Package
  label: string
  value: number
  tone: string
}) {
  return (
    <div className="flex items-center gap-1.5 rounded-lg border bg-muted/40 px-2 py-1.5">
      <Icon className={`h-3.5 w-3.5 shrink-0 ${tone}`} aria-hidden="true" />
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className="text-xs font-bold tabular-nums">{value}</span>
    </div>
  )
}

export function CouriersManager({ couriers }: { couriers: Courier[] }) {
  const [search, setSearch] = useState("")
  const [cityFilter, setCityFilter] = useState("")
  const [statusFilter, setStatusFilter] = useState<CourierStatus | "all">("all")
  const [editing, setEditing] = useState<Courier | null>(null)
  const [creating, setCreating] = useState(false)
  const [pending, startTransition] = useTransition()

  // قائمة المدن المستخرجة من المناديب أنفسهم — بلا استعلام إضافي.
  const allCities = useMemo(() => {
    const set = new Set<string>()
    for (const c of couriers) for (const city of c.cities) set.add(city)
    return [...set].sort((a, b) => a.localeCompare(b, "ar"))
  }, [couriers])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return couriers.filter((c) => {
      if (statusFilter !== "all" && c.status !== statusFilter) return false
      if (cityFilter && !c.cities.includes(cityFilter)) return false
      if (!q) return true
      return (
        c.name.toLowerCase().includes(q) ||
        (c.phone ?? "").toLowerCase().includes(q) ||
        c.cities.some((city) => city.toLowerCase().includes(q))
      )
    })
  }, [couriers, search, cityFilter, statusFilter])

  function handleStatus(courier: Courier, next: CourierStatus) {
    startTransition(async () => {
      const result = await setCourierStatus(courier._id, next)
      if (result.ok) toast.success(result.message)
      else toast.error(result.error)
    })
  }

  function handleDelete(courier: Courier) {
    startTransition(async () => {
      const result = await deleteCourier(courier._id)
      if (result.ok) toast.success(result.message)
      else toast.error(result.error)
    })
  }

  const activeCount = couriers.filter((c) => c.status === "active").length

  return (
    <div>
      <SectionHeader
        title="إدارة المناديب"
        description={`${couriers.length} مندوب — ${activeCount} نشط`}
        onAdd={() => setCreating(true)}
        addLabel="إضافة مندوب"
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="ابحث بالاسم أو الهاتف أو المدينة..."
      />

      {/* مرشحات المدينة والحالة */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <select
          value={cityFilter}
          onChange={(e) => setCityFilter(e.target.value)}
          className="h-9 rounded-lg border bg-background px-3 text-sm"
          aria-label="تصفية حسب المدينة"
        >
          <option value="">كل المدن</option>
          {allCities.map((city) => (
            <option key={city} value={city}>
              {city}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as CourierStatus | "all")}
          className="h-9 rounded-lg border bg-background px-3 text-sm"
          aria-label="تصفية حسب حالة المندوب"
        >
          <option value="all">كل الحالات</option>
          <option value="active">نشط</option>
          <option value="suspended">موقوف</option>
        </select>
        {(cityFilter || statusFilter !== "all" || search) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setCityFilter("")
              setStatusFilter("all")
              setSearch("")
            }}
          >
            إزالة المرشحات
          </Button>
        )}
        <span className="mr-auto text-xs text-muted-foreground tabular-nums">
          {filtered.length} من {couriers.length}
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center">
          <Bike className="mx-auto mb-3 h-9 w-9 text-muted-foreground" aria-hidden="true" />
          <p className="font-bold">لا يوجد مناديب مطابقون</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {couriers.length === 0
              ? "أضف أول مندوب لتتمكن من توزيع الطلبات."
              : "جرّب تعديل البحث أو المرشحات."}
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((courier) => (
            <div key={courier._id} className="flex flex-col gap-3 rounded-xl border bg-card p-4">
              <div className="flex items-start gap-3">
                {courier.imageUrl ? (
                  <Image
                    src={courier.imageUrl || "/placeholder.svg"}
                    alt={courier.name}
                    width={48}
                    height={48}
                    className="h-12 w-12 shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-muted">
                    <Bike className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate font-bold">{courier.name}</h3>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${COURIER_STATUS_BADGE[courier.status]}`}
                    >
                      {COURIER_STATUS_LABELS[courier.status]}
                    </span>
                  </div>
                  {courier.phone ? (
                    <a
                      href={`tel:${courier.phone}`}
                      className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
                      dir="ltr"
                    >
                      <Phone className="h-3 w-3 shrink-0" aria-hidden="true" />
                      {courier.phone}
                    </a>
                  ) : (
                    <p className="mt-0.5 text-xs text-muted-foreground">لا يوجد رقم هاتف</p>
                  )}
                </div>
              </div>

              {/* المدن التي يعمل فيها */}
              <div className="flex flex-wrap items-center gap-1">
                <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                {courier.cities.length > 0 ? (
                  courier.cities.map((city) => (
                    <span key={city} className="rounded-md bg-muted px-1.5 py-0.5 text-[11px]">
                      {city}
                    </span>
                  ))
                ) : (
                  <span className="text-[11px] text-muted-foreground">لم تُحدد مدن</span>
                )}
              </div>

              {/* عدد الطلبات المسندة وفي الطريق والمنفذة */}
              <div className="flex flex-wrap gap-1.5">
                <Stat
                  icon={Package}
                  label="مسندة"
                  value={courier.stats.assigned}
                  tone="text-foreground"
                />
                <Stat
                  icon={Truck}
                  label="في الطريق"
                  value={courier.stats.onTheWay}
                  tone="text-violet-500"
                />
                <Stat
                  icon={CheckCircle2}
                  label="منفذة"
                  value={courier.stats.delivered}
                  tone="text-emerald-500"
                />
                {courier.stats.failed > 0 && (
                  <Stat
                    icon={XCircle}
                    label="تعذّرت"
                    value={courier.stats.failed}
                    tone="text-red-500"
                  />
                )}
              </div>

              {courier.adminNote ? (
                <p className="rounded-lg bg-muted/50 p-2 text-xs leading-relaxed text-muted-foreground">
                  {courier.adminNote}
                </p>
              ) : null}

              <div className="mt-auto flex flex-wrap items-center gap-2 border-t pt-3">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 bg-transparent"
                  onClick={() => setEditing(courier)}
                >
                  <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                  تعديل
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="bg-transparent"
                  disabled={pending}
                  onClick={() =>
                    handleStatus(courier, courier.status === "active" ? "suspended" : "active")
                  }
                >
                  {courier.status === "active" ? "إيقاف" : "تفعيل"}
                </Button>
                {/* الحذف يرفضه الخادم إذا كان المندوب مرتبطاً بطلبات */}
                <div className="mr-auto">
                  <DeleteButton
                    onConfirm={() => handleDelete(courier)}
                    itemLabel={courier.name}
                    disabled={pending}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {(creating || editing) && (
        <CourierForm
          courier={editing}
          onClose={() => {
            setCreating(false)
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}

/** نموذج إضافة أو تعديل مندوب — يرسل FormData إلى Server Action. */
function CourierForm({ courier, onClose }: { courier: Courier | null; onClose: () => void }) {
  const [saving, setSaving] = useState(false)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setSaving(true)
    try {
      await uploadFormImages(form, [{ name: "image", folder: "couriers", keyName: "imageKey" }])
    } catch (err) {
      setSaving(false)
      toast.error(err instanceof Error ? err.message : "تعذّر رفع الصورة")
      return
    }
    const result = courier ? await updateCourier(courier._id, form) : await createCourier(form)
    setSaving(false)
    if (result.ok) {
      toast.success(result.message)
      onClose()
    } else {
      toast.error(result.error)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{courier ? "تعديل بيانات المندوب" : "إضافة مندوب"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="courier-name">اسم المندوب</Label>
            <Input
              id="courier-name"
              name="name"
              required
              maxLength={100}
              defaultValue={courier?.name ?? ""}
              placeholder="مثال: أحمد محمد"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="courier-phone">رقم الهاتف</Label>
            <Input
              id="courier-phone"
              name="phone"
              dir="ltr"
              maxLength={30}
              defaultValue={courier?.phone ?? ""}
              placeholder="+967 7xx xxx xxx"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="courier-cities">المدن التي يعمل فيها</Label>
            <Textarea
              id="courier-cities"
              name="cities"
              rows={2}
              defaultValue={courier?.cities.join("، ") ?? ""}
              placeholder="صنعاء، عدن، تعز"
            />
            <p className="text-xs text-muted-foreground">
              افصل بين المدن بفاصلة أو سطر جديد. تُستخدم لترتيب المناديب حسب مدينة الطلب.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="courier-status">حالة المندوب</Label>
            <select
              id="courier-status"
              name="status"
              defaultValue={courier?.status ?? "active"}
              className="h-10 rounded-lg border bg-background px-3 text-sm"
            >
              <option value="active">نشط</option>
              <option value="suspended">موقوف</option>
            </select>
            <p className="text-xs text-muted-foreground">
              المناديب الموقوفون لا يظهرون عند تعيين طلب جديد.
            </p>
          </div>

          <ImageField name="image" label="صورة المندوب (اختيارية)" current={courier?.imageUrl} />

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="courier-note">ملاحظات إدارية</Label>
            <Textarea
              id="courier-note"
              name="adminNote"
              rows={3}
              maxLength={1000}
              defaultValue={courier?.adminNote ?? ""}
              placeholder="ملاحظات داخلية لا يراها العميل"
            />
          </div>

          <div className="flex items-center justify-end gap-2 border-t pt-4">
            <Button type="button" variant="outline" onClick={onClose} className="bg-transparent">
              إلغاء
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "جارٍ الحفظ..." : courier ? "حفظ التعديلات" : "إضافة المندوب"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
