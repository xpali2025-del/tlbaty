"use client"

import { useEffect, useRef, useState } from "react"
import Image from "next/image"
import { ImagePlus, Plus, Search, Sparkles, Trash2, Upload, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"

/** ترويسة كل قسم في اللوحة مع زر الإضافة والبحث الاختياري. */
export function SectionHeader({
  title,
  description,
  onAdd,
  addLabel = "إضافة",
  search,
  onSearchChange,
  searchPlaceholder = "بحث...",
}: {
  title: string
  description?: string
  onAdd?: () => void
  addLabel?: string
  search?: string
  onSearchChange?: (v: string) => void
  searchPlaceholder?: string
}) {
  return (
    <div className="mb-6 flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-balance">{title}</h1>
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {onAdd ? (
          <Button onClick={onAdd} className="gap-2">
            <Plus className="h-4 w-4" />
            {addLabel}
          </Button>
        ) : null}
      </div>
      {onSearchChange ? (
        <div className="relative max-w-sm">
          <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search ?? ""}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            className="pr-9"
          />
        </div>
      ) : null}
    </div>
  )
}

/** حقل رفع صورة مع معاينة. يُرسل الملف باسم `name` داخل FormData. */
export function ImageField({
  name = "image",
  label = "الصورة",
  current,
  required,
}: {
  name?: string
  label?: string
  current?: string
  required?: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<string | null>(current ?? null)
  const [cleared, setCleared] = useState(false)

  return (
    <div className="flex flex-col gap-2">
      <Label>{label}</Label>
      <div className="flex items-center gap-3">
        <div className="relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted">
          {preview && !cleared ? (
            <Image src={preview || "/placeholder.svg"} alt="" fill className="object-cover" unoptimized />
          ) : (
            <Upload className="h-6 w-6 text-muted-foreground" />
          )}
        </div>
        <div className="flex flex-col gap-2">
          <input
            ref={inputRef}
            type="file"
            name={name}
            accept="image/*"
            required={required && !current}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) {
                setPreview(URL.createObjectURL(file))
                setCleared(false)
              }
            }}
          />
          <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
            {current ? "تغيير الصورة" : "اختيار صورة"}
          </Button>
          {preview && !cleared ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() => {
                if (inputRef.current) inputRef.current.value = ""
                setPreview(null)
                setCleared(true)
              }}
            >
              <X className="ml-1 h-3 w-3" />
              إزالة الاختيار
            </Button>
          ) : null}
        </div>
      </div>
      {current ? (
        <p className="text-xs text-muted-foreground">اترك الحقل فارغاً للإبقاء على الصورة الحالية.</p>
      ) : null}
    </div>
  )
}

/**
 * حقل رفع عدة صور إضافية للمنتج مع معاينة.
 * - الصور الحالية تُرسل كمراجع محفوظة داخل حقل `keptImages` (JSON).
 * - الصور الجديدة تُرسل كملفات داخل حقل `newImages`.
 */
