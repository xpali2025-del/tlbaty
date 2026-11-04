import type { AdminAd, AdminBrand, AdminCategory, AdminCoupon, AdminPaymentAccount, AdminReview, AdminSlide } from "@/lib/admin"
import { adoptPreUploads, uploadFormImages, type UploadField } from "@/lib/storage/upload-client"
import { discardPreUpload, markSubmitted } from "@/lib/storage/preupload-registry"
import { extractVideoPoster, uploadAdVideo } from "@/lib/storage/video-client"
import { parseAdForm } from "@/lib/validation/ad"
import { parseBrandForm, parseCategoryForm, parseCouponForm, parseReviewForm, parseSlideForm } from "@/lib/validation/catalog"
import { parseSettingsForm } from "@/lib/validation/settings"
import { num, str } from "@/lib/validation/form"
import { savePaymentAccount, saveAd, saveBrand, saveCategory, saveCoupon, saveReview, saveSettings, saveSlide } from "../client-actions"
import type { ExecResult, SaveJob, ScreenExecutor } from "./core"
import { firstFile, formEntries, live, previewMaker, rebuildForm, releaseLive, type LiveJob } from "./job-runtime"
import { PENDING_PREFIX } from "./product-job"
import { discardJob, getSaveQueue } from "./queue"

// شاشات الحفظ الفوري البسيطة (كلها ما عدا المنتجات): لكل شاشة مواصفة تقول ما حقول رفعها، وكيف يبدو العنصر قبل أن يردّ الخادم،
// وأي إجراء يحفظه. هذه الشاشات تتحدّث قائمتها من إعادة تحميل بياناتها بعد الحفظ، فلا تعيد نسخة العنصر (انظر حالة saved في core.ts).

export type ScreenSpec<T extends { _id: string }> = {
  screen: string
  uploadFields: UploadField[]
  /** العنصر كما سيبدو بعد الحفظ، من النموذج (فُحص بالمحلّل المشترك). `preview(field)` رابط معاينة لأول صورة جديدة في الحقل. */
  optimistic: (form: FormData, existing: T | null, entityId: string, preview: (field: string) => string | undefined) => T
  save: (entityId: string | null, form: FormData) => Promise<unknown>
  /** يسبق الرفع والحفظ عند التنفيذ (مثل رفع فيديو الإعلان). */
  prepare?: (job: SaveJob<T>, form: FormData) => Promise<void>
}

const field = (name: string, folder: UploadField["folder"], keyName: string): UploadField[] => [{ name, folder, keyName }]

const categorySpec: ScreenSpec<AdminCategory> = {
  screen: "categories",
  uploadFields: field("image", "categories", "imageKey"),
  optimistic(form, existing, entityId, preview) {
    const p = parseCategoryForm(form)
    return {
      ...(existing ?? { productCount: 0, subcategories: [] }),
      _id: entityId,
      name: p.name,
      slug: p.slug,
      code: p.code ?? existing?.code,
      description: p.description ?? undefined,
      image: preview("image") ?? existing?.image,
      sortOrder: p.sortOrder,
      metaTitle: p.metaTitle ?? undefined,
      metaDescription: p.metaDescription ?? undefined,
      keywords: p.keywords,
      subcategories: [...p.subcategories].map(([slug, sub]) => ({ name: sub.name, slug, description: sub.description ?? undefined })),
    }
  },
  save: (id, form) => saveCategory(id, form),
}

const brandSpec: ScreenSpec<AdminBrand> = {
  screen: "brands",
  uploadFields: field("image", "brands", "imageKey"),
  optimistic(form, existing, entityId, preview) {
    const p = parseBrandForm(form)
    return {
      ...(existing ?? { productCount: 0 }),
      _id: entityId,
      name: p.name,
      slug: p.slug,
      description: p.description ?? undefined,
      image: preview("image") ?? existing?.image,
      featured: p.featured,
      sortOrder: p.sortOrder,
      metaTitle: p.metaTitle ?? undefined,
      metaDescription: p.metaDescription ?? undefined,
      keywords: p.keywords,
    }
  },
  save: (id, form) => saveBrand(id, form),
}

