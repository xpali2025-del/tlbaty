"use client"

import { useState, useTransition } from "react"
import Image from "next/image"
import { Pencil, Star, Tag } from "lucide-react"
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
import { Switch } from "@/components/ui/switch"
import type { AdminBrand } from "@/lib/admin"
import { saveBrand, deleteBrand } from "../client-actions"
import { DeleteButton, ImageField, SectionHeader, SlugField, TagInput } from "./shared"
import { uploadFormImages } from "@/lib/storage/upload-client"
import { parseBrandForm } from "@/lib/validation/catalog"
import { problemOf } from "@/lib/validation/form"
import { useInstantSave } from "../save-queue/instant-save"
import { enqueueScreenSave, SCREEN_SPECS } from "../save-queue/screens"
import { discardJob, useInstantRows } from "../save-queue/queue"
import { InstantSaveToggle, SaveBadge, SaveProblem } from "../save-queue/ui"
import type { SaveJob } from "../save-queue/core"

export function BrandsManager({ brands }: { brands: AdminBrand[] }) {
  const [editing, setEditing] = useState<AdminBrand | null>(null)
  const [editingJob, setEditingJob] = useState<SaveJob<AdminBrand> | null>(null)
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const instant = useInstantSave()
  const rows = useInstantRows("brands", brands)

  function handleDelete(b: AdminBrand) {
    startTransition(async () => {
      try {
        await deleteBrand(b._id)
        toast.success("تم حذف البراند")
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "تعذّر الحذف")
      }
    })
  }

  return (
    <div>
      <SectionHeader
        title="البراندات"
        description="أدر العلامات التجارية المعروضة في المتجر."
        onAdd={() => { setEditing(null); setEditingJob(null); setOpen(true) }}
        addLabel="براند جديد"
      />
      <InstantSaveToggle />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map(({ item: b, job }) => (
          <Card key={b._id} data-testid="item-row" data-save-state={job?.state ?? "saved"} className={`flex flex-wrap items-center gap-3 p-3 ${job?.state === "failed" || job?.state === "conflict" ? "border-destructive" : ""}`}>
            <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-md border bg-muted">
              {b.image ? (
                <Image src={b.image || "/placeholder.svg"} alt={b.name} fill className="object-contain p-1" unoptimized />
              ) : (
                <div className="flex h-full items-center justify-center">
                  <Tag className="h-5 w-5 text-muted-foreground" />
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <p className="truncate font-medium">{b.name}</p>
                {b.featured ? <Star className="h-3.5 w-3.5 fill-primary text-primary" /> : null}
                {job ? <SaveBadge job={job} /> : null}
              </div>
              <p className="text-xs text-muted-foreground">{b.productCount} منتج</p>
            </div>
            <div className="flex shrink-0">
              <Button
                variant="ghost"
                size="icon"
                disabled={Boolean(job && b._id.startsWith("pending-") && job.state !== "failed" && job.state !== "conflict")}
                onClick={() => { setEditing(b); setEditingJob(job && (job.state === "failed" || job.state === "conflict") ? job : null); setOpen(true) }}
              >
                <Pencil className="h-4 w-4" />
                <span className="sr-only">تعديل</span>
              </Button>
              <DeleteButton onConfirm={() => handleDelete(b)} itemLabel={b.name} disabled={isPending || Boolean(job)} />
            </div>
            {job ? <SaveProblem job={job} onTakeTheirs={() => discardJob(job)} /> : null}
          </Card>
        ))}
      </div>
      <BrandDialog key={`${editing?._id ?? "new"}:${editingJob?.id ?? ""}`} open={open} onOpenChange={setOpen} brand={editing} replaceJob={editingJob} instant={instant} />
    </div>
  )
}

function BrandDialog({
  open,
  onOpenChange,
  brand,
  replaceJob,
  instant,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  brand: AdminBrand | null
  replaceJob: SaveJob<AdminBrand> | null
  instant: boolean
}) {
  const [featured, setFeatured] = useState(brand?.featured ?? false)
  const [keywords, setKeywords] = useState<string[]>(brand?.keywords ?? [])
  const [isPending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    form.set("featured", String(featured))
    form.set("keywords", JSON.stringify(keywords))
    const problem = problemOf(() => parseBrandForm(form))
    if (problem) return void toast.error(problem)
    if (instant) {
      enqueueScreenSave(SCREEN_SPECS.brands, form, brand, replaceJob)
      onOpenChange(false)
      return
    }
    startTransition(async () => {
      try {
        await uploadFormImages(form, [
          { name: "image", folder: "brands", keyName: "imageKey" },
        ])
        await saveBrand(brand && !brand._id.startsWith("pending-") ? brand._id : null, form)
        toast.success(brand ? "تم تحديث البراند" : "تمت إضافة البراند")
        onOpenChange(false)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "تعذّر الحفظ")
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{brand ? "تعديل البراند" : "براند جديد"}</DialogTitle>
          <DialogDescription>يُحفظ مباشرة.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <ImageField folder="brands" current={brand?.image} label="شعار البراند" />
          <div className="flex flex-col gap-2">
            <Label>اسم البراند <span className="text-destructive">*</span></Label>
            <Input name="name" defaultValue={brand?.name} required />
          </div>
          <SlugField basePath="/brand/" defaultValue={brand?.slug} label="رابط البراند" />
          <div className="flex flex-col gap-2">
            <Label>الوصف</Label>
            <Textarea name="description" defaultValue={brand?.description} rows={2} />
          </div>
          <div className="flex flex-col gap-2">
            <Label>الكلمات المفتاحية (SEO)</Label>
            <TagInput value={keywords} onChange={setKeywords} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label>عنوان SEO</Label>
              <Input name="metaTitle" defaultValue={brand?.metaTitle ?? ""} />
            </div>
            <div className="flex flex-col gap-2">
              <Label>ترتيب العرض</Label>
              <Input name="sortOrder" type="number" defaultValue={brand?.sortOrder ?? 0} />
            </div>
          </div>
          <label className="flex items-center gap-2 rounded-md border p-3 text-sm">
            <Switch checked={featured} onCheckedChange={setFeatured} />
            براند مميز (يظهر في الصفحة الرئيسية)
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button>
            <Button type="submit" disabled={isPending}>{isPending ? "جارٍ الحفظ..." : "حفظ التغييرات"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
