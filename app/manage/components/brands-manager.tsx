"use client"

import { useState, useTransition } from "react"
import Image from "next/image"
import { Pencil, Star, Tag } from "lucide-react"
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
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import type { AdminBrand } from "@/lib/admin"
import { saveBrand, deleteBrand } from "../actions"
import { DeleteButton, ImageField, SectionHeader, SlugField, TagInput } from "./shared"
import { uploadFormImages } from "@/lib/storage/upload-client"

export function BrandsManager({ brands }: { brands: AdminBrand[] }) {
  const [editing, setEditing] = useState<AdminBrand | null>(null)
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

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
        onAdd={() => { setEditing(null); setOpen(true) }}
        addLabel="براند جديد"
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {brands.map((b) => (
          <Card key={b._id} className="flex items-center gap-3 p-3">
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
              </div>
              <p className="text-xs text-muted-foreground">{b.productCount} منتج</p>
            </div>
            <div className="flex shrink-0">
              <Button variant="ghost" size="icon" onClick={() => { setEditing(b); setOpen(true) }}>
                <Pencil className="h-4 w-4" />
                <span className="sr-only">تعديل</span>
              </Button>
              <DeleteButton onConfirm={() => handleDelete(b)} itemLabel={b.name} disabled={isPending} />
            </div>
          </Card>
        ))}
      </div>
      <BrandDialog key={editing?._id ?? "new"} open={open} onOpenChange={setOpen} brand={editing} />
    </div>
  )
}

function BrandDialog({
  open,
  onOpenChange,
  brand,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  brand: AdminBrand | null
}) {
  const [featured, setFeatured] = useState(brand?.featured ?? false)
  const [keywords, setKeywords] = useState<string[]>(brand?.keywords ?? [])
  const [isPending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    form.set("featured", String(featured))
    form.set("keywords", JSON.stringify(keywords))
    startTransition(async () => {
      try {
        await uploadFormImages(form, [
          { name: "image", folder: "brands", keyName: "imageKey" },
        ])
        await saveBrand(brand?._id ?? null, form)
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
          <ImageField current={brand?.image} label="شعار البراند" />
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
