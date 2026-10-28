import { ALLOWED_IMAGE_TYPES, MAX_IMAGE_BYTES, type ImageFolder } from "./keys"

// رفع الصور من المتصفح مباشرة إلى R2 (بروابط موقَّعة) قبل إرسال النموذج إلى Server Action.
// لا تمر الملفات عبر الخادم (حد حجم الطلب في Server Actions) ويصل للإجراء مفاتيحها فقط.
// يستورد الإجراء بشكل متأخر حتى تبقى الوحدة قابلة للاختبار بدون خادم.

export type UploadField = {
  /** اسم حقل الملف في النموذج (input type="file"). */
  name: string
  folder: ImageFolder
  /** اسم الحقل الذي يستقبل المفتاح (أو مصفوفة JSON للمفاتيح عند multiple). */
  keyName: string
  multiple?: boolean
}

export type UploadDeps = {
  /** تصغير/ضغط الصورة قبل الرفع (افتراضياً في المتصفح فقط). يعيد الملف نفسه إن لم يُفد الضغط. */
  prepare?: (file: File, folder: ImageFolder) => Promise<File>
  request: (folder: string, contentType: string, size: number) => Promise<{ uploadUrl: string; objectKey: string }>
  /**
   * طلب روابط عدة ملفات دفعة واحدة (نداء خادم واحد بدل نداء لكل صورة: نداءات الإجراءات تُنفَّذ بالتتابع).
   * إن غاب نستعمل request لكل ملف.
   */
  requestBatch?: (items: { folder: string; contentType: string; size: number }[]) => Promise<{ uploadUrl: string; objectKey: string }[]>
  put: (uploadUrl: string, file: File) => Promise<void>
}

const PUT_ATTEMPTS = 3

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** رفع PUT مع إعادة محاولة لأخطاء الشبكة و5xx (شبكة الجوال تقطع أحياناً)؛ أخطاء 4xx (CORS/توقيع) لا تُعاد. */
const defaultPut: UploadDeps["put"] = async (uploadUrl, file) => {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": file.type } })
      if (res.ok) return
      if (res.status < 500 || attempt >= PUT_ATTEMPTS) throw new Error("فشل رفع الصورة إلى التخزين، تحقق من إعدادات CORS للـ bucket")
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("فشل رفع الصورة")) throw error
      if (attempt >= PUT_ATTEMPTS) throw new Error("انقطع الاتصال أثناء رفع الصورة، تحقق من الشبكة وأعد المحاولة")
    }
    await sleep(400 * attempt)
  }
}

/** ينفّذ المهام بتوازٍ محدود ويحفظ ترتيب النتائج؛ عند أول فشل يتوقف عن بدء مهام جديدة ويرمي الخطأ. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  let failed = false
  const worker = async () => {
    while (!failed && next < items.length) {
      const i = next++
      try {
        out[i] = await fn(items[i], i)
      } catch (error) {
        failed = true
        throw error
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

/** عدد الصور التي تُضغط معاً (ترميز الصور الكبيرة ثقيل على الذاكرة في الجوال) وعدد الرفوعات المتزامنة. */
const PREPARE_CONCURRENCY = 2
const UPLOAD_CONCURRENCY = 4

/** أقصى بعد (بكسل) لكل مجلد: كافٍ للعرض على الشاشات الكبيرة (2x) ولا يرفع صور هاتف 12 ميغابكسل كما هي. */
const MAX_DIMENSION: Record<ImageFolder, number> = {
  products: 1600,
  slides: 1920,
  ads: 1600,
  categories: 800,
  brands: 600,
  reviews: 400,
  "payment-accounts": 400,
  couriers: 600,
  notifications: 1200,
  site: 800,
}

/** لا نمسّ ما هو صغير أصلاً أو بصيغة لا تُعاد ترميزها بأمان (AVIF متحرك/GIF/SVG). */
const SKIP_BELOW_BYTES = 200 * 1024
const RECODABLE = new Set(["image/jpeg", "image/png", "image/webp"])

/**
 * يصغّر الصورة إلى الحد الأقصى للمجلد ويرمّزها WebP (جودة 0.82) قبل الرفع. صور الهاتف الأصلية بحجم 3–5 ميغابايت
 * تصبح عادةً 100–300 كيلوبايت: صفحات أسرع بكثير وتخزين ونقل أقل. يُستعمل الأصل إن لم يصغر الناتج.
 */
