"use server"

import { isR2Configured } from "@/lib/env"
import { assertManageAuthenticated } from "@/lib/manage-auth"
import { ALLOWED_IMAGE_TYPES, MAX_IMAGE_BYTES, isImageFolder } from "@/lib/storage/keys"
import { createImageUpload } from "@/lib/storage/r2"

/**
 * يعيد رابط رفع موقَّعاً (PUT، صالح 5 دقائق) ومفتاح الكائن لرفع صورة من المتصفح مباشرة إلى R2.
 * محميّ بجلسة الإدارة؛ النوع والحجم والمجلد تُتحقَّق هنا قبل توقيع الرابط (والرابط نفسه يثبّت النوع والحجم).
 */
export async function requestImageUpload(folder: string, contentType: string, size: number) {
  await assertManageAuthenticated()
  if (!isImageFolder(folder)) throw new Error("مجلد الصور غير مسموح")
  if (!ALLOWED_IMAGE_TYPES[contentType]) throw new Error("نوع الصورة غير مدعوم (JPEG أو PNG أو WebP أو AVIF)")
  if (!Number.isFinite(size) || size <= 0 || size > MAX_IMAGE_BYTES) {
    throw new Error(`حجم الصورة يجب ألا يتجاوز ${MAX_IMAGE_BYTES / 1024 / 1024} ميغابايت`)
  }
  if (!isR2Configured()) throw new Error("تخزين الصور (R2) غير مضبوط على الخادم")
  return createImageUpload(contentType, size, folder)
}
