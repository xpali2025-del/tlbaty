"use client"

import { useState, useTransition } from "react"
import { Pencil, Ticket } from "lucide-react"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { AdminCoupon } from "@/lib/admin"
import { saveCoupon, deleteCoupon } from "../client-actions"
import { DeleteButton, SectionHeader } from "./shared"

export function CouponsManager({ coupons }: { coupons: AdminCoupon[] }) {
  const [editing, setEditing] = useState<AdminCoupon | null>(null)
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  function handleDelete(c: AdminCoupon) {
    startTransition(async () => {
      try {
        await deleteCoupon(c._id)
        toast.success("تم حذف الكوبون")
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "تعذّر الحذف")
      }
    })
  }

  return (
    <div>
      <SectionHeader
        title="أكواد الخصم"
        description="أنشئ كوبونات خصم تُطبَّق عند الدفع."
        onAdd={() => { setEditing(null); setOpen(true) }}
        addLabel="كوبون جديد"
      />
      <div className="grid gap-3 sm:grid-cols-2">
        {coupons.map((c) => (
          <Card key={c._id} className="flex items-center gap-3 p-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-primary/10">
              <Ticket className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="font-mono font-semibold">{c.code}</p>
                <Badge variant="secondary">
                  {c.type === "percent" ? `${c.discount}%` : `${c.discount} ج.م`}
                </Badge>
              </div>
              <p className="truncate text-xs text-muted-foreground">{c.description}</p>
            </div>
            <div className="flex shrink-0">
              <Button variant="ghost" size="icon" onClick={() => { setEditing(c); setOpen(true) }}>
                <Pencil className="h-4 w-4" />
                <span className="sr-only">تعديل</span>
              </Button>
              <DeleteButton onConfirm={() => handleDelete(c)} itemLabel={c.code} disabled={isPending} />
            </div>
          </Card>
        ))}
      </div>
      <CouponDialog key={editing?._id ?? "new"} open={open} onOpenChange={setOpen} coupon={editing} />
    </div>
  )
}

function CouponDialog({
  open,
  onOpenChange,
  coupon,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  coupon: AdminCoupon | null
}) {
  const [type, setType] = useState<"percent" | "fixed">(coupon?.type ?? "percent")
  const [isPending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    form.set("type", type)
    startTransition(async () => {
      try {
        await saveCoupon(coupon?._id ?? null, form)
        toast.success(coupon ? "تم تحديث الكوبون" : "تمت إضافة الكوبون")
        onOpenChange(false)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "تعذّر الحفظ")
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-md">
        <DialogHeader>
          <DialogTitle>{coupon ? "تعديل الكوبون" : "كوبون جديد"}</DialogTitle>
          <DialogDescription>يُحفظ ويُطبَّق عند الدفع.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label>الكود <span className="text-destructive">*</span></Label>
            <Input name="code" defaultValue={coupon?.code} required dir="ltr" className="font-mono uppercase" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label>نوع الخصم</Label>
              <Select value={type} onValueChange={(v) => setType(v as "percent" | "fixed")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="percent">نسبة مئوية %</SelectItem>
                  <SelectItem value="fixed">مبلغ ثابت</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label>القيمة <span className="text-destructive">*</span></Label>
              <Input name="discount" type="number" step="0.01" defaultValue={coupon?.discount} required />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label>الحد الأدنى للطلب</Label>
            <Input name="minOrder" type="number" step="0.01" defaultValue={coupon?.minOrder ?? 0} />
          </div>
          <div className="flex flex-col gap-2">
            <Label>الوصف <span className="text-destructive">*</span></Label>
            <Input name="description" defaultValue={coupon?.description} required placeholder="خصم 10% على أول طلب" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button>
            <Button type="submit" disabled={isPending}>{isPending ? "جارٍ الحفظ..." : "حفظ التغييرات"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
