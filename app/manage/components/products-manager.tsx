"use client"

import { SizeChartEditor, emptyChart } from "./size-chart-editor"
import { validateSizeChart, type SizeChart } from "@/lib/size-chart"
import { VariantStockEditor, variantCombos, variantKey } from "./variant-stock-editor"
import { useMemo, useRef, useState, useTransition } from "react"
import Image from "next/image"
import { AlertTriangle, Loader2, Pencil, PackageX, RotateCcw, Star, Sparkles, WifiOff, X } from "lucide-react"
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
import type { AdminBrand, AdminCategory, AdminColor, AdminProduct, AdminSizeChart } from "@/lib/admin"
import { saveProduct, deleteProduct, generateProductSlug, backfillImagePalettes } from "../client-actions"
import { useManageStore } from "../manage-store"
import { DeleteButton, ImageField, MultiImageField, SectionHeader, SlugField, TagInput } from "./shared"
import { uploadFormImages } from "@/lib/storage/upload-client"
import { parseProductForm } from "@/lib/validation/product"
import { problemOf } from "@/lib/validation/form"
import { getSaveQueue, discardJob, useSaveJobs } from "../save-queue/queue"
import { buildProductJob, isPendingId, PRODUCT_SCREEN, type ProductJob } from "../save-queue/product-job"
import { setInstantSave, useInstantSave } from "../save-queue/instant-save"

