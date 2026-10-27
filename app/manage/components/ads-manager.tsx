"use client"

import { useState, useTransition } from "react"
import Image from "next/image"
import { ImageIcon, Megaphone, Pencil, Video } from "lucide-react"
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
import { Switch } from "@/components/ui/switch"
import { Checkbox } from "@/components/ui/checkbox"
import type { AdminAd, AdminCategory } from "@/lib/admin"
import { saveAd, deleteAd, toggleAdActive } from "../actions"
import { DeleteButton, ImageField, SectionHeader } from "./shared"
import { uploadFormImages } from "@/lib/storage/upload-client"
import { AD_PLACEMENTS, MAX_VIDEO_BYTES, MAX_VIDEO_SECONDS, normalizePlacements } from "@/lib/ads"
import { extractVideoPoster, uploadAdVideo } from "@/lib/storage/video-client"

function placementSummary(placements: string[]) {
  if (!placements.length) return "كل الأماكن"
  return AD_PLACEMENTS.filter((p) => placements.includes(p.key)).map((p) => p.label.replace(/[«»]/g, "")).join("، ")
}

function dateSummary(a: AdminAd) {
  if (!a.startsOn && !a.endsOn) return null
  return `${a.startsOn ? `من ${a.startsOn}` : ""}${a.startsOn && a.endsOn ? " " : ""}${a.endsOn ? `إلى ${a.endsOn}` : ""}`
}

