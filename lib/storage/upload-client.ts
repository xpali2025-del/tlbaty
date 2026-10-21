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
  request: (folder: string, contentType: string, size: number) => Promise<{ uploadUrl: string; objectKey: string }>
  put: (uploadUrl: string, file: File) => Promise<void>
}

const defaultPut: UploadDeps["put"] = async (uploadUrl, file) => {
  const res = await fetch(uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": file.type } })
  if (!res.ok) throw new Error("فشل رفع الصورة إلى التخزين، تحقق من إعدادات CORS للـ bucket")
}

async function defaultRequest(folder: string, contentType: string, size: number) {
  const { requestImageUpload } = await import("@/app/manage/upload-actions")
  return requestImageUpload(folder, contentType, size)
}

function validate(file: File) {
  if (!ALLOWED_IMAGE_TYPES[file.type]) throw new Error(`نوع الصورة غير مدعوم (${file.name}): استخدم JPEG أو PNG أو WebP أو AVIF`)
  if (file.size > MAX_IMAGE_BYTES) throw new Error(`حجم الصورة يتجاوز ${MAX_IMAGE_BYTES / 1024 / 1024} ميغابايت (${file.name})`)
}

/**
 * يرفع كل ملفات الصور في النموذج ثم يستبدلها بمفاتيحها. الحقول الفارغة لا تُمَسّ،
 * فيحتفظ الخادم بالصورة الحالية. يتحقق من كل الملفات قبل رفع أي منها.
 * ملاحظة: عند فشل الحفظ بعد الرفع قد يبقى كائن يتيم في R2 (لا يظهر في الموقع).
 */
export async function uploadFormImages(
  form: FormData,
  fields: UploadField[],
  deps: UploadDeps = { request: defaultRequest, put: defaultPut },
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
    for (const file of files) {
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