export async function compressImage(file: File, folder: ImageFolder): Promise<File> {
  if (typeof document === "undefined" || typeof createImageBitmap === "undefined") return file
  if (!RECODABLE.has(file.type) || file.size < SKIP_BELOW_BYTES) return file
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" })
    const max = MAX_DIMENSION[folder]
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement("canvas")
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const ctx = canvas.getContext("2d")
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close?.()
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.82))
    if (!blob || blob.type !== "image/webp" || blob.size >= file.size) return file
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".webp", { type: "image/webp" })
  } catch {
    return file
  }
}

async function defaultRequest(folder: string, contentType: string, size: number) {
  const { requestImageUpload } = await import("@/app/manage/upload-actions")
  return requestImageUpload(folder, contentType, size)
}

async function defaultRequestBatch(items: { folder: string; contentType: string; size: number }[]) {
  const { requestImageUploads } = await import("@/app/manage/upload-actions")
  return requestImageUploads(items)
}

const MAX_INPUT_BYTES = 20 * 1024 * 1024

function validate(file: File) {
  if (!ALLOWED_IMAGE_TYPES[file.type]) throw new Error(`نوع الصورة غير مدعوم (${file.name}): استخدم JPEG أو PNG أو WebP أو AVIF`)
  // الصورة تُضغط قبل الرفع، فنقبل الأصل الكبير (صور الهاتف) والحد الفعلي يُفحص على الناتج.
  if (file.size > MAX_INPUT_BYTES) throw new Error(`حجم الصورة يتجاوز ${MAX_INPUT_BYTES / 1024 / 1024} ميغابايت (${file.name})`)
}

/**
 * يرفع كل ملفات الصور في النموذج ثم يستبدلها بمفاتيحها. الحقول الفارغة لا تُمَسّ،
 * فيحتفظ الخادم بالصورة الحالية. يتحقق من كل الملفات قبل رفع أي منها.
 * ملاحظة: عند فشل الحفظ بعد الرفع قد يبقى كائن يتيم في R2 (لا يظهر في الموقع).
 */
export async function uploadFormImages(
  form: FormData,
  fields: UploadField[],
  deps: UploadDeps = { prepare: compressImage, request: defaultRequest, requestBatch: defaultRequestBatch, put: defaultPut },
): Promise<string[]> {
  const pending = fields.map((f) => ({
    field: f,
    files: form.getAll(f.name).filter((v): v is File => v instanceof File && v.size > 0),
  }))
  for (const { field, files } of pending) {
    form.delete(field.name) // لا نرسل الملفات الخام إلى الخادم أبداً
    for (const file of files) validate(file)
    if (!field.multiple && files.length > 1) throw new Error("اختر صورة واحدة فقط")
  }

  // كل الملفات عبر كل الحقول بترتيبها: نضغطها (بتوازٍ محدود)، ثم نطلب كل الروابط بنداء واحد، ثم نرفعها بالتوازي.
  const jobs = pending.flatMap(({ field, files }) => files.map((original) => ({ field, original })))
  if (jobs.length === 0) return []

  const prepared = await mapLimit(jobs, PREPARE_CONCURRENCY, async ({ field, original }) => {
    const file = deps.prepare ? await deps.prepare(original, field.folder) : original
    if (file.size > MAX_IMAGE_BYTES) throw new Error(`حجم الصورة بعد الضغط ما زال يتجاوز ${MAX_IMAGE_BYTES / 1024 / 1024} ميغابايت (${original.name})`)
    return file
  })

  const items = prepared.map((file, i) => ({ folder: jobs[i].field.folder, contentType: file.type, size: file.size }))
  const slots = deps.requestBatch
    ? await deps.requestBatch(items)
    : await Promise.all(items.map((it) => deps.request(it.folder, it.contentType, it.size)))
  if (slots.length !== prepared.length) throw new Error("تعذّر تجهيز روابط الرفع، أعد المحاولة")

  await mapLimit(prepared, UPLOAD_CONCURRENCY, (file, i) => deps.put(slots[i].uploadUrl, file))

  const uploaded: string[] = []
  for (const { field } of pending) {
    const keys = jobs.flatMap((j, i) => (j.field === field ? [slots[i].objectKey] : []))
    if (!keys.length) continue
    form.set(field.keyName, field.multiple ? JSON.stringify(keys) : keys[0])
    uploaded.push(...keys)
  }
  return uploaded
}