const slideSpec: ScreenSpec<AdminSlide> = {
  screen: "slides",
  uploadFields: field("image", "slides", "imageKey"),
  optimistic(form, existing, entityId, preview) {
    const p = parseSlideForm(form)
    return { ...existing, _id: entityId, title: p.title, subtitle: p.subtitle ?? undefined, cta: p.cta ?? undefined, href: p.href, image: preview("image") ?? existing?.image, sortOrder: p.sortOrder }
  },
  save: (id, form) => saveSlide(id, form),
}

const couponSpec: ScreenSpec<AdminCoupon> = {
  screen: "coupons",
  uploadFields: [],
  optimistic(form, existing, entityId) {
    const p = parseCouponForm(form)
    return { ...existing, _id: entityId, code: p.code, discount: p.discount, type: p.type, minOrder: p.minOrder, description: p.description }
  },
  save: (id, form) => saveCoupon(id, form),
}

const reviewSpec: ScreenSpec<AdminReview> = {
  screen: "reviews",
  uploadFields: field("avatar", "reviews", "avatarKey"),
  optimistic(form, existing, entityId, preview) {
    const p = parseReviewForm(form)
    return { ...existing, _id: entityId, name: p.name, rating: p.rating, comment: p.comment, date: p.reviewDate, avatar: preview("avatar") ?? existing?.avatar }
  },
  save: (id, form) => saveReview(id, form),
}

const paymentAccountSpec: ScreenSpec<AdminPaymentAccount> = {
  screen: "payment-accounts",
  uploadFields: field("image", "payment-accounts", "imageKey"),
  optimistic(form, existing, entityId, preview) {
    const providerName = str(form, "providerName")
    const accountHolderName = str(form, "accountHolderName")
    const accountNumber = str(form, "accountNumber")
    if (!providerName) throw new Error("اسم مزوّد الدفع مطلوب.")
    if (!accountHolderName) throw new Error("اسم صاحب الحساب مطلوب.")
    if (!accountNumber) throw new Error("رقم الحساب مطلوب.")
    return {
      ...existing,
      _id: entityId,
      providerName,
      accountDisplayName: str(form, "accountDisplayName"),
      accountHolderName,
      accountNumber,
      image: preview("image") ?? existing?.image,
      imageRef: existing?.imageRef,
      instructions: str(form, "instructions"),
      isActive: form.get("isActive") !== "false",
      sortOrder: Math.min(9999, Math.max(0, Math.round(num(form, "sortOrder") ?? 0))),
    }
  },
  save: (id, form) => savePaymentAccount(id, form),
}

const adSpec: ScreenSpec<AdminAd> = {
  screen: "ads",
  uploadFields: field("image", "ads", "imageKey"),
  optimistic(form, existing, entityId, preview) {
    const p = parseAdForm(form)
    return {
      ...existing,
      _id: entityId,
      title: p.title,
      image: preview("image") ?? existing?.image,
      href: p.href ?? undefined,
      active: p.active,
      frequency: p.frequency,
      sortOrder: p.sortOrder,
      categoryIds: p.requestedCategoryIds,
      kind: p.kind,
      videoUrl: p.kind === "video" ? existing?.videoUrl : undefined,
      placements: p.placements,
      startsOn: p.startsOn ?? undefined,
      endsOn: p.endsOn ?? undefined,
    }
  },
  save: (id, form) => saveAd(id, form),
  // فيديو الإعلان: يُنتظر رفعه المسبق (أو يُرفع الآن من الملف المحفوظ في العملية)، وغلافه يُستخرج منه إن لم يختر المدير غلافاً.
  async prepare(job, form) {
    const video = job.entries.find(([name, value]) => name === "video" && typeof value !== "string")?.[1] as File | undefined
    if (!video || form.get("kind") !== "video") return
    const extra = live.get(job.id)?.extra
    let key: string | undefined
    if (extra?.videoPre) {
      key = await extra.videoPre.promise.then(
        (k) => (markSubmitted(extra.videoPre!), k),
        () => undefined,
      )
    }
    form.set("videoKey", key ?? (await uploadAdVideo(video)))
    form.delete("video")
    const hasPoster = firstFile(form, "image")
    const existingImage = (job.optimistic as AdminAd).image
    const cached = (await extra?.posterPromise) ?? null
    if (!hasPoster && !existingImage) {
      form.set("image", cached?.file ?? (await extractVideoPoster(video)))
    } else {
      discardPreUpload(cached) // المدير اختار غلافاً بنفسه: غلاف الفيديو المستخرج لن يُستعمل
    }
  },
}

