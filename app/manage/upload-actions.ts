"use server"

import { serverAction } from "@/lib/server-action"
import { isR2Configured } from "@/lib/env"
import { assertManageAuthenticated } from "@/lib/manage-auth"
import { ALLOWED_IMAGE_TYPES, MAX_IMAGE_BYTES, isImageFolder, type ImageFolder } from "@/lib/storage/keys"
import { createImageUpload, createVideoUpload } from "@/lib/storage/r2"
import { ALLOWED_VIDEO_TYPES, MAX_VIDEO_BYTES } from "@/lib/ads"
import { isValidImageKey, isValidVideoKey } from "@/lib/storage/keys"
import { removeObjects } from "@/lib/manage-helpers"
import { discardPendingUploads, recordPendingUploads } from "@/lib/pending-uploads"

/**
 * يعيد رابط رفع موقَّعاً (PUT، صالح 15 دقيقة) ومفتاح الكائن لرفع صورة من المتصفح مباشرة إلى R2.
 * محميّ بجلسة الإدارة؛ النوع والحجم والمجلد تُتحقَّق هنا قبل توقيع الرابط (والرابط نفسه يثبّت النوع والحجم).
 */
async function requestImageUploadImpl(folder: string, contentType: string, size: number) {
  const ctx = await assertManageAuthenticated()
  if (!isImageFolder(folder)) throw new Error("مجلد الصور غير مسموح")
  if (!ALLOWED_IMAGE_TYPES[contentType]) throw new Error("نوع الصورة غير مدعوم (JPEG أو PNG أو WebP أو AVIF)")
  if (!Number.isFinite(size) || size <= 0 || size > MAX_IMAGE_BYTES) {
    throw new Error(`حجم الصورة يجب ألا يتجاوز ${MAX_IMAGE_BYTES / 1024 / 1024} ميغابايت`)
  }
  if (!isR2Configured()) throw new Error("تخزين الصور (R2) غير مضبوط على الخادم")
  const slot = await createImageUpload(contentType, size, folder)
  await recordPendingUploads([slot.objectKey], ctx.username)
  return slot
}

/** رابط رفع موقَّع لفيديو إعلان (MP4 فقط، مجلد الإعلانات). */
async function requestVideoUploadImpl(contentType: string, size: number) {
  const ctx = await assertManageAuthenticated()
  if (!ALLOWED_VIDEO_TYPES[contentType]) throw new Error("نوع الفيديو غير مدعوم (MP4 فقط)")
  if (!Number.isFinite(size) || size <= 0 || size > MAX_VIDEO_BYTES) {
    throw new Error(`حجم الفيديو يجب ألا يتجاوز ${MAX_VIDEO_BYTES / 1024 / 1024} ميغابايت`)
  }
  if (!isR2Configured()) throw new Error("تخزين الصور (R2) غير مضبوط على الخادم")
  const slot = await createVideoUpload(contentType, size)
  await recordPendingUploads([slot.objectKey], ctx.username)
  return slot
}

const MAX_BATCH = 30

/**
 * روابط رفع لعدة صور بنداء واحد (نداءات الإجراءات من الواجهة تُنفَّذ بالتتابع، فنداء لكل صورة يضاعف الانتظار).
 * نفس التحققات لكل عنصر؛ أي عنصر غير صالح يُفشل الدفعة كلها قبل توقيع أي رابط.
 */
async function requestImageUploadsImpl(items: { folder: string; contentType: string; size: number }[]) {
  const ctx = await assertManageAuthenticated()
  if (!Array.isArray(items) || items.length === 0 || items.length > MAX_BATCH) throw new Error(`عدد الصور في الدفعة يجب أن يكون من 1 إلى ${MAX_BATCH}`)
  for (const { folder, contentType, size } of items) {
    if (!isImageFolder(folder)) throw new Error("مجلد الصور غير مسموح")
    if (!ALLOWED_IMAGE_TYPES[contentType]) throw new Error("نوع الصورة غير مدعوم (JPEG أو PNG أو WebP أو AVIF)")
    if (!Number.isFinite(size) || size <= 0 || size > MAX_IMAGE_BYTES) {
      throw new Error(`حجم الصورة يجب ألا يتجاوز ${MAX_IMAGE_BYTES / 1024 / 1024} ميغابايت`)
    }
  }
  if (!isR2Configured()) throw new Error("تخزين الصور (R2) غير مضبوط على الخادم")
  const slots = await Promise.all(items.map(({ folder, contentType, size }) => createImageUpload(contentType, size, folder as ImageFolder)))
  // المفاتيح تُسجَّل «معلّقة» بجملة واحدة: يطالب بها أي حفظ ناجح يستعملها، أو يحذفها الإلغاء/التنظيف اليومي.
  await recordPendingUploads(slots.map((s) => s.objectKey), ctx.username)
  return slots
}

/**
 * إلغاء مرفوعات لم تُحفظ (أغلق المدير النموذج أو استبدل الصورة): يحذف كائناتها من R2 وسجلها.
 * يمسّ فقط مفاتيح هذا المدير التي لم يطالب بها حفظ ناجح، فلا يمكن به حذف صورة حيّة ولا صورة غيره.
 */
async function discardUploadsImpl(keys: string[]) {
  const ctx = await assertManageAuthenticated()
  if (!Array.isArray(keys) || keys.length === 0 || keys.length > MAX_BATCH) throw new Error("قائمة المفاتيح غير صالحة")
  const valid = keys.filter((k): k is string => typeof k === "string" && (isValidImageKey(k) || isValidVideoKey(k)))
  const removed = await discardPendingUploads(valid, ctx.username)
  await removeObjects(removed) // بعد الرد: المدير لا ينتظر حذف الملفات
  return { discarded: removed.length }
}

// الإجراءات المصدَّرة: تعيد الأخطاء المتوقعة كقيمة فتصل رسالتها للمدير في الإنتاج (انظر lib/server-action.ts).
export const requestImageUpload = serverAction(requestImageUploadImpl)
export const requestVideoUpload = serverAction(requestVideoUploadImpl)
export const requestImageUploads = serverAction(requestImageUploadsImpl)
export const discardUploads = serverAction(discardUploadsImpl)