export function MultiImageField({
  keptName = "keptImages",
  filesName = "newImages",
  label = "صور إضافية",
  current = [],
}: {
  keptName?: string
  filesName?: string
  label?: string
  current?: { url: string; ref: string }[]
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [kept, setKept] = useState(current)
  const [newFiles, setNewFiles] = useState<{ file: File; preview: string }[]>([])

  // مزامنة قائمة الملفات الجديدة مع حقل الإدخال الفعلي عبر DataTransfer
  // حتى تُرسل ضمن FormData حتى بعد حذف أحد الملفات.
  useEffect(() => {
    if (!inputRef.current) return
    const dt = new DataTransfer()
    newFiles.forEach((f) => dt.items.add(f.file))
    inputRef.current.files = dt.files
  }, [newFiles])

  function handleAdd(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? [])
    if (!picked.length) return
    setNewFiles((prev) => [...prev, ...picked.map((file) => ({ file, preview: URL.createObjectURL(file) }))])
  }

  return (
    <div className="flex flex-col gap-2">
      <Label>{label}</Label>
      <input type="hidden" name={keptName} value={JSON.stringify(kept.map((k) => k.ref))} readOnly />
      <input
        ref={inputRef}
        type="file"
        name={filesName}
        accept="image/*"
        multiple
        className="hidden"
        onChange={handleAdd}
      />

      <div className="flex flex-wrap gap-2">
        {kept.map((img) => (
          <div key={img.ref} className="relative h-20 w-20 overflow-hidden rounded-md border bg-muted">
            <Image src={img.url || "/placeholder.svg"} alt="" fill className="object-cover" unoptimized />
            <button
              type="button"
              aria-label="حذف الصورة"
              onClick={() => setKept((prev) => prev.filter((k) => k.ref !== img.ref))}
              className="absolute left-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}

        {newFiles.map((img, i) => (
          <div key={img.preview} className="relative h-20 w-20 overflow-hidden rounded-md border bg-muted">
            <Image src={img.preview || "/placeholder.svg"} alt="" fill className="object-cover" unoptimized />
            <button
              type="button"
              aria-label="حذف الصورة"
              onClick={() => setNewFiles((prev) => prev.filter((_, idx) => idx !== i))}
              className="absolute left-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}

        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-md border border-dashed text-muted-foreground transition hover:border-primary hover:text-primary"
        >
          <ImagePlus className="h-5 w-5" />
          <span className="text-[10px]">إضافة صورة</span>
        </button>
      </div>
      <p className="text-xs text-muted-foreground">أضف صوراً من زوايا مختلفة تظهر في معرض صور المنتج.</p>
    </div>
  )
}

/** زر حذف مع نافذة تأكيد. */
export function DeleteButton({
  onConfirm,
  itemLabel,
  disabled,
}: {
  onConfirm: () => void
  itemLabel: string
  disabled?: boolean
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" disabled={disabled}>
          <Trash2 className="h-4 w-4" />
          <span className="sr-only">حذف</span>
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent dir="rtl">
        <AlertDialogHeader>
          <AlertDialogTitle>تأكيد الحذف</AlertDialogTitle>
          <AlertDialogDescription>
            هل أنت متأكد من حذف &quot;{itemLabel}&quot;؟ لا يمكن التراجع عن هذا الإجراء.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>إلغاء</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            حذف
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** تنظيف نص إلى رابط آمن (يدعم العربية) — مطابق لدالة السيرفر. */
export function sanitizeSlug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06FF]+/g, "-")
    .replace(/^-+/, "")
}

/**
 * حقل كتابة رابط (Slug) يدوياً مع معاينة مباشرة للمسار.
 * القيمة تُرسل داخل FormData باسم `name`. اتركه فارغاً ليُشتق تلقائياً من الاسم عند الحفظ.
 */
export function SlugField({
  name = "slug",
  label = "رابط الصفحة",
  basePath,
  defaultValue,
  onGenerate,
}: {
  name?: string
  label?: string
  /** المسار الأساسي المعروض في المعاينة، مثل `/category/` أو `/product/`. */
  basePath: string
  defaultValue?: string
  /** عند تمريرها يظهر زر "توليد الرابط" الذي يعيد سلاجاً جاهزاً. */
  onGenerate?: () => Promise<string>
}) {
  const [value, setValue] = useState(defaultValue ?? "")
  const [generating, setGenerating] = useState(false)

  async function handleGenerate() {
    if (!onGenerate) return
    setGenerating(true)
    try {
      const slug = await onGenerate()
      if (slug) setValue(sanitizeSlug(slug))
    } catch {
      // نتجاهل الخطأ — الرسالة تُعرض من المستدعي عند الحاجة.
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={`slug-${name}`}>{label}</Label>
        {onGenerate ? (
          <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={handleGenerate} disabled={generating}>
            <Sparkles className={`h-3.5 w-3.5 ${generating ? "animate-pulse" : ""}`} />
            {generating ? "جارٍ التوليد..." : "توليد الرابط"}
          </Button>
        ) : null}
      </div>
      <div className="flex items-center gap-1 rounded-md border bg-muted/40 px-2" dir="ltr">
        <span className="shrink-0 text-xs text-muted-foreground">{basePath}</span>
        <Input
          id={`slug-${name}`}
          name={name}
          value={value}
          onChange={(e) => setValue(sanitizeSlug(e.target.value))}
          placeholder="اتركه فارغاً للتوليد التلقائي"
          className="border-0 bg-transparent px-1 font-mono shadow-none focus-visible:ring-0"
        />
      </div>
      <p className="text-xs text-muted-foreground" dir="rtl">
        {onGenerate
          ? "اضغط «توليد الرابط» لإنشاء رابط إنجليزي من القسم والمنتج والبراند، أو اكتبه يدوياً."
          : "هذا هو رابط الصفحة الذي يظهر في المتصفح. اتركه فارغاً ليُنشأ تلقائياً من الاسم."}
      </p>
    </div>
  )
}

/** إدخال قائمة نصية (وسوم) — يُستخدم للكلمات المفتاحية والمقاسات. */
export function TagInput({
  value,
  onChange,
  placeholder = "أضف قيمة واضغط Enter",
}: {
  value: string[]
  onChange: (v: string[]) => void
  placeholder?: string
}) {
  const [draft, setDraft] = useState("")

  function add() {
    const v = draft.trim()
    if (v && !value.includes(v)) onChange([...value, v])
    setDraft("")
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={placeholder}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229) {
              e.preventDefault()
              add()
            }
          }}
        />
        <Button type="button" variant="outline" onClick={add}>
          إضافة
        </Button>
      </div>
      {value.length ? (
        <div className="flex flex-wrap gap-1.5">
          {value.map((tag) => (
            <span
              key={tag}
              className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-foreground"
            >
              {tag}
              <button type="button" onClick={() => onChange(value.filter((t) => t !== tag))}>
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}
