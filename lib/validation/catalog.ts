import { isCategoryCode } from "@/lib/product-code"
import { bool, json, num, slugify, str } from "./form"

// قواعد الأقسام والماركات والسلايدر والكوبونات والتقييمات التي لا تحتاج قاعدة بيانات.
// يستدعيها الإجراء في الخادم والنموذج في المتصفح (قبل رفع الصور)، فالقاعدة واحدة في المكانين.

export type ParsedCategoryForm = {
  name: string
  slug: string
  code?: string
  description: string | null
  sortOrder: number
  metaTitle: string | null
  metaDescription: string | null
  keywords: string[]
  /** الأقسام الفرعية بعد التنظيف: السلاج الفرعي فريد داخل القسم؛ عند تكراره في النموذج يفوز آخر إدخال. */
  subcategories: Map<string, { name: string; description: string | null }>
}

export function parseCategoryForm(form: FormData): ParsedCategoryForm {
  const name = str(form, "name")
  if (!name) throw new Error("اسم القسم مطلوب")
  const subcategories = new Map<string, { name: string; description: string | null }>()
  for (const s of json<{ name: string; slug?: string; description?: string }[]>(form, "subcategories", [])) {
    if (!s?.name?.trim()) continue
    subcategories.set(slugify(s.slug || s.name), { name: s.name.trim(), description: s.description?.trim() || null })
  }
  const codeRaw = str(form, "code")?.toUpperCase()
  if (codeRaw && !isCategoryCode(codeRaw)) throw new Error("رمز القسم: 2 إلى 4 أحرف إنجليزية (ورقم اختياري في الآخر)، مثل DR")
  return {
    name,
    slug: slugify(str(form, "slug") ?? name),
    ...(codeRaw ? { code: codeRaw } : {}),
    description: str(form, "description") ?? null,
    sortOrder: Math.max(0, Math.trunc(num(form, "sortOrder") ?? 0)),
    metaTitle: str(form, "metaTitle") ?? null,
    metaDescription: str(form, "metaDescription") ?? null,
    keywords: json<string[]>(form, "keywords", []),
    subcategories,
  }
}

export function parseBrandForm(form: FormData) {
  const name = str(form, "name")
  if (!name) throw new Error("اسم البراند مطلوب")
  return {
    name,
    slug: slugify(str(form, "slug") ?? name),
    description: str(form, "description") ?? null,
    featured: bool(form, "featured"),
    sortOrder: Math.max(0, Math.trunc(num(form, "sortOrder") ?? 0)),
    metaTitle: str(form, "metaTitle") ?? null,
    metaDescription: str(form, "metaDescription") ?? null,
    keywords: json<string[]>(form, "keywords", []),
  }
}

export function parseSlideForm(form: FormData) {
  const title = str(form, "title")
  if (!title) throw new Error("عنوان السلايد مطلوب")
  return {
    title,
    subtitle: str(form, "subtitle") ?? null,
    cta: str(form, "cta") ?? null,
    href: str(form, "href") ?? "/",
    sortOrder: Math.trunc(num(form, "sortOrder") ?? 0),
  }
}

export function parseCouponForm(form: FormData) {
  const code = str(form, "code")
  const discount = num(form, "discount")
  const description = str(form, "description")
  const type = str(form, "type") === "percent" ? "percent" : "fixed"
  if (!code) throw new Error("كود الخصم مطلوب")
  if (discount === undefined) throw new Error("قيمة الخصم مطلوبة")
  if (discount < 0) throw new Error("قيمة الخصم لا يمكن أن تكون سالبة")
  if (type === "percent" && discount > 100) throw new Error("نسبة الخصم لا يمكن أن تتجاوز 100%")
  if (!description) throw new Error("وصف الكوبون مطلوب")
  return {
    code: code.toUpperCase(),
    discount,
    type,
    minOrder: Math.max(0, num(form, "minOrder") ?? 0),
    description,
  } as const
}

export function parseReviewForm(form: FormData) {
  const name = str(form, "name")
  const comment = str(form, "comment")
  const rating = num(form, "rating") ?? 5
  if (!name) throw new Error("اسم العميل مطلوب")
  if (!comment) throw new Error("نص التقييم مطلوب")
  const date = str(form, "date") ?? new Date().toISOString().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("تاريخ غير صالح")
  return { name, comment, rating: Math.min(5, Math.max(1, Math.round(rating))), reviewDate: date }
}
