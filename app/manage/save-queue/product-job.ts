import type { AdminBrand, AdminCategory, AdminProduct } from "@/lib/admin"
import { adoptPreUploads, uploadFormImages, type UploadField } from "@/lib/storage/upload-client"
import { parseProductForm } from "@/lib/validation/product"
import { json } from "@/lib/validation/form"
import { saveProduct } from "../client-actions"
import type { ExecResult, SaveJob, ScreenExecutor } from "./core"
import { formEntries, live, previewMaker, rebuildForm, releaseLive, firstFile } from "./job-runtime"

// حفظ المنتج عبر الطابور: بناء العملية من النموذج، والعنصر المتفائل الذي يظهر في القائمة، وتنفيذ الحفظ.

export const PRODUCT_SCREEN = "products"
export const PENDING_PREFIX = "pending-"
export const isPendingId = (id: string) => id.startsWith(PENDING_PREFIX)

export const PRODUCT_UPLOAD_FIELDS: UploadField[] = [
  { name: "image", folder: "products", keyName: "imageKey" },
  { name: "newImages", folder: "products", keyName: "newImageKeys", multiple: true },
]

export type ProductJob = SaveJob<AdminProduct>

/**
 * المنتج كما سيبدو بعد الحفظ، من النموذج نفسه: اسمه وسعره وصوره (معاينة محلية للجديدة) وأقسامه.
 * رقم النسخة يبقى كما رآه المدير، وحقول الخادم وحده (رقم المنتج، التقييم، الوسوم) تبقى من النسخة الحالية.
 */
export function optimisticProduct(
  form: FormData,
  existing: AdminProduct | null,
  ctx: { categories: AdminCategory[]; brands: AdminBrand[]; entityId: string },
  previews: { main?: string; gallery: { url: string; ref: string }[] },
): AdminProduct {
  const parsed = parseProductForm(form)
  const category = ctx.categories.find((c) => c._id === parsed.categoryId)
  const brand = ctx.brands.find((b) => b._id === parsed.brandId)
  const kept = new Set(json<string[]>(form, "keptImages", []))
  const keptImages = (existing?.images ?? []).filter((img) => kept.has(img.ref))
  const variants = parsed.trackVariants ? parsed.variants.map(({ color, size, stock }) => ({ color, size, stock })) : []
  return {
    ...(existing ?? { images: [], colors: [], sizes: [], variants: [], version: 0 }),
    _id: ctx.entityId,
    name: parsed.name,
    slug: parsed.slug,
    description: parsed.fields.description,
    price: parsed.price,
    oldPrice: parsed.fields.oldPrice ?? undefined,
    categoryId: parsed.categoryId,
    categoryName: category?.name ?? existing?.categoryName,
    categorySlug: category?.slug ?? existing?.categorySlug,
    subcategory: parsed.subSlug,
    brandId: parsed.brandId ?? undefined,
    brandName: brand?.name,
    image: previews.main ?? existing?.image,
    images: [...keptImages, ...previews.gallery],
    stock: parsed.trackVariants ? variants.reduce((sum, v) => sum + v.stock, 0) : parsed.fields.stock,
    isNew: parsed.isNew,
    isBestseller: parsed.isBestseller,
    badge: parsed.fields.badge ?? undefined,
    sortOrder: parsed.fields.sortOrder,
    sku: parsed.fields.sku ?? undefined,
    metaTitle: parsed.fields.metaTitle ?? undefined,
    metaDescription: parsed.fields.metaDescription ?? undefined,
    keywords: parsed.fields.keywords,
    colors: parsed.colors,
    sizes: parsed.sizeList,
    variants,
    sizeChartId: parsed.sizeChartId ?? undefined,
    customSizeChart: parsed.customSizeChart ?? undefined,
  }
}

/** عملية حفظ جديدة للمنتج من نموذج صالح (فُحص بالمحلّل المشترك). تستلم رفعه المسبق وتبني معاينة صوره. */
export function buildProductJob(
  form: FormData,
  existing: AdminProduct | null,
  ctx: { categories: AdminCategory[]; brands: AdminBrand[] },
  reuse?: { entityId: string },
): Omit<ProductJob, "state" | "attempts" | "createdAt"> {
  const id = crypto.randomUUID()
  const entityId = existing?._id ?? reuse?.entityId ?? `${PENDING_PREFIX}${id}`
  if (existing) form.set("expectedVersion", String(existing.version))

  const preview = previewMaker()
  const gallery = form.getAll("newImages").filter((f): f is File => f instanceof File && f.size > 0)
  const optimistic = optimisticProduct(
    form,
    existing,
    { ...ctx, entityId },
    {
      main: preview.of(firstFile(form, "image")),
      gallery: gallery.map((file) => ({ url: preview.of(file) as string, ref: `preview:${id}:${file.name}` })),
    },
  )
  live.set(id, { pres: adoptPreUploads(form, PRODUCT_UPLOAD_FIELDS), previews: preview.urls })
  return {
    id,
    screen: PRODUCT_SCREEN,
    entityId,
    label: optimistic.name,
    requestId: crypto.randomUUID(),
    entries: formEntries(form),
    optimistic,
  }
}

export const releaseProductJob = releaseLive

/** ينفّذ الحفظ: يبني النموذج من العملية، ينتظر ما لم يكتمل من رفع الصور، ثم يرسل الحفظ بمعرّف العملية الثابت. */
export async function executeProductJob(job: ProductJob): Promise<ExecResult<AdminProduct>> {
  // رفع مسبق بدأ قبل إغلاق النافذة: يُعاد تسجيله (أُزيل مع حقل الصورة) فيستعمله الرفع بدل أن يبدأ من جديد.
  const form = rebuildForm(job.id, job.entries, job.requestId)
  await uploadFormImages(form, PRODUCT_UPLOAD_FIELDS)
  const result = await saveProduct(isPendingId(job.entityId) ? null : job.entityId, form)
  if (result.status === "conflict") return { status: "conflict", current: result.current }
  return { status: "saved", item: result.item }
}

/** العمليات اللاحقة لنفس المنتج بُنيت فوق نسخته المتفائلة: تنتقل إلى نسخته المحفوظة فلا يظهر تعارض كاذب. */
export function rebaseProductJob(job: ProductJob, saved: AdminProduct): ProductJob {
  const entries = job.entries.filter(([name]) => name !== "expectedVersion")
  entries.push(["expectedVersion", String(saved.version)])
  return {
    ...job,
    // منتج جديد لم يكن محفوظاً حين بُنيت هذه العملية: صار الآن موجوداً، فتُحفظ كتعديل عليه.
    entityId: isPendingId(job.entityId) ? saved._id : job.entityId,
    entries,
    optimistic: { ...job.optimistic, _id: saved._id, version: saved.version },
  }
}

export function productExecutor(onSaved: (item: AdminProduct) => void): ScreenExecutor<AdminProduct> {
  return {
    execute: executeProductJob,
    rebase: rebaseProductJob,
    onSaved: (job, saved) => {
      releaseProductJob(job.id)
      if (saved) onSaved(saved)
    },
  }
}
