"use server"

import { serverAction } from "@/lib/server-action"
import { isR2Configured } from "@/lib/env"
import { assertManageAuthenticated } from "@/lib/manage-auth"
import { ALLOWED_IMAGE_TYPES, MAX_IMAGE_BYTES, isImageFolder, type ImageFolder } from "@/lib/storage/keys"
import { createImageUpload, createVideoUpload } from "@/lib/storage/r2"
import { ALLOWED_VIDEO_TYPES, MAX_VIDEO_BYTES } from "@/lib/ads"
import { videoUploadTicket, verifyVideoUploadTicket } from "@/lib/storage/upload-ticket"

/**
 * يعيد رابط رفع موقَّعاً (PUT، صالح 15 دقيقة) ومفتاح الكائن لرفع صورة من المتصفح مباشرة إلى R2.
 * محميّ بجلسة الإدارة؛ النوع والحجم والمجلد تُتحقَّق هنا قبل توقيع الرابط (والرابط نفسه يثبّت النوع والحجم).
 */
async function requestImageUploadImpl(folder: string, contentType: string, size: number) {
  await assertManageAuthenticated()
  if (!isImageFolder(folder)) throw new Error("مجلد الصور غير مسموح")
  if (!ALLOWED_IMAGE_TYPES[contentType]) throw new Error("نوع الصورة غير مدعوم (JPEG أو PNG أو WebP أو AVIF)")
  if (!Number.isFinite(size) || size <= 0 || size > MAX_IMAGE_BYTES) {
    throw new Error(`حجم الصورة يجب ألا يتجاوز ${MAX_IMAGE_BYTES / 1024 / 1024} ميغابايت`)
  }
  if (!isR2Configured()) throw new Error("تخزين الصور (R2) غير مضبوط على الخادم")
  return createImageUpload(contentType, size, folder)
}

/** رابط رفع موقَّع لفيديو إعلان (MP4 فقط، مجلد الإعلانات). */
async function requestVideoUploadImpl(contentType: string, size: number, ticket?: string) {
  await assertManageAuthenticated()
  if (!ALLOWED_VIDEO_TYPES[contentType]) throw new Error("نوع الفيديو غير مدعوم (MP4 فقط)")
  if (!Number.isFinite(size) || size <= 0 || size > MAX_VIDEO_BYTES) {
    throw new Error(`حجم الفيديو يجب ألا يتجاوز ${MAX_VIDEO_BYTES / 1024 / 1024} ميغابايت`)
  }
  if (!isR2Configured()) throw new Error("تخزين الصور (R2) غير مضبوط على الخادم")
  const existingKey = ticket ? verifyVideoUploadTicket(ticket, contentType, size) : undefined
  const slot = await createVideoUpload(contentType, size, existingKey)
  return { ...slot, ticket: ticket ?? videoUploadTicket(slot.objectKey, contentType, size) }
}

const MAX_BATCH = 30

/**
 * روابط رفع لعدة صور بنداء واحد (نداءات الإجراءات من الواجهة تُنفَّذ بالتتابع، فنداء لكل صورة يضاعف الانتظار).
 * نفس التحققات لكل عنصر؛ أي عنصر غير صالح يُفشل الدفعة كلها قبل توقيع أي رابط.
 */
async function requestImageUploadsImpl(items: { folder: string; contentType: string; size: number }[]) {
  await assertManageAuthenticated()
  if (!Array.isArray(items) || items.length === 0 || items.length > MAX_BATCH) throw new Error(`عدد الصور في الدفعة يجب أن يكون من 1 إلى ${MAX_BATCH}`)
  for (const { folder, contentType, size } of items) {
    if (!isImageFolder(folder)) throw new Error("مجلد الصور غير مسموح")
    if (!ALLOWED_IMAGE_TYPES[contentType]) throw new Error("نوع الصورة غير مدعوم (JPEG أو PNG أو WebP أو AVIF)")
    if (!Number.isFinite(size) || size <= 0 || size > MAX_IMAGE_BYTES) {
      throw new Error(`حجم الصورة يجب ألا يتجاوز ${MAX_IMAGE_BYTES / 1024 / 1024} ميغابايت`)
    }
  }
  if (!isR2Configured()) throw new Error("تخزين الصور (R2) غير مضبوط على الخادم")
  return Promise.all(items.map(({ folder, contentType, size }) => createImageUpload(contentType, size, folder as ImageFolder)))
}

// الإجراءات المصدَّرة: تعيد الأخطاء المتوقعة كقيمة فتصل رسالتها للمدير في الإنتاج (انظر lib/server-action.ts).
export const requestImageUpload = serverAction(requestImageUploadImpl)
export const requestVideoUpload = serverAction(requestVideoUploadImpl)
export const requestImageUploads = serverAction(requestImageUploadsImpl)
