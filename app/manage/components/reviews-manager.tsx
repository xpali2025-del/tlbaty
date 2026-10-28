"use client"

import { useState, useTransition } from "react"
import Image from "next/image"
import { Pencil, Star } from "lucide-react"
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
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import type { AdminReview } from "@/lib/admin"
import { saveReview, deleteReview } from "../client-actions"
import { DeleteButton, ImageField, SectionHeader } from "./shared"
import { uploadFormImages } from "@/lib/storage/upload-client"

export function ReviewsManager({ reviews }: { reviews: AdminReview[] }) {
  const [editing, setEditing] = useState<AdminReview | null>(null)
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  function handleDelete(r: AdminReview) {
    startTransition(async () => {
      try {
        await deleteReview(r._id)
        toast.success("تم حذف التقييم")
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "تعذّر الحذف")
      }
    })
  }

  return (
    <div>
      <SectionHeader
        title="آراء العملاء"
        description="التقييمات المعروضة في الصفحة الرئيسية."
        onAdd={() => { setEditing(null); setOpen(true) }}
        addLabel="تقييم جديد"
      />
      <div className="grid gap-3 sm:grid-cols-2">
        {reviews.map((r) => (
          <Card key={r._id} className="flex gap-3 p-3">
            <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-full bg-muted">
              {r.avatar ? (
                <Image src={r.avatar || "/placeholder.svg"} alt={r.name} fill className="object-cover" unoptimized />
              ) : (
                <div className="flex h-full items-center justify-center text-sm font-medium text-muted-foreground">
                  {r.name.charAt(0)}
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate font-medium">{r.name}</p>
                <Stars value={r.rating} />
              </div>
              <p className="line-clamp-2 text-xs text-muted-foreground">{r.comment}</p>
            </div>
            <div className="flex shrink-0 flex-col">
              <Button variant="ghost" size="icon" onClick={() => { setEditing(r); setOpen(true) }}>
                <Pencil className="h-4 w-4" />
                <span className="sr-only">تعديل</span>
              </Button>
              <DeleteButton onConfirm={() => handleDelete(r)} itemLabel={r.name} disabled={isPending} />
            </div>
          </Card>
        ))}
      </div>
      <ReviewDialog key={editing?._id ?? "new"} open={open} onOpenChange={setOpen} review={editing} />
    </div>
  )
}

function Stars({ value }: { value: number }) {
  return (
    <div className="flex shrink-0">
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          className={cn("h-3.5 w-3.5", i < value ? "fill-primary text-primary" : "text-muted-foreground/40")}
        />
      ))}
    </div>
  )
}

function ReviewDialog({
  open,
  onOpenChange,
  review,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  review: AdminReview | null
}) {
  const [rating, setRating] = useState(String(review?.rating ?? 5))
  const [isPending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    form.set("rating", rating)
    startTransition(async () => {
      try {
        await uploadFormImages(form, [
          { name: "avatar", folder: "reviews", keyName: "avatarKey" },
        ])
        await saveReview(review?._id ?? null, form)
        toast.success(review ? "تم تحديث التقييم" : "تمت إضافة التقييم")
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
          <DialogTitle>{review ? "تعديل التقييم" : "تقييم جديد"}</DialogTitle>
          <DialogDescription>يُحفظ ويظهر في المتجر.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <ImageField name="avatar" current={review?.avatar} label="الصورة الرمزية" />
          <div className="flex flex-col gap-2">
            <Label>اسم العميل <span className="text-destructive">*</span></Label>
            <Input name="name" defaultValue={review?.name} required />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label>التقييم</Label>
              <Select value={rating} onValueChange={setRating}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[5, 4, 3, 2, 1].map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n} نجوم
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label>التاريخ</Label>
              <Input name="date" type="date" defaultValue={review?.date} dir="ltr" />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label>نص التقييم <span className="text-destructive">*</span></Label>
            <Textarea name="comment" defaultValue={review?.comment} rows={3} required />
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
