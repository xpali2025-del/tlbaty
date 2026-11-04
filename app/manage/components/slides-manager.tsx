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
import { saveSlide, deleteSlide } from "../client-actions"
import { DeleteButton, ImageField, SectionHeader } from "./shared"
import { uploadFormImages } from "@/lib/storage/upload-client"
import { parseSlideForm } from "@/lib/validation/catalog"
import { problemOf } from "@/lib/validation/form"
import { useInstantSave } from "../save-queue/instant-save"
import { enqueueScreenSave, SCREEN_SPECS } from "../save-queue/screens"
import { discardJob, useInstantRows } from "../save-queue/queue"
import { InstantSaveToggle, SaveBadge, SaveProblem } from "../save-queue/ui"
import type { SaveJob } from "../save-queue/core"

export function SlidesManager({ slides }: { slides: AdminSlide[] }) {
  const [editing, setEditing] = useState<AdminSlide | null>(null)
  const [editingJob, setEditingJob] = useState<SaveJob<AdminSlide> | null>(null)
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const instant = useInstantSave()
  const rows = useInstantRows("slides", slides)

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
        onAdd={() => { setEditing(null); setEditingJob(null); setOpen(true) }}
        addLabel="سلايد جديد"
      />
      <InstantSaveToggle />
      <div className="grid gap-3">
        {rows.map(({ item: s, job }) => (
          <Card key={s._id} data-testid="item-row" data-save-state={job?.state ?? "saved"} className={`flex flex-wrap items-center gap-4 p-3 ${job?.state === "failed" || job?.state === "conflict" ? "border-destructive" : ""}`}>
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
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate font-medium">{s.title}</p>
                {job ? <SaveBadge job={job} /> : null}
              </div>
              {s.subtitle ? <p className="truncate text-xs text-muted-foreground">{s.subtitle}</p> : null}
              {s.href ? <p className="truncate text-xs text-muted-foreground">{s.href}</p> : null}
            </div>
            <div className="flex shrink-0">
              <Button
                variant="ghost"
                size="icon"
                disabled={Boolean(job && s._id.startsWith("pending-") && job.state !== "failed" && job.state !== "conflict")}
                onClick={() => { setEditing(s); setEditingJob(job && (job.state === "failed" || job.state === "conflict") ? job : null); setOpen(true) }}
              >
                <Pencil className="h-4 w-4" />
                <span className="sr-only">تعديل</span>
              </Button>
              <DeleteButton onConfirm={() => handleDelete(s)} itemLabel={s.title} disabled={isPending || Boolean(job)} />
            </div>
            {job ? <SaveProblem job={job} onTakeTheirs={() => discardJob(job)} /> : null}
          </Card>
        ))}
      </div>
      <SlideDialog key={`${editing?._id ?? "new"}:${editingJob?.id ?? ""}`} open={open} onOpenChange={setOpen} slide={editing} replaceJob={editingJob} instant={instant} />
    </div>
  )
}

function SlideDialog({
  open,
  onOpenChange,
  slide,
  replaceJob,
  instant,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  slide: AdminSlide | null
  replaceJob: SaveJob<AdminSlide> | null
  instant: boolean
}) {
  const [isPending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const problem = problemOf(() => parseSlideForm(form))
    if (problem) return void toast.error(problem)
    if (instant) {
      enqueueScreenSave(SCREEN_SPECS.slides, form, slide, replaceJob)
      onOpenChange(false)
      return
    }
    startTransition(async () => {
      try {
        await uploadFormImages(form, [
          { name: "image", folder: "slides", keyName: "imageKey" },
        ])
        await saveSlide(slide && !slide._id.startsWith("pending-") ? slide._id : null, form)
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
          <ImageField folder="slides" current={slide?.image} label="صورة السلايد" required={!slide} />
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
