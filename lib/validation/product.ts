import { parseSizeChart, validateSizeChart, type SizeChart } from "@/lib/size-chart"
import { bool, json, num, slugify, str, uuidParam } from "./form"

// قواعد حفظ المنتج التي لا تحتاج قاعدة بيانات. يستدعيها الخادم (الإجراء) والمتصفح (قبل رفع الصور)،
// فلا يُقبل مدخل في أحدهما ويُرفض في الآخر. فحوص الوجود (القسم/البراند/جدول المقاسات) تبقى في الخادم.

const HEX = /^#[0-9a-fA-F]{6}$/

export type ProductVariantInput = { color: string; size: string; stock: number; base: number | undefined }

export type ParsedProductForm = {
  name: string
  categoryId: string
  price: number
  subSlug: string | undefined
  brandId: string | null
  slug: string
  colors: { name: string; hex: string }[]
  sizeList: string[]
  trackVariants: boolean
  variants: ProductVariantInput[]
  sizeChartId: string | null
  customSizeChart: SizeChart | null
  isNew: boolean
  isBestseller: boolean
  stockBase: number | undefined
  fields: {
    description: string
    oldPrice: number | null
    stock: number
    badge: string | null
    sortOrder: number
    sku: string | null
    metaTitle: string | null
    metaDescription: string | null
    keywords: string[]
  }
}

/** يرمي Error برسالة عربية عند أول خطأ، ويعيد القيم المنظَّفة. */
export function parseProductForm(form: FormData): ParsedProductForm {
  const name = str(form, "name")
  const categoryRaw = str(form, "categoryId")
  const price = num(form, "price")
  if (!name) throw new Error("اسم المنتج مطلوب")
  if (!categoryRaw) throw new Error("اختر القسم الرئيسي للمنتج")
  if (price === undefined) throw new Error("أدخل سعراً صحيحاً")
  if (price < 0) throw new Error("السعر لا يمكن أن يكون سالباً")
  const categoryId = uuidParam(categoryRaw, "القسم غير صالح")

  const subSlug = str(form, "subcategory")
  const brandId = str(form, "brandId") ? uuidParam(str(form, "brandId"), "البراند غير صالح") : null
  const slug = slugify(str(form, "slug") ?? name)

  const colors = json<{ name: string; hex: string }[]>(form, "colors", []).map((c) => {
    if (!c?.name?.trim() || !HEX.test(c.hex ?? "")) throw new Error("لون غير صالح: الاسم مطلوب واللون بصيغة #RRGGBB")
    return { name: c.name.trim(), hex: c.hex }
  })
  // نفس القائمة (بعد الحذف وإزالة الفارغ والمكرر) للمنتج ولمخزون المقاسات، وإلا لم يطابق مقاس « M» صف «M» عند الطلب.
  const sizeList = [...new Set(json<string[]>(form, "sizes", []).map((x) => String(x).trim()).filter(Boolean))]
  // مخزون كل لون/مقاس (اختياري): كل تركيبة يجب أن تكون من ألوان ومقاسات المنتج نفسه، بلا تكرار.
  const trackVariants = bool(form, "trackVariants")
  const variantInput = trackVariants ? json<{ color?: string; size?: string; stock?: number; base?: number }[]>(form, "variants", []) : []
  const variants = new Map<string, ProductVariantInput>()
  for (const v of variantInput) {
    const color = String(v.color ?? "").trim()
    const size = String(v.size ?? "").trim()
    if (color && !colors.some((c) => c.name === color)) throw new Error(`اللون "${color}" ليس من ألوان المنتج`)
    if (size && !sizeList.includes(size)) throw new Error(`المقاس "${size}" ليس من مقاسات المنتج`)
    const stock = Math.trunc(Number(v.stock))
    if (!Number.isFinite(stock) || stock < 0 || stock > 1_000_000) throw new Error("كمية المخزون لكل لون/مقاس يجب أن تكون عدداً صحيحاً من 0 إلى 1,000,000")
    const baseRaw = v.base === undefined || v.base === null ? undefined : Math.trunc(Number(v.base))
    const key = `${color}\u0000${size}`
    if (variants.has(key)) throw new Error("تركيبة لون/مقاس مكررة")
    variants.set(key, { color, size, stock, base: baseRaw !== undefined && Number.isFinite(baseRaw) && baseRaw >= 0 ? baseRaw : undefined })
  }
  if (trackVariants && variants.size === 0) throw new Error("أضف ألواناً أو مقاسات لتتبع مخزونها، أو أوقف تتبع المخزون حسب اللون والمقاس")
  // دليل المقاسات (اختياري): none | chart (جدول مشترك) | custom (خاص بهذا المنتج).
  const guide = json<{ mode?: string; chartId?: string; custom?: unknown }>(form, "sizeGuide", { mode: "none" })
  let sizeChartId: string | null = null
  let customSizeChart: SizeChart | null = null
  if (guide.mode === "chart") {
    sizeChartId = uuidParam(guide.chartId, "جدول المقاسات غير صالح")
  } else if (guide.mode === "custom") {
    customSizeChart = parseSizeChart(guide.custom)
    const problem = customSizeChart ? validateSizeChart(customSizeChart) : "بيانات جدول المقاسات غير صالحة"
    if (problem) throw new Error(problem)
  }

  const stockBaseRaw = num(form, "stockBase")
  return {
    name,
    categoryId,
    price,
    subSlug,
    brandId,
    slug,
    colors,
    sizeList,
    trackVariants,
    variants: [...variants.values()],
    sizeChartId,
    customSizeChart,
    isNew: bool(form, "isNew"),
    isBestseller: bool(form, "isBestseller"),
    stockBase: stockBaseRaw === undefined ? undefined : Math.max(0, Math.trunc(stockBaseRaw)),
    fields: {
      description: str(form, "description") ?? "",
      oldPrice: num(form, "oldPrice") ?? null,
      stock: Math.max(0, Math.trunc(num(form, "stock") ?? 0)),
      badge: str(form, "badge") ?? null,
      sortOrder: Math.trunc(num(form, "sortOrder") ?? 0),
      sku: str(form, "sku") ?? null,
      metaTitle: str(form, "metaTitle") ?? null,
      metaDescription: str(form, "metaDescription") ?? null,
      keywords: json<string[]>(form, "keywords", []),
    },
  }
}