export function ProductsManager({
  products,
  categories,
  brands,
  sizeCharts,
}: {
  products: AdminProduct[]
  categories: AdminCategory[]
  brands: AdminBrand[]
  sizeCharts: AdminSizeChart[]
}) {
  const [search, setSearch] = useState("")
  const [editing, setEditing] = useState<AdminProduct | null>(null)
  // ما يلزم النموذج غير الحقول: نسخة الخادم الأصلية (لأساس المخزون ورقم النسخة)، وعملية فاشلة يستبدلها هذا الحفظ.
  const [editingBase, setEditingBase] = useState<AdminProduct | null>(null)
  const [editingJob, setEditingJob] = useState<ProductJob | null>(null)
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const { upsertProduct } = useManageStore()
  const instant = useInstantSave()
  const jobs = useSaveJobs(PRODUCT_SCREEN) as readonly ProductJob[]

  // القائمة = نسخ الخادم، وفوقها ما يُحفظ الآن: المنتج المعدَّل يظهر بتعديله، والجديد في أول القائمة، وعلى كلٍّ شارة حالته.
  const rows = useMemo(() => {
    const latest = new Map<string, ProductJob>()
    for (const job of jobs) latest.set(job.entityId, job)
    const known = new Set(products.map((p) => p._id))
    const fresh = [...latest.values()].filter((j) => !known.has(j.entityId)).reverse().map((job) => ({ product: job.optimistic, job }))
    return [...fresh, ...products.map((p) => ({ product: latest.get(p._id)?.optimistic ?? p, job: latest.get(p._id) }))]
  }, [products, jobs])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(
      ({ product: p }) =>
        p.name.toLowerCase().includes(q) ||
        p.categoryName?.toLowerCase().includes(q) ||
        p.brandName?.toLowerCase().includes(q) ||
        p.productId?.toLowerCase().includes(q),
    )
  }, [rows, search])

  function openNew() {
    setEditing(null)
    setEditingBase(null)
    setEditingJob(null)
    setOpen(true)
  }

  function openEdit(row: { product: AdminProduct; job?: ProductJob }) {
    const failed = row.job && (row.job.state === "failed" || row.job.state === "conflict") ? row.job : null
    setEditing(row.product)
    setEditingBase(products.find((p) => p._id === row.product._id) ?? null)
    setEditingJob(failed)
    if (failed && row.job!.entries.some(([name, value]) => typeof value !== "string" && (name === "image" || name === "newImages"))) {
      toast.warning("الصور الجديدة في هذا الحفظ لم تُحفظ بعد؛ اخترها من جديد قبل الحفظ.")
    }
    setOpen(true)
  }

  /** نسخة الخادم الحالية بدل تعديلي (بعد تعارض): تُدرَج ويُترك الحفظ. */
  function takeTheirs(job: ProductJob) {
    if (job.conflict) upsertProduct(job.conflict as AdminProduct)
    discardJob(job)
  }

  /** احتفظ بتعديلي (بعد تعارض): يُعاد إرساله فوق نسخة الخادم الحالية. */
  function keepMine(job: ProductJob) {
    const version = (job.conflict as AdminProduct | null | undefined)?.version
    if (version === undefined) return void discardJob(job) // حُذف المنتج من مكان آخر: لا شيء نعدّله
    getSaveQueue().patch(job.id, {
      entries: [...job.entries.filter(([name]) => name !== "expectedVersion"), ["expectedVersion", String(version)]],
      requestId: crypto.randomUUID(),
    })
    getSaveQueue().retry(job.id)
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

      <label className="mb-3 flex w-fit items-center gap-2 text-xs text-muted-foreground">
        <Switch checked={instant} onCheckedChange={setInstantSave} data-testid="instant-save-toggle" />
        الحفظ الفوري: تُغلق النافذة عند الضغط ويُكمل الحفظ في الخلفية
      </label>

      {filtered.length === 0 ? (
        <EmptyState label="لا توجد منتجات مطابقة." />
      ) : (
        <div className="grid gap-3">
          {filtered.map((row) => {
            const { product: p, job } = row
            const busy = job && (job.state === "queued" || job.state === "running" || job.state === "retrying")
            const bad = job && ((job.state === "failed" && !job.offline) || job.state === "conflict")
            return (
              <Card
                key={p._id}
                data-testid="product-row"
                data-save-state={job?.state ?? "saved"}
                className={`flex flex-wrap items-center gap-4 p-3 ${bad ? "border-destructive" : ""} ${busy ? "opacity-80" : ""}`}
              >
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
                    {job ? <SaveBadge job={job} /> : null}
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
                  <Button variant="ghost" size="icon" onClick={() => openEdit(row)} disabled={Boolean(busy && isPendingId(p._id))}>
                    <Pencil className="h-4 w-4" />
                    <span className="sr-only">تعديل</span>
                  </Button>
                  <DeleteButton onConfirm={() => handleDelete(p)} itemLabel={p.name} disabled={isPending || Boolean(job)} />
                </div>
                {job ? <SaveProblem job={job} onKeepMine={() => keepMine(job)} onTakeTheirs={() => takeTheirs(job)} /> : null}
              </Card>
            )
          })}
        </div>
      )}

      <ProductDialog
        // الإصدار في المفتاح: فتح منتج بعد حفظه يبدأ نموذجاً جديداً بنسخته الحالية لا بحالة قديمة
        key={`${editing?._id ?? "new"}:${editing?.version ?? 0}:${editingJob?.id ?? ""}`}
        open={open}
        onOpenChange={setOpen}
        product={editing}
        base={editingBase}
        replaceJob={editingJob}
        instant={instant}
        categories={categories}
        brands={brands}
        sizeCharts={sizeCharts}
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
  base,
  replaceJob,
  instant,
  categories,
  brands,
  sizeCharts,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  product: AdminProduct | null
  /** نسخة الخادم الأصلية للمنتج (ليست المتفائلة): أساس المخزون ورقم النسخة. null للمنتج الجديد. */
  base: AdminProduct | null
  /** عملية حفظ فاشلة أو متعارضة يستبدلها هذا الحفظ. */
  replaceJob: ProductJob | null
  /** الحفظ الفوري: يُضاف الحفظ للطابور وتُغلق النافذة فوراً. */
  instant: boolean
  categories: AdminCategory[]
  brands: AdminBrand[]
  sizeCharts: AdminSizeChart[]
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
  // دليل المقاسات: بدون (الافتراضي) | جدول مشترك | جدول خاص بهذا المنتج.
  const [guideMode, setGuideMode] = useState<"none" | "chart" | "custom">(product?.customSizeChart ? "custom" : product?.sizeChartId ? "chart" : "none")
  const [guideChartId, setGuideChartId] = useState(product?.sizeChartId ?? sizeCharts[0]?._id ?? "")
  const [guideCustom, setGuideCustom] = useState<SizeChart>(product?.customSizeChart ?? emptyChart())
  const [trackVariants, setTrackVariants] = useState((product?.variants?.length ?? 0) > 0)
  const [variantValues, setVariantValues] = useState<Record<string, string>>(
    Object.fromEntries((product?.variants ?? []).map((v) => [variantKey(v.color, v.size), String(v.stock)])),
  )
  // ما رآه المدير عند فتح النموذج، لتطبيق التغيير كفرق (لا يمسح خصم طلبات جرت أثناء التعديل).
  const savedVariantStock = new Map((base?.variants ?? []).map((v) => [variantKey(v.color, v.size), v.stock]))
  const [isPending, startTransition] = useTransition()
  const { upsertProduct } = useManageStore()
  // معرّف عملية الحفظ: يبقى نفسه إن أُعيد إرسال المحتوى نفسه (انقطع الرد بعد أن وصل الحفظ)، فلا يتكرر المنتج.
  const attempt = useRef<{ id: string; fingerprint: string } | null>(null)

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
    if (guideMode === "custom") {
      const problem = validateSizeChart({ ...guideCustom, name: guideCustom.name.trim() || "جدول المنتج" })
      if (problem) return void toast.error(`دليل المقاسات: ${problem}`)
    }
    form.set("sizeGuide", JSON.stringify({ mode: guideMode, chartId: guideChartId, custom: { ...guideCustom, name: guideCustom.name.trim() || "جدول المنتج" } }))
    if (trackVariants) {
      const rows = variantCombos(colors, sizes).map((c) => ({
        ...c,
        stock: Math.max(0, Math.trunc(Number(variantValues[variantKey(c.color, c.size)])) || 0),
        base: savedVariantStock.get(variantKey(c.color, c.size)),
      }))
      form.set("trackVariants", "true")
      form.set("variants", JSON.stringify(rows))
    }

    const problem = problemOf(() => parseProductForm(form))
    if (problem) return void toast.error(problem)

    if (instant) {
      // الحفظ الفوري: العملية تدخل الطابور (تُحفظ في المتصفح قبل الإرسال) وتُغلق النافذة فوراً؛ يتابع الطابور الرفع والحفظ.
      const jobInput = buildProductJob(form, base, { categories, brands }, replaceJob && isPendingId(replaceJob.entityId) ? { entityId: replaceJob.entityId } : undefined)
      if (replaceJob) discardJob(replaceJob)
      getSaveQueue().enqueue(jobInput)
      onOpenChange(false)
      return
    }

    // بصمة المحتوى قبل رفع الصور (ملفاتها ثابتة، ومفاتيحها تتغيّر مع كل رفع): محتوى جديد = معرّف عملية جديد.
    // الملف بالاسم والحجم فقط: المتصفح يضع لحقل الملف الفارغ وقت تعديل جديداً عند كل إرسال، فلا يصلح في البصمة.
    const fingerprint = JSON.stringify([...form.entries()].map(([k, v]) => [k, v instanceof File ? `${v.name}:${v.size}` : v]))
    if (attempt.current?.fingerprint !== fingerprint) attempt.current = { id: crypto.randomUUID(), fingerprint }
    form.set("requestId", attempt.current.id)
    // نسخة المنتج التي رآها المدير عند فتح النموذج: إن تغيّر المنتج بعدها يرفض الخادم الحفظ بدل أن يمسح التعديل الآخر.
    if (product) form.set("expectedVersion", String(product.version))

    startTransition(async () => {
      try {
        await uploadFormImages(form, [
          { name: "image", folder: "products", keyName: "imageKey" },
          { name: "newImages", folder: "products", keyName: "newImageKeys", multiple: true },
        ])
        const result = await saveProduct(product && !isPendingId(product._id) ? product._id : null, form)
        if (result.status === "conflict") {
          if (result.current) upsertProduct(result.current)
          throw new Error("عدّل شخص آخر هذا المنتج بعد فتحك للنموذج، وحُدّثت القائمة بآخر نسخة. أغلق النافذة وافتح المنتج من جديد ثم كرّر تعديلك.")
        }
        attempt.current = null
        onOpenChange(false)
        upsertProduct(result.item)
        toast.success(product ? "تم تحديث المنتج" : "تمت إضافة المنتج")
      } catch (err) {
        // انقطاع الشبكة يظهر من المتصفح كـ TypeError بنص إنجليزي؛ ولأن إعادة الإرسال آمنة (معرّف العملية) نقول ذلك.
        toast.error(err instanceof TypeError ? "انقطع الاتصال بالخادم. اضغط «حفظ التغييرات» مرة أخرى؛ لن يتكرر المنتج." : err instanceof Error ? err.message : "تعذّر الحفظ")
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
          <ImageField folder="products" current={product?.image} label="صورة المنتج الرئيسية" isProcessing={isPending} />

          <MultiImageField folder="products" current={product?.images} label="صور إضافية للمنتج" isProcessing={isPending} />

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
              <Input name="stock" type="number" min={0} defaultValue={product?.stock ?? 0} disabled={trackVariants} />
              {trackVariants ? <p className="text-xs text-muted-foreground">يُحسب من مخزون الألوان والمقاسات أدناه.</p> : null}
            {base ? <input type="hidden" name="stockBase" value={base.stock ?? 0} /> : null}
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

          <div className="flex flex-col gap-2">
            <Label htmlFor="size-guide-mode">دليل المقاسات (اختياري)</Label>
            <select
              id="size-guide-mode"
              value={guideMode === "chart" ? `chart:${guideChartId}` : guideMode}
              onChange={(e) => {
                const v = e.target.value
                if (v.startsWith("chart:")) {
                  setGuideMode("chart")
                  setGuideChartId(v.slice(6))
                } else setGuideMode(v as "none" | "custom")
              }}
              className="h-9 rounded-md border bg-background px-2 text-sm"
            >
              <option value="none">بدون دليل مقاسات</option>
              {sizeCharts.map((c) => (
                <option key={c._id} value={`chart:${c._id}`}>جدول: {c.name}</option>
              ))}
              <option value="custom">جدول خاص بهذا المنتج…</option>
            </select>
            <p className="text-xs text-muted-foreground">
              يظهر للعميل رابط «دليل المقاسات» و«اعرف مقاسك». اختر جدولاً جاهزاً بنقرة، ولا تحتاج لإدخال بيانات هنا إلا لجدول خاص. تُدار الجداول من تبويب «جداول المقاسات».
            </p>
            {guideMode === "custom" ? <SizeChartEditor value={guideCustom} onChange={setGuideCustom} showName={false} /> : null}
          </div>

          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" checked={trackVariants} onChange={(e) => setTrackVariants(e.target.checked)} />
              تحديد المخزون لكل لون ومقاس
            </label>
            <p className="text-xs text-muted-foreground">
              فعّلها لتحديد الكمية المتوفرة من كل تركيبة (مثلاً: أسود - M = 3). يمنع المتجر بيع تركيبة نفدت ولو بقي مخزون في غيرها.
            </p>
            {trackVariants ? <VariantStockEditor colors={colors} sizes={sizes} values={variantValues} onChange={setVariantValues} /> : null}
          </div>

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

/** شارة حالة الحفظ على عنصر القائمة. */
function SaveBadge({ job }: { job: ProductJob }) {
  const base = { "data-testid": "save-badge", "data-state": job.state } as const
  if (job.state === "queued" || job.state === "running") {
    return (
      <Badge variant="outline" className="gap-1" {...base}>
        <Loader2 className="h-3 w-3 animate-spin" /> جارٍ الحفظ…
      </Badge>
    )
  }
  if (job.state === "retrying" || (job.state === "failed" && job.offline)) {
    return (
      <Badge variant="outline" className="gap-1 border-amber-500 text-amber-700 dark:text-amber-400" {...base}>
        <WifiOff className="h-3 w-3" /> بانتظار الاتصال
      </Badge>
    )
  }
  return (
    <Badge variant="destructive" className="gap-1" {...base}>
      <AlertTriangle className="h-3 w-3" /> {job.state === "conflict" ? "تعارض" : "فشل الحفظ"}
    </Badge>
  )
}

/** تفاصيل ما يحتاج المدير: سبب الفشل مع «أعد المحاولة» و«تجاهل»، أو خيارا التعارض. التعديل من زر القلم. */
function SaveProblem({ job, onKeepMine, onTakeTheirs }: { job: ProductJob; onKeepMine: () => void; onTakeTheirs: () => void }) {
  if (job.state === "conflict") {
    return (
      <div className="flex w-full flex-wrap items-center gap-2 border-t pt-2 text-sm" data-testid="save-problem">
        <p className="flex-1 text-destructive">عدّل شخص آخر هذا المنتج بعد فتحك للنموذج. اختر ما تريد:</p>
        {(job.conflict as AdminProduct | null | undefined) ? (
          <Button type="button" size="sm" variant="outline" onClick={onKeepMine}>
            احتفظ بتعديلي
          </Button>
        ) : null}
        <Button type="button" size="sm" variant="outline" onClick={onTakeTheirs}>
          {job.conflict ? "خذ النسخة الجديدة" : "تجاهل تعديلي"}
        </Button>
      </div>
    )
  }
  if (job.state === "failed") {
    return (
      <div className="flex w-full flex-wrap items-center gap-2 border-t pt-2 text-sm" data-testid="save-problem">
        <p className="flex-1 text-destructive">{job.offline ? "تعذّر الاتصال بالخادم، وحفظك محفوظ في هذا المتصفح." : job.error}</p>
        <Button type="button" size="sm" variant="outline" className="gap-1" onClick={() => getSaveQueue().retry(job.id)}>
          <RotateCcw className="h-3.5 w-3.5" /> أعد المحاولة
        </Button>
        <Button type="button" size="sm" variant="ghost" className="gap-1" onClick={() => discardJob(job)}>
          <X className="h-3.5 w-3.5" /> تجاهل
        </Button>
      </div>
    )
  }
  return null
}
