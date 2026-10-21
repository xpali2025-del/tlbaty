"use client"

import { useMemo, useState, useTransition } from "react"
import Image from "next/image"
import { Pencil, PackageX, Star, Sparkles } from "lucide-react"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { AdminBrand, AdminCategory, AdminColor, AdminProduct } from "@/lib/admin"
import { saveProduct, deleteProduct, generateProductSlug, backfillImagePalettes } from "../actions"
import { DeleteButton, ImageField, MultiImageField, SectionHeader, SlugField, TagInput } from "./shared"
import { uploadFormImages } from "@/lib/storage/upload-client"

export function ProductsManager({
  products,
  categories,
  brands,
}: {
  products: AdminProduct[]
  categories: AdminCategory[]
  brands: AdminBrand[]
}) {
  const [search, setSearch] = useState("")
  const [editing, setEditing] = useState<AdminProduct | null>(null)
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return products
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.categoryName?.toLowerCase().includes(q) ||
        p.brandName?.toLowerCase().includes(q) ||
        p.productId?.toLowerCase().includes(q),
    )
  }, [products, search])

  function openNew() {
    setEditing(null)
    setOpen(true)
  }

  function openEdit(p: AdminProduct) {
    setEditing(p)
    setOpen(true)
  }

  function handleDelete(p: AdminProduct) {
    startTransition(async () => {
      try {
        await deleteProduct(p._id)
        toast.success("تم حذف المنتج")
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "تعذّر الحذف")
      }
    })
  }

  return (
    <div>
      <SectionHeader
        title="المنتجات"
        description="أضف وعدّل منتجات المتجر — تُحفظ مباشرة وتظهر فوراً."
        onAdd={openNew}
        addLabel="منتج جديد"
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="ابحث بالاسم أو القسم أو الرقم..."
      />

      <PaletteBackfill />

      {filtered.length === 0 ? (
        <EmptyState label="لا توجد منتجات مطابقة." />
      ) : (
        <div className="grid gap-3">
          {filtered.map((p) => (
            <Card key={p._id} className="flex items-center gap-4 p-3">
              <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md bg-muted">
                {p.image ? (
                  <Image src={p.image || "/placeholder.svg"} alt={p.name} fill className="object-cover" unoptimized />
                ) : (
                  <div className="flex h-full items-center justify-center">
                    <PackageX className="h-5 w-5 text-muted-foreground" />
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate font-medium">{p.name}</p>
                  {p.isNew ? (
                    <Badge variant="secondary" className="gap-1">
                      <Sparkles className="h-3 w-3" /> جديد
                    </Badge>
                  ) : null}
                  {p.isBestseller ? (
                    <Badge variant="secondary" className="gap-1">
                      <Star className="h-3 w-3" /> الأكثر مبيعاً
                    </Badge>
                  ) : null}
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {p.categoryName ?? "بدون قسم"}
                  {p.brandName ? ` • ${p.brandName}` : ""}
                  {p.productId ? ` • ${p.productId}` : ""}
                </p>
              </div>
              <div className="hidden text-left sm:block">
                <p className="font-semibold">{p.price?.toLocaleString("ar-EG")} ج.م</p>
                <p className="text-xs text-muted-foreground">المخزون: {p.stock ?? 0}</p>
              </div>
              <div className="flex shrink-0 items-center">
                <Button variant="ghost" size="icon" onClick={() => openEdit(p)}>
                  <Pencil className="h-4 w-4" />
                  <span className="sr-only">تعديل</span>
                </Button>
                <DeleteButton onConfirm={() => handleDelete(p)} itemLabel={p.name} disabled={isPending} />
              </div>
            </Card>
          ))}
        </div>
      )}

      <ProductDialog
        key={editing?._id ?? "new"}
        open={open}
        onOpenChange={setOpen}
        product={editing}
        categories={categories}
        brands={brands}
      />
    </div>
  )
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-16 text-center">
      <PackageX className="h-8 w-8 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  )
}

function ProductDialog({
  open,
  onOpenChange,
  product,
  categories,
  brands,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  product: AdminProduct | null
  categories: AdminCategory[]
  brands: AdminBrand[]
}) {
  const [productName, setProductName] = useState(product?.name ?? "")
  const [categoryId, setCategoryId] = useState(product?.categoryId ?? "")
  const [subcategory, setSubcategory] = useState(product?.subcategory ?? "")
  const [brandId, setBrandId] = useState(product?.brandId ?? "")
  const [isNew, setIsNew] = useState(product?.isNew ?? false)
  const [isBestseller, setIsBestseller] = useState(product?.isBestseller ?? false)
  const [colors, setColors] = useState<AdminColor[]>(product?.colors ?? [])
  const [sizes, setSizes] = useState<string[]>(product?.sizes ?? [])
  const [keywords, setKeywords] = useState<string[]>(product?.keywords ?? [])
  const [isPending, startTransition] = useTransition()

  const selectedCategory = categories.find((c) => c._id === categoryId)
  const subOptions = selectedCategory?.subcategories ?? []
  const selectedBrand = brands.find((b) => b._id === brandId)

  async function handleGenerateSlug() {
    try {
      return await generateProductSlug({
        category: selectedCategory?.name,
        product: productName,
        brand: selectedBrand?.name,
      })
    } catch {
      toast.error("تعذّر توليد الرابط")
      return ""
    }
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    form.set("categoryId", categoryId)
    form.set("categorySlug", selectedCategory?.slug ?? "")
    form.set("subcategory", subcategory)
    form.set("brandId", brandId === "none" ? "" : brandId)
    form.set("isNew", String(isNew))
    form.set("isBestseller", String(isBestseller))
    form.set("colors", JSON.stringify(colors))
    form.set("sizes", JSON.stringify(sizes))
    form.set("keywords", JSON.stringify(keywords))

    startTransition(async () => {
      try {
        await uploadFormImages(form, [
          { name: "image", folder: "products", keyName: "imageKey" },
          { name: "newImages", folder: "products", keyName: "newImageKeys", multiple: true },
        ])
        await saveProduct(product?._id ?? null, form)
        toast.success(product ? "تم تحديث المنتج" : "تمت إضافة المنتج")
        onOpenChange(false)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "تعذّر الحفظ")
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{product ? "تعديل المنتج" : "منتج جديد"}</DialogTitle>
          <DialogDescription>سيُحفظ المنتج مباشرة ويظهر في المتجر فوراً.</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <ImageField current={product?.image} label="صورة المنتج الرئيسية" />

          <MultiImageField current={product?.images} label="صور إضافية للمنتج" />

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="اسم المنتج" required>
              <Input name="name" value={productName} onChange={(e) => setProductName(e.target.value)} required />
            </Field>
            <Field label="السعر (ج.م)" required>
              <Input name="price" type="number" step="0.01" defaultValue={product?.price} required />
            </Field>
            <Field label="السعر قبل الخصم">
              <Input name="oldPrice" type="number" step="0.01" defaultValue={product?.oldPrice ?? ""} />
            </Field>
            <Field label="المخزون">
              <Input name="stock" type="number" defaultValue={product?.stock ?? 0} />
            </Field>
          </div>

          <Field label="الوصف">
            <Textarea name="description" defaultValue={product?.description} rows={3} />
          </Field>

          <SlugField
            basePath="/product/"
            defaultValue={product?.slug}
            label="رابط المنتج"
            onGenerate={handleGenerateSlug}
          />

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="القسم" required>
              <Select value={categoryId} onValueChange={(v) => { setCategoryId(v); setSubcategory("") }}>
                <SelectTrigger>
                  <SelectValue placeholder="اختر القسم" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c._id} value={c._id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="القسم الفرعي">
              <Select value={subcategory} onValueChange={setSubcategory} disabled={!subOptions.length}>
                <SelectTrigger>
                  <SelectValue placeholder={subOptions.length ? "اختياري" : "لا يوجد"} />
                </SelectTrigger>
                <SelectContent>
                  {subOptions.map((s) => (
                    <SelectItem key={s.name} value={s.name}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="البراند">
              <Select value={brandId} onValueChange={setBrandId}>
                <SelectTrigger>
                  <SelectValue placeholder="بدون" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">بدون براند</SelectItem>
                  {brands.map((b) => (
                    <SelectItem key={b._id} value={b._id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="SKU">
              <Input name="sku" defaultValue={product?.sku ?? ""} />
            </Field>
            <Field label="الشارة (badge)">
              <Input name="badge" defaultValue={product?.badge ?? ""} placeholder="خصم، حصري..." />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label>المقاسات</Label>
              <TagInput value={sizes} onChange={setSizes} placeholder="مثل: M ثم Enter" />
            </div>
            <div className="flex flex-col gap-2">
              <Label>الكلمات المفتاحية (SEO)</Label>
              <TagInput value={keywords} onChange={setKeywords} />
            </div>
          </div>

          <ColorsEditor colors={colors} onChange={setColors} />

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="عنوان SEO">
              <Input name="metaTitle" defaultValue={product?.metaTitle ?? ""} />
            </Field>
            <Field label="ترتيب العرض">
              <Input name="sortOrder" type="number" defaultValue={product?.sortOrder ?? 0} />
            </Field>
          </div>
          <Field label="وصف SEO">
            <Textarea name="metaDescription" defaultValue={product?.metaDescription ?? ""} rows={2} />
          </Field>

          <div className="flex flex-wrap gap-6 rounded-md border p-3">
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={isNew} onCheckedChange={setIsNew} />
              منتج جديد
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={isBestseller} onCheckedChange={setIsBestseller} />
              الأكثر مبيعاً
            </label>
          </div>

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

const PRESET_COLORS: AdminColor[] = [
  { name: "أسود", hex: "#000000" },
  { name: "أبيض", hex: "#ffffff" },
  { name: "رمادي", hex: "#6b7280" },
  { name: "أحمر", hex: "#ef4444" },
  { name: "وردي", hex: "#ec4899" },
  { name: "برتقالي", hex: "#f97316" },
  { name: "أصفر", hex: "#eab308" },
  { name: "أخضر", hex: "#22c55e" },
  { name: "تركوازي", hex: "#14b8a6" },
  { name: "أزرق", hex: "#3b82f6" },
  { name: "كحلي", hex: "#1e3a5f" },
  { name: "بنفسجي", hex: "#8b5cf6" },
  { name: "بني", hex: "#78350f" },
  { name: "بيج", hex: "#d6c7a1" },
  { name: "ذهبي", hex: "#d4af37" },
  { name: "فضي", hex: "#c0c0c0" },
]

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

function normalizeHex(value: string) {
  let v = value.trim()
  if (v && !v.startsWith("#")) v = `#${v}`
  return v.toLowerCase()
}

function ColorsEditor({ colors, onChange }: { colors: AdminColor[]; onChange: (v: AdminColor[]) => void }) {
  const [name, setName] = useState("")
  const [hex, setHex] = useState("#000000")

  const hexValid = HEX_RE.test(hex)

  function addColor(color: AdminColor) {
    // تجنّب التكرار حسب اسم اللون أو الكود
    const exists = colors.some(
      (c) => c.name === color.name || c.hex.toLowerCase() === color.hex.toLowerCase(),
    )
    if (exists) return
    onChange([...colors, color])
  }

  function addCustom() {
    if (!hexValid) return
    const label = name.trim() || hex
    addColor({ name: label, hex })
    setName("")
  }

  return (
    <div className="flex flex-col gap-3">
      <Label>الألوان المتاحة</Label>

      {/* لوحة ألوان جاهزة للاختيار السريع */}
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">اختر لوناً جاهزاً</span>
        <div className="flex flex-wrap gap-1.5">
          {PRESET_COLORS.map((c) => {
            const selected = colors.some((x) => x.hex.toLowerCase() === c.hex.toLowerCase())
            return (
              <button
                key={c.hex}
                type="button"
                onClick={() => addColor(c)}
                title={`${c.name} (${c.hex})`}
                aria-label={`إضافة اللون ${c.name}`}
                className={`h-8 w-8 rounded-full border-2 transition ${
                  selected ? "border-primary ring-2 ring-primary/30" : "border-border hover:scale-110"
                }`}
                style={{ backgroundColor: c.hex }}
              />
            )
          })}
        </div>
      </div>

      {/* إضافة لون مخصّص بكود اللون */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">اسم اللون</span>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="اختياري" className="w-32" />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">كود اللون (HEX)</span>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={hexValid ? (hex.length === 4 ? hex : hex) : "#000000"}
              onChange={(e) => setHex(e.target.value)}
              className="h-9 w-10 shrink-0 cursor-pointer rounded border bg-transparent"
              aria-label="منتقي اللون"
            />
            <Input
              value={hex}
              onChange={(e) => setHex(normalizeHex(e.target.value))}
              placeholder="#000000"
              className={`w-28 font-mono ${hex && !hexValid ? "border-destructive" : ""}`}
              dir="ltr"
            />
          </div>
        </div>
        <Button type="button" variant="outline" onClick={addCustom} disabled={!hexValid}>
          إضافة لون
        </Button>
      </div>
      {hex && !hexValid ? (
        <p className="text-xs text-destructive">كود لون غير صالح — استخدم صيغة مثل #1a2b3c</p>
      ) : null}

      {colors.length ? (
        <div className="flex flex-wrap gap-1.5">
          {colors.map((c, i) => (
            <span key={`${c.name}-${i}`} className="flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs">
              <span className="h-3 w-3 rounded-full border" style={{ backgroundColor: c.hex }} />
              {c.name}
              <span className="font-mono text-muted-foreground" dir="ltr">
                {c.hex}
              </span>
              <button type="button" aria-label={`حذف اللون ${c.name}`} onClick={() => onChange(colors.filter((_, idx) => idx !== i))}>
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <Label>
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </Label>
      {children}
    </div>
  )
}


/** يحسب بصمات ألوان صور المنتجات القائمة ليعمل «البحث بالصورة» عليها (المنتجات الجديدة تُحسب تلقائياً عند الحفظ). */
function PaletteBackfill() {
  const [busy, setBusy] = useState(false)
  async function run() {
    setBusy(true)
    try {
      let total = 0
      for (let i = 0; i < 50; i++) {
        const r = await backfillImagePalettes()
        total += r.done
        if (r.remaining === 0 || r.done === 0) {
          toast.success(r.remaining === 0 ? `اكتمل: حُدّثت بصمات ${total} منتج` : `حُدّثت ${total} منتج، وتعذّر تحليل ${r.remaining} (صورتها غير متاحة)`)
          return
        }
      }
      toast.success(`حُدّثت ${total} منتج، أعد التشغيل لإكمال الباقي`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "تعذّر التحديث")
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border bg-card p-3 text-sm">
      <p className="min-w-0 flex-1 text-muted-foreground">
        البحث بالصورة يطابق ألوان صورة العميل مع صور منتجاتك. المنتجات الجديدة تُحلَّل تلقائياً؛ اضغط لتحليل الموجودة منها.
      </p>
      <Button size="sm" variant="outline" onClick={run} disabled={busy}>
        {busy ? "جارٍ التحليل..." : "تحديث بصمات الصور"}
      </Button>
    </div>
  )
}
