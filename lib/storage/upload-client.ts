import { ALLOWED_IMAGE_TYPES, MAX_IMAGE_BYTES, type ImageFolder } from "./keys"
import { putImage, uploadConcurrency, waitUntilOnline } from "./upload-transport"

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
  put: (uploadUrl: string, file: File, options?: { onTimeout?: () => void }) => Promise<void>
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
  const results = await Promise.allSettled(Array.from({ length: Math.min(limit, items.length) }, worker))
  const rejected = results.find((result) => result.status === "rejected")
  if (rejected?.status === "rejected") throw rejected.reason
  return out
}

/** عدد الصور التي تُضغط معاً (ترميز الصور الكبيرة ثقيل على الذاكرة في الجوال) وعدد الرفوعات المتزامنة. */
const PREPARE_CONCURRENCY = 2
const MAX_FALLBACK_BYTES = 1.5 * 1024 * 1024

/** أقصى بعد (بكسل) لكل مجلد: كافٍ للعرض على الشاشات الكبيرة (2x) ولا يرفع صور هاتف 12 ميغابكسل كما هي. */
const MAX_DIMENSION: Record<ImageFolder, number> = {
  products: 1200,
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
const WEBP_QUALITY = 0.82
const WORKER_TIMEOUT_MS = 45_000

type WorkerResponse =
  | { success: true; blob: Blob }
  | { success: false; error: string }

function optimizedFile(blob: Blob): File {
  const timestamp = Date.now()
  const randomSuffix = Math.floor(1000 + Math.random() * 9000)
  return new File([blob], `tarafstore-${timestamp}-${randomSuffix}.webp`, {
    type: "image/webp",
    lastModified: timestamp,
  })
}

async function compressInWorker(file: File, maxDimension: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./image-compressor.worker.ts", import.meta.url), { type: "module" })
    const timer = window.setTimeout(() => {
      worker.terminate()
      reject(new Error("انتهت مهلة ضغط الصورة"))
    }, WORKER_TIMEOUT_MS)
    const finish = () => {
      window.clearTimeout(timer)
      worker.terminate()
    }

    worker.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
      finish()
      if (data.success) resolve(data.blob)
      else reject(new Error(data.error))
    }
    worker.onerror = () => {
      finish()
      reject(new Error("تعذّر تشغيل عامل ضغط الصور"))
    }
    worker.postMessage({ file, maxDimension, quality: WEBP_QUALITY })
  })
}

async function loadImage(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; cleanup: () => void }> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" })
    return { source: bitmap, width: bitmap.width, height: bitmap.height, cleanup: () => bitmap.close() }
  }

  const objectUrl = URL.createObjectURL(file)
  const image = new Image()
  image.crossOrigin = "anonymous"
  image.src = objectUrl
  try {
    await image.decode()
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, cleanup: () => URL.revokeObjectURL(objectUrl) }
  } catch (error) {
    URL.revokeObjectURL(objectUrl)
    throw error
  }
}

async function compressOnMainThread(file: File, maxDimension: number): Promise<Blob | null> {
  const image = await loadImage(file)
  try {
    const scale = Math.min(1, maxDimension / Math.max(image.width, image.height))
    const canvas = document.createElement("canvas")
    canvas.width = Math.max(1, Math.round(image.width * scale))
    canvas.height = Math.max(1, Math.round(image.height * scale))
    const context = canvas.getContext("2d")
    if (!context) return null
    context.drawImage(image.source, 0, 0, canvas.width, canvas.height)
    return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", WEBP_QUALITY))
  } finally {
    image.cleanup()
  }
}

/**
 * يصغّر الصورة ويرمّزها WebP خارج خيط الواجهة عند دعم المتصفح، مع Canvas احتياطي للمتصفحات القديمة.
 * يُستعمل الأصل إذا فشل التحويل أو لم يكن الناتج أصغر، فلا يمنع فشل التحسين حفظ المنتج.
 */
export async function compressImage(file: File, folder: ImageFolder): Promise<File> {
  if (typeof window === "undefined" || !RECODABLE.has(file.type) || file.size < SKIP_BELOW_BYTES) return file

  try {
    const maxDimension = MAX_DIMENSION[folder]
    const supportsWorkerCompression =
      typeof Worker !== "undefined" && typeof OffscreenCanvas !== "undefined" && typeof createImageBitmap === "function"
    const blob = supportsWorkerCompression
      ? await compressInWorker(file, maxDimension).catch(() => compressOnMainThread(file, maxDimension))
      : await compressOnMainThread(file, maxDimension)

    if (!blob || blob.type !== "image/webp" || blob.size >= file.size) return file
    return optimizedFile(blob)
  } catch {
    return file
  }
}

async function defaultRequest(folder: string, contentType: string, size: number) {
  const { requestImageUpload } = await import("@/app/manage/client-actions")
  return requestImageUpload(folder, contentType, size)
}

async function defaultRequestBatch(items: { folder: string; contentType: string; size: number }[]) {
  const { requestImageUploads } = await import("@/app/manage/client-actions")
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
  deps: UploadDeps = { prepare: compressImage, request: defaultRequest, requestBatch: defaultRequestBatch, put: putImage },
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

  // نضغط الملفات بترتيب الحقول، ثم نوقّع روابط كل دفعة عند جاهزيتها للرفع لتجنّب انتهاء صلاحيتها أثناء الانتظار.
  const jobs = pending.flatMap(({ field, files }) => files.map((original) => ({ field, original })))
  if (jobs.length === 0) return []

  const prepared = await mapLimit(jobs, PREPARE_CONCURRENCY, async ({ field, original }) => {
    const file = deps.prepare ? await deps.prepare(original, field.folder) : original
    if (file.size > MAX_IMAGE_BYTES) throw new Error(`حجم الصورة بعد الضغط ما زال يتجاوز ${MAX_IMAGE_BYTES / 1024 / 1024} ميغابايت (${original.name})`)
    if (deps.prepare && file.size >= original.size && file.size > MAX_FALLBACK_BYTES) {
      throw new Error(`تعذّر ضغط الصورة (${original.name}). جرّب صورة أصغر أو صيغة JPEG أو WebP.`)
    }
    return file
  })

  const items = prepared.map((file, i) => ({ folder: jobs[i].field.folder, contentType: file.type, size: file.size }))
  const slots: { uploadUrl: string; objectKey: string }[] = []
  const maxConcurrency = uploadConcurrency()
  let concurrency = maxConcurrency
  for (let offset = 0; offset < items.length;) {
    await waitUntilOnline()
    const batch = items.slice(offset, offset + concurrency)
    const signed = deps.requestBatch
      ? await deps.requestBatch(batch)
      : await Promise.all(batch.map((it) => deps.request(it.folder, it.contentType, it.size)))
    if (signed.length !== batch.length) throw new Error("تعذّر تجهيز روابط الرفع، أعد المحاولة")
    slots.push(...signed)
    let timedOut = false
    await mapLimit(batch, concurrency, (_, i) => deps.put(signed[i].uploadUrl, prepared[offset + i], {
      onTimeout: () => { timedOut = true },
    }))
    concurrency = timedOut ? Math.max(1, Math.floor(concurrency / 2)) : Math.min(maxConcurrency, concurrency + 1)
    offset += batch.length
  }

  const uploaded: string[] = []
  for (const { field } of pending) {
    const keys = jobs.flatMap((j, i) => (j.field === field ? [slots[i].objectKey] : []))
    if (!keys.length) continue
    form.set(field.keyName, field.multiple ? JSON.stringify(keys) : keys[0])
    uploaded.push(...keys)
  }
  return uploaded
}
