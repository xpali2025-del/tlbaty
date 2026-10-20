"use client"

import { useState, useTransition } from "react"
import Image from "next/image"
import { ImageIcon, Pencil } from "lucide-react"
import { toast } from "sonner"
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
import type { AdminSlide } from "@/lib/admin"
import { saveSlide, deleteSlide } from "../actions"
import { DeleteButton, ImageField, SectionHeader } from "./shared"

export function SlidesManager({ slides }: { slides: AdminSlide[] }) {
  const [editing, setEditing] = useState<AdminSlide | null>(null)
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  function handleDelete(s: AdminSlide) {
    startTransition(async () => {
      try {
        await deleteSlide(s._id)
        toast.success("تم حذف السلايد")
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "تعذّر الحذف")
      }
    })
  }

  return (
    <div>
      <SectionHeader
        title="السلايدر الرئيسي"
        description="شرائح الواجهة الرئيسية للمتجر."
        onAdd={() => { setEditing(null); setOpen(true) }}
        addLabel="سلايد جديد"
      />
      <div className="grid gap-3">
        {slides.map((s) => (
          <Card key={s._id} className="flex items-center gap-4 p-3">
            <div className="relative h-16 w-28 shrink-0 overflow-hidden rounded-md bg-muted">
              {s.image ? (
                <Image src={s.image || "/placeholder.svg"} alt={s.title} fill className="object-cover" unoptimized />
              ) : (
                <div className="flex h-full items-center justify-center">
                  <ImageIcon className="h-5 w-5 text-muted-foreground" />
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{s.title}</p>
              {s.subtitle ? <p className="truncate text-xs text-muted-foreground">{s.subtitle}</p> : null}
              {s.href ? <p className="truncate text-xs text-muted-foreground">{s.href}</p> : null}
            </div>
            <div className="flex shrink-0">
              <Button variant="ghost" size="icon" onClick={() => { setEditing(s); setOpen(true) }}>
                <Pencil className="h-4 w-4" />
                <span className="sr-only">تعديل</span>
              </Button>
              <DeleteButton onConfirm={() => handleDelete(s)} itemLabel={s.title} disabled={isPending} />
            </div>
          </Card>
        ))}
      </div>
      <SlideDialog key={editing?._id ?? "new"} open={open} onOpenChange={setOpen} slide={editing} />
    </div>
  )
}

function SlideDialog({
  open,
  onOpenChange,
  slide,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  slide: AdminSlide | null
}) {
  const [isPending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    startTransition(async () => {
      try {
        await saveSlide(slide?._id ?? null, form)
        toast.success(slide ? "تم تحديث السلايد" : "تمت إضافة السلايد")
        onOpenChange(false)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "تعذّر الحفظ")
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{slide ? "تعديل السلايد" : "سلايد جديد"}</DialogTitle>
          <DialogDescription>يظهر في السلايدر الرئيسي بالصفحة الأولى.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <ImageField current={slide?.image} label="صورة السلايد" required={!slide} />
          <div className="flex flex-col gap-2">
            <Label>العنوان <span className="text-destructive">*</span></Label>
            <Input name="title" defaultValue={slide?.title} required />
          </div>
          <div className="flex flex-col gap-2">
            <Label>العنوان الفرعي</Label>
            <Input name="subtitle" defaultValue={slide?.subtitle ?? ""} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label>نص الزر (CTA)</Label>
              <Input name="cta" defaultValue={slide?.cta ?? ""} placeholder="تسوّق الآن" />
            </div>
            <div className="flex flex-col gap-2">
              <Label>الرابط</Label>
              <Input name="href" defaultValue={slide?.href ?? "/"} dir="ltr" />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label>ترتيب العرض</Label>
            <Input name="sortOrder" type="number" defaultValue={slide?.sortOrder ?? 0} />
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