/** إعدادات المتجر: صف واحد لا قائمة، فلا عنصر متفائل (النموذج نفسه هو ما يراه المدير)؛ العملية تحمل الحقول والشعار فقط. */
const settingsSpec: ScreenSpec<{ _id: string }> = {
  screen: "settings",
  uploadFields: field("logo", "site", "logoKey"),
  optimistic(form, existing, entityId) {
    parseSettingsForm(form)
    return { ...existing, _id: entityId }
  },
  save: (id, form) => saveSettings(id, form),
}

export const SCREEN_SPECS = {
  settings: settingsSpec,
  categories: categorySpec,
  brands: brandSpec,
  slides: slideSpec,
  coupons: couponSpec,
  reviews: reviewSpec,
  "payment-accounts": paymentAccountSpec,
  ads: adSpec,
} as const

export type SimpleScreen = keyof typeof SCREEN_SPECS
type AnyItem = { _id: string }

/** عملية حفظ جديدة من نموذج صالح: تستلم رفعه المسبق وتبني معاينة صوره والعنصر المتفائل. */
export function buildScreenJob<T extends AnyItem>(
  spec: ScreenSpec<T>,
  form: FormData,
  existing: T | null,
  options: { reuseEntityId?: string; extra?: LiveJob["extra"] } = {},
): Omit<SaveJob<T>, "state" | "attempts" | "createdAt"> {
  const id = crypto.randomUUID()
  const entityId = existing?._id ?? options.reuseEntityId ?? `${PENDING_PREFIX}${id}`
  const previews = previewMaker()
  const optimistic = spec.optimistic(form, existing, entityId, (name) => previews.of(firstFile(form, name)))
  live.set(id, { pres: adoptPreUploads(form, spec.uploadFields), previews: previews.urls, extra: options.extra })
  return { id, screen: spec.screen, entityId, label: (optimistic as { name?: string; title?: string; code?: string; providerName?: string }).name ?? (optimistic as { title?: string }).title ?? (optimistic as { code?: string }).code ?? (optimistic as { providerName?: string }).providerName ?? "", requestId: crypto.randomUUID(), entries: formEntries(form), optimistic }
}

/** منفّذ شاشة بسيطة: يبني النموذج من العملية، يجهّزه (إن لزم)، ينتظر الرفع، ثم يرسل الحفظ بمعرّف العملية الثابت. */
export function screenExecutor<T extends AnyItem>(spec: ScreenSpec<T>): ScreenExecutor<T> {
  return {
    async execute(job: SaveJob<T>): Promise<ExecResult<T>> {
      const form = rebuildForm(job.id, job.entries, job.requestId)
      await spec.prepare?.(job, form)
      await uploadFormImages(form, spec.uploadFields)
      await spec.save(job.entityId.startsWith(PENDING_PREFIX) ? null : job.entityId, form)
      return { status: "saved" }
    },
    onSaved: (job) => releaseLive(job.id),
  }
}


/** الحفظ الفوري من نموذج: يضيف العملية للطابور (تستبدل عملية فاشلة لنفس العنصر إن وُجدت). تُستدعى بعد نجاح التحقق في المتصفح. */
export function enqueueScreenSave<T extends AnyItem>(
  spec: ScreenSpec<T>,
  form: FormData,
  existing: T | null,
  replaceJob: SaveJob<T> | null,
  extra?: LiveJob["extra"],
) {
  const input = buildScreenJob(spec, form, existing, { extra })
  if (replaceJob) discardJob(replaceJob)
  getSaveQueue().enqueue(input as never)
}
