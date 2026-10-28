"use client"

import { useState, useTransition } from "react"
import { Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { AdminShipping, AdminShippingMethod, AdminShippingZone } from "@/lib/admin"
import { YEMEN_GOVERNORATES } from "@/lib/yemen-governorates"
import { deleteShippingZone, saveShippingZone } from "../client-actions"
import { DeleteButton, SectionHeader } from "./shared"

const ICONS: AdminShippingMethod["icon"][] = ["standard", "express", "pickup"]
const ICON_LABELS = { standard: "عادي", express: "سريع", pickup: "استلام من المتجر" }
const selectClass = "h-9 rounded-md border bg-background px-2 text-sm"
const errorText = (e: unknown) => (e instanceof Error ? e.message : "تعذّر الحفظ")

export function ShippingManager({ data }: { data: AdminShipping }) {
  return <ZonesSection zones={data.zones} />
}

function ZonesSection({ zones }: { zones: AdminShippingZone[] }) {
  const [editing, setEditing] = useState<AdminShippingZone | null>(null)
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  return (
    <section>
      <SectionHeader
        title="الشحن"
        description="طرق التوصيل وأسعارها لكل محافظة. المنطقة الافتراضية تُستخدم للمحافظات التي ليس لها إعداد خاص."
        onAdd={() => { setEditing(null); setOpen(true) }}
        addLabel="منطقة شحن"
      />
      {zones.length === 0 && <p className="text-sm text-muted-foreground">لا توجد مناطق شحن؛ تُستخدم طرق التوصيل الافتراضية في الدفع.</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        {zones.map((z) => (
          <Card key={z._id} className="flex flex-col gap-2 p-3">
            <div className="flex items-center gap-2">
              <p className="flex-1 font-bold">{z.isDefault ? "المنطقة الافتراضية" : z.governorate}</p>
              {z.isDefault && <Badge variant="secondary">افتراضي</Badge>}
              <Button size="sm" variant="outline" onClick={() => { setEditing(z); setOpen(true) }}>تعديل</Button>
              <DeleteButton
                itemLabel={z.isDefault ? "المنطقة الافتراضية" : z.governorate}
                disabled={isPending}
                onConfirm={() =>
                  startTransition(async () => {
                    try { await deleteShippingZone(z._id); toast.success("تم حذف المنطقة") } catch (e) { toast.error(errorText(e)) }
                  })
                }
              />
            </div>
            <ul className="text-sm text-muted-foreground">
              {z.methods.map((m, i) => (
                <li key={i}>{m.name} — {m.price.toLocaleString("ar-YE")} ({ICON_LABELS[m.icon]})</li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
      {open && <ZoneDialog key={editing?._id ?? "new"} zone={editing} used={zones} onClose={() => setOpen(false)} />}
    </section>
  )
}

function ZoneDialog({ zone, used, onClose }: { zone: AdminShippingZone | null; used: AdminShippingZone[]; onClose: () => void }) {
  const [isDefault, setIsDefault] = useState(zone?.isDefault ?? false)
  const [governorate, setGovernorate] = useState(zone?.governorate ?? "")
  const [methods, setMethods] = useState<AdminShippingMethod[]>(
    zone?.methods.length ? zone.methods : [{ name: "توصيل عادي", description: "", price: 0, icon: "standard" }],
  )
  const [isPending, startTransition] = useTransition()
  const taken = new Set(used.filter((u) => u._id !== zone?._id).map((u) => u.governorate))
  const hasDefault = used.some((u) => u.isDefault && u._id !== zone?._id)

  const patch = (i: number, p: Partial<AdminShippingMethod>) => setMethods((ms) => ms.map((m, j) => (j === i ? { ...m, ...p } : m)))

  function submit() {
    startTransition(async () => {
      try {
        await saveShippingZone(zone?._id ?? null, { governorate: isDefault ? null : governorate || null, isDefault, methods })
        toast.success("تم حفظ منطقة الشحن")
        onClose()
      } catch (e) {
        toast.error(errorText(e))
      }
    })
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{zone ? "تعديل منطقة الشحن" : "منطقة شحن جديدة"}</DialogTitle>
          <DialogDescription>حدد المحافظة وطرق التوصيل المتاحة وأسعارها بالريال اليمني (العملة الأساسية).</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isDefault} disabled={hasDefault && !isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
            المنطقة الافتراضية لباقي المحافظات {hasDefault && !isDefault ? "(موجودة بالفعل)" : ""}
          </label>
          {!isDefault && (
            <div className="flex flex-col gap-1.5">
              <Label>المحافظة</Label>
              <select className={selectClass} value={governorate} onChange={(e) => setGovernorate(e.target.value)}>
                <option value="">اختر المحافظة</option>
                {YEMEN_GOVERNORATES.map((g) => (
                  <option key={g} value={g} disabled={taken.has(g)}>{g}{taken.has(g) ? " (مضافة)" : ""}</option>
                ))}
              </select>
            </div>
          )}
          <div className="flex flex-col gap-3">
            <Label>طرق التوصيل</Label>
            {methods.map((m, i) => (
              <div key={i} className="grid gap-2 rounded-md border p-2 sm:grid-cols-[1fr_7rem_8rem_auto]">
                <Input placeholder="الاسم" value={m.name} onChange={(e) => patch(i, { name: e.target.value })} />
                <Input type="number" min={0} placeholder="السعر" value={m.price} onChange={(e) => patch(i, { price: Math.trunc(Number(e.target.value) || 0) })} />
                <select className={selectClass} value={m.icon} onChange={(e) => patch(i, { icon: e.target.value as AdminShippingMethod["icon"] })}>
                  {ICONS.map((ic) => <option key={ic} value={ic}>{ICON_LABELS[ic]}</option>)}
                </select>
                <Button type="button" size="icon" variant="ghost" disabled={methods.length === 1} onClick={() => setMethods((ms) => ms.filter((_, j) => j !== i))} aria-label="حذف الطريقة">
                  <Trash2 className="h-4 w-4" />
                </Button>
                <Input className="sm:col-span-4" placeholder="وصف (اختياري)، مثل: خلال 24 ساعة" value={m.description} onChange={(e) => patch(i, { description: e.target.value })} />
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" className="self-start gap-1" disabled={methods.length >= 10} onClick={() => setMethods((ms) => [...ms, { name: "", description: "", price: 0, icon: "standard" }])}>
              <Plus className="h-4 w-4" /> إضافة طريقة
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>إلغاء</Button>
          <Button onClick={submit} disabled={isPending}>{isPending ? "جارٍ الحفظ..." : "حفظ"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