export function AdsManager({ ads, categories }: { ads: AdminAd[]; categories: AdminCategory[] }) {
  const [editing, setEditing] = useState<AdminAd | null>(null)
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  function handleDelete(a: AdminAd) {
    startTransition(async () => {
      try {
        await deleteAd(a._id)
        toast.success("تم حذف الإعلان")
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "تعذّر الحذف")
      }
    })
  }

  function handleToggle(a: AdminAd, value: boolean) {
    startTransition(async () => {
      try {
        await toggleAdActive(a._id, value)
        toast.success(value ? "تم تفعيل الإعلان" : "تم إيقاف الإعلان")
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "تعذّر التحديث")
      }
    })
  }

  return (
    <div>
      <SectionHeader
        title="الإعلانات"
        description="لافتات إعلانية تظهر بين المنتجات — تُحفظ مباشرة."
        onAdd={() => {
          setEditing(null)
          setOpen(true)
        }}
        addLabel="إعلان جديد"
      />

      {ads.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-16 text-center">
          <Megaphone className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">لا توجد إعلانات بعد.</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {ads.map((a) => {
            const targetNames = a.categoryIds
              .map((id) => categories.find((c) => c._id === id)?.name)
              .filter(Boolean)
            return (
              <Card key={a._id} className="flex items-center gap-4 p-3">
                <div className="relative h-16 w-28 shrink-0 overflow-hidden rounded-md bg-muted">
                  {a.image ? (
                    <Image src={a.image || "/placeholder.svg"} alt={a.title} fill className="object-cover" unoptimized />
                  ) : (
                    <div className="flex h-full items-center justify-center">
                      <ImageIcon className="h-5 w-5 text-muted-foreground" />
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate font-medium">{a.title}</p>
                    <Badge variant={a.active === false ? "outline" : "secondary"}>
                      {a.active === false ? "متوقف" : "مفعّل"}
                    </Badge>
                    {a.kind === "video" && (
                      <Badge variant="outline" className="gap-1">
                        <Video className="h-3 w-3" aria-hidden="true" />
                        فيديو
                      </Badge>
                    )}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {targetNames.length ? `يظهر في: ${targetNames.join("، ")}` : "يظهر في جميع الأقسام"}
                    {` • كل ${a.frequency ?? 6} منتج`}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    الأماكن: {placementSummary(a.placements)}
                    {dateSummary(a) ? ` • ${dateSummary(a)}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Switch
                    checked={a.active !== false}
                    onCheckedChange={(v) => handleToggle(a, v)}
                    disabled={isPending}
                    aria-label="تفعيل الإعلان"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      setEditing(a)
                      setOpen(true)
                    }}
                  >
                    <Pencil className="h-4 w-4" />
                    <span className="sr-only">تعديل</span>
                  </Button>
                  <DeleteButton onConfirm={() => handleDelete(a)} itemLabel={a.title} disabled={isPending} />
                </div>
              </Card>
            )
          })}
        </div>
      )}

      <AdDialog
        key={editing?._id ?? "new"}
        open={open}
        onOpenChange={setOpen}
        ad={editing}
        categories={categories}
      />
    </div>
  )
}

function AdDialog({
  open,
  onOpenChange,
  ad,
  categories,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  ad: AdminAd | null
  categories: AdminCategory[]
}) {
  const [active, setActive] = useState(ad?.active !== false)
  const [categoryIds, setCategoryIds] = useState<string[]>(ad?.categoryIds ?? [])
  const [kind, setKind] = useState<"image" | "video">(ad?.kind ?? "image")
  // فارغ في قاعدة البيانات = كل الأماكن، فنعرضها كلها محددة.
  const [placements, setPlacements] = useState<string[]>(ad?.placements?.length ? ad.placements : AD_PLACEMENTS.map((p) => p.key))
  const [videoFile, setVideoFile] = useState<File | null>(null)
  const [isPending, startTransition] = useTransition()

  function togglePlacement(key: string, checked: boolean) {
    setPlacements((prev) => (checked ? [...prev, key] : prev.filter((k) => k !== key)))
  }

  function toggleCategory(id: string, checked: boolean) {
    setCategoryIds((prev) => (checked ? [...prev, id] : prev.filter((c) => c !== id)))
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    form.set("active", String(active))
    form.set("categoryIds", JSON.stringify(categoryIds))
    form.set("kind", kind)
    if (placements.length === 0) {
      toast.error("اختر مكان عرض واحداً على الأقل")
      return
    }
    form.set("placements", JSON.stringify(normalizePlacements(placements)))

    startTransition(async () => {
      try {
        if (kind === "video") {
          const hasPoster = (form.get("image") as File | null)?.size
          if (!videoFile && !ad?.videoUrl) throw new Error("اختر ملف الفيديو (MP4)")
          if (videoFile) {
            form.set("videoKey", await uploadAdVideo(videoFile))
            if (!hasPoster) form.set("image", await extractVideoPoster(videoFile))
          }
        }
        await uploadFormImages(form, [
          { name: "image", folder: "ads", keyName: "imageKey" },
        ])
        await saveAd(ad?._id ?? null, form)
        toast.success(ad ? "تم تحديث الإعلان" : "تمت إضافة الإعلان")
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
          <DialogTitle>{ad ? "تعديل الإعلان" : "إعلان جديد"}</DialogTitle>
          <DialogDescription>لافتة تظهر بين المنتجات وتُحفظ مباشرة.</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label>نوع الإعلان</Label>
            <div role="radiogroup" aria-label="نوع الإعلان" className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
              {([["image", "صورة"], ["video", "فيديو"]] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={kind === value}
                  onClick={() => setKind(value)}
                  className={`min-h-10 rounded-md text-sm font-medium transition ${kind === value ? "bg-background shadow-sm" : "text-muted-foreground"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {kind === "video" && (
            <div className="flex flex-col gap-2">
              <Label>
                ملف الفيديو (MP4) {!ad?.videoUrl && <span className="text-destructive">*</span>}
              </Label>
              <Input
                type="file"
                accept="video/mp4"
                onChange={(e) => setVideoFile(e.target.files?.[0] ?? null)}
              />
              {ad?.videoUrl && !videoFile && <p className="text-xs text-muted-foreground">الفيديو الحالي محفوظ؛ اختر ملفاً لاستبداله.</p>}
              <p className="text-xs text-muted-foreground">
                يعمل تلقائياً بدون صوت وبتكرار. الحد الأقصى {MAX_VIDEO_BYTES / 1024 / 1024} ميغابايت و{MAX_VIDEO_SECONDS} ثانية (الأنسب من 5 إلى 15 ثانية)،
                بصيغة MP4 (H.264) ومقاس 1200×600 (نسبة 2:1).
              </p>
            </div>
          )}

          <ImageField
            current={ad?.image}
            label={kind === "video" ? "صورة الغلاف (اختيارية)" : "صورة الإعلان"}
            required={!ad && kind === "image"}
          />
          <p className="-mt-2 text-xs text-muted-foreground">
            {kind === "video"
              ? "إن لم ترفع صورة تُستخرج تلقائياً من أول لقطات الفيديو. تظهر قبل التشغيل وللمستخدمين الذين يفضّلون تقليل الحركة."
              : "المقاس المناسب: 1200×600 بكسل (نسبة 2:1). يظهر كاملاً على الجوال، ويُقصّ قليلاً من الأعلى والأسفل على الشاشات الكبيرة."}
          </p>

          <div className="flex flex-col gap-2">
            <Label>
              اسم الإعلان <span className="text-destructive">*</span>
            </Label>
            <Input name="title" defaultValue={ad?.title} required />
          </div>

          <div className="flex flex-col gap-2">
            <Label>الرابط عند الضغط</Label>
            <Input name="href" defaultValue={ad?.href ?? ""} dir="ltr" placeholder="/category/perfumes" />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label>يظهر بعد كل كم منتج؟</Label>
              <Input name="frequency" type="number" min={1} defaultValue={ad?.frequency ?? 6} />
            </div>
            <div className="flex flex-col gap-2">
              <Label>ترتيب العرض</Label>
              <Input name="sortOrder" type="number" defaultValue={ad?.sortOrder ?? 0} />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label>الأقسام التي يظهر فيها الإعلان</Label>
            <p className="text-xs text-muted-foreground">اتركها فارغة ليظهر الإعلان في جميع الأقسام.</p>
            <div className="grid gap-2 rounded-md border p-3 sm:grid-cols-2">
              {categories.map((c) => (
                <label key={c._id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={categoryIds.includes(c._id)}
                    onCheckedChange={(v) => toggleCategory(c._id, v === true)}
                  />
                  {c.name}
                </label>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label>أماكن العرض</Label>
            <p className="text-xs text-muted-foreground">يظهر الإعلان في الأماكن المحددة فقط (تحديد الكل = كل الأماكن).</p>
            <div className="grid gap-2 rounded-md border p-3">
              {AD_PLACEMENTS.map((p) => (
                <label key={p.key} className="flex min-h-9 items-center gap-2 text-sm">
                  <Checkbox checked={placements.includes(p.key)} onCheckedChange={(v) => togglePlacement(p.key, v === true)} />
                  <span className="flex-1">{p.label}</span>
                  <span className="text-xs text-muted-foreground">{p.group}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label>يبدأ في</Label>
              <Input name="startsOn" type="date" defaultValue={ad?.startsOn ?? ""} />
            </div>
            <div className="flex flex-col gap-2">
              <Label>ينتهي في</Label>
              <Input name="endsOn" type="date" defaultValue={ad?.endsOn ?? ""} />
            </div>
            <p className="text-xs text-muted-foreground sm:col-span-2">
              اختياري، بتوقيت عدن وشامل لليومين. يبدأ وينتهي الإعلان تلقائياً في موعده.
            </p>
          </div>

          <label className="flex items-center gap-2 rounded-md border p-3 text-sm">
            <Switch checked={active} onCheckedChange={setActive} />
            الإعلان مفعّل
          </label>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              إلغاء
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "جارٍ الحفظ..." : "حفظ التغييرات"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
