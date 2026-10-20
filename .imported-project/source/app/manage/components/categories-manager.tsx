"use client"

import { useState, useTransition } from "react"
import Image from "next/image"
import { FolderTree, Pencil, Plus, X } from "lucide-react"
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
import type { AdminCategory, AdminSubcategory } from "@/lib/admin"
import { saveCategory, deleteCategory } from "../actions"
import { DeleteButton, ImageField, SectionHeader, SlugField, TagInput, sanitizeSlug } from "./shared"

export function CategoriesManager({ categories }: { categories: AdminCategory[] }) {
  const [editing, setEditing] = useState<AdminCategory | null>(null)
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  function handleDelete(c: AdminCategory) {
    startTransition(async () => {
      try {
        await deleteCategory(c._id)
        toast.success("تم حذف القسم")
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "تعذّر الحذف")
      }
    })
  }

  return (
    <div>
      <SectionHeader
        title="الأقسام"
        description="نظّم أقسام المتجر وأقسامها الفرعية."
        onAdd={() => { setEditing(null); setOpen(true) }}
        addLabel="قسم جديد"
      />

      <div className="grid gap-3 sm:grid-cols-2">
        {categories.map((c) => (
          <Card key={c._id} className="flex items-start gap-3 p-3">
            <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-md bg-muted">
              {c.image ? (
                <Image src={c.image || "/placeholder.svg"} alt={c.name} fill className="object-cover" unoptimized />
              ) : (
                <div className="flex h-full items-center justify-center">
                  <FolderTree className="h-5 w-5 text-muted-foreground" />
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{c.name}</p>
              <p className="text-xs text-muted-foreground">{c.productCount} منتج</p>
              {c.subcategories.length ? (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {c.subcategories.map((s) => (
                    <Badge key={s.name} variant="secondary" className="text-[10px]">
                      {s.name}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="flex shrink-0">
              <Button variant="ghost" size="icon" onClick={() => { setEditing(c); setOpen(true) }}>
                <Pencil className="h-4 w-4" />
                <span className="sr-only">تعديل</span>
              </Button>
              <DeleteButton onConfirm={() => handleDelete(c)} itemLabel={c.name} disabled={isPending} />
            </div>
          </Card>
        ))}
      </div>

      <CategoryDialog key={editing?._id ?? "new"} open={open} onOpenChange={setOpen} category={editing} />
    </div>
  )
}

function CategoryDialog({
  open,
  onOpenChange,
  category,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  category: AdminCategory | null
}) {
  const [subs, setSubs] = useState<AdminSubcategory[]>(category?.subcategories ?? [])
  const [keywords, setKeywords] = useState<string[]>(category?.keywords ?? [])
  const [subName, setSubName] = useState("")
  const [isPending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    form.set("subcategories", JSON.stringify(subs))
    form.set("keywords", JSON.stringify(keywords))
    startTransition(async () => {
      try {
        await saveCategory(category?._id ?? null, form)
        toast.success(category ? "تم تحديث القسم" : "تمت إضافة القسم")
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
          <DialogTitle>{category ? "تعديل القسم" : "قسم جديد"}</DialogTitle>
          <DialogDescription>يُحفظ مباشرة.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <ImageField current={category?.image} label="صورة القسم" />
          <div className="flex flex-col gap-2">
            <Label>اسم القسم <span className="text-destructive">*</span></Label>
            <Input name="name" defaultValue={category?.name} required />
          </div>
          <SlugField basePath="/category/" defaultValue={category?.slug} label="رابط القسم" />
          <div className="flex flex-col gap-2">
            <Label>الوصف</Label>
            <Textarea name="description" defaultValue={category?.description} rows={2} />
          </div>

          <div className="flex flex-col gap-2">
            <Label>الأقسام الفرعية</Label>
            <p className="text-xs text-muted-foreground">
              أضف القسم الفرعي، ثم يمكنك تعديل رابطه يدوياً. اترك الرابط فارغاً ليُنشأ تلقائياً من الاسم.
            </p>
            <div className="flex gap-2">
              <Input
                value={subName}
                onChange={(e) => setSubName(e.target.value)}
                placeholder="اسم القسم الفرعي"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229) {
                    e.preventDefault()
                    if (subName.trim()) {
                      setSubs([...subs, { name: subName.trim() }])
                      setSubName("")
                    }
                  }
                }}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  if (subName.trim()) {
                    setSubs([...subs, { name: subName.trim() }])
                    setSubName("")
                  }
                }}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            {subs.length ? (
              <div className="flex flex-col gap-2">
                {subs.map((s, i) => (
                  <div key={i} className="flex flex-col gap-2 rounded-md border p-2.5 sm:flex-row sm:items-center">
                    <Input
                      value={s.name}
                      onChange={(e) =>
                        setSubs(subs.map((x, idx) => (idx === i ? { ...x, name: e.target.value } : x)))
                      }
                      placeholder="اسم القسم الفرعي"
                      className="sm:flex-1"
                    />
                    <div className="flex items-center gap-1 rounded-md border bg-muted/40 px-2 sm:flex-1" dir="ltr">
                      <span className="shrink-0 text-xs text-muted-foreground">?sub=</span>
                      <Input
                        value={s.slug ?? ""}
                        onChange={(e) =>
                          setSubs(
                            subs.map((x, idx) =>
                              idx === i ? { ...x, slug: sanitizeSlug(e.target.value) } : x,
                            ),
                          )
                        }
                        placeholder="الرابط (تلقائي)"
                        className="border-0 bg-transparent px-1 font-mono shadow-none focus-visible:ring-0"
                      />
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="shrink-0 text-destructive hover:text-destructive"
                      onClick={() => setSubs(subs.filter((_, idx) => idx !== i))}
                      aria-label={`حذف ${s.name}`}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <Label>الكلمات المفتاحية (SEO)</Label>
            <TagInput value={keywords} onChange={setKeywords} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label>عنوان SEO</Label>
              <Input name="metaTitle" defaultValue={category?.metaTitle ?? ""} />
            </div>
            <div className="flex flex-col gap-2">
              <Label>ترتيب العرض</Label>
              <Input name="sortOrder" type="number" defaultValue={category?.sortOrder ?? 0} />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label>وصف SEO</Label>
            <Textarea name="metaDescription" defaultValue={category?.metaDescription ?? ""} rows={2} />
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
