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
  put: (uploadUrl: string, file: File) => Promise<void>
}

const defaultPut: UploadDeps["put"] = async (uploadUrl, file) => {
  const res = await fetch(uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": file.type } })
  if (!res.ok) throw new Error("فشل رفع الصورة إلى التخزين، تحقق من إعدادات CORS للـ bucket")
}

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
  deps: UploadDeps = { prepare: compressImage, request: defaultRequest, put: defaultPut },
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

  const uploaded: string[] = []
  for (const { field, files } of pending) {
    const keys: string[] = []
    for (const original of files) {
      const file = deps.prepare ? await deps.prepare(original, field.folder) : original
      if (file.size > MAX_IMAGE_BYTES) throw new Error(`حجم الصورة بعد الضغط ما زال يتجاوز ${MAX_IMAGE_BYTES / 1024 / 1024} ميغابايت (${original.name})`)
      const { uploadUrl, objectKey } = await deps.request(field.folder, file.type, file.size)
      await deps.put(uploadUrl, file)
      keys.push(objectKey)
    }
    if (!keys.length) continue
    form.set(field.keyName, field.multiple ? JSON.stringify(keys) : keys[0])
    uploaded.push(...keys)
  }
  return uploaded
}
