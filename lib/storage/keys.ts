// مفاتيح كائنات الصور في R2 — بلا اعتماد على الخادم، فتُستعمل من الواجهة والخادم والسكربتات.
//
// المجلدات العامة المسموحة فقط. إثباتات الدفع المشفَّرة لها مجلد خاص منفصل ولا تمر من هنا
// إطلاقاً، فلا يمكن لإجراء إدارة صور أن يقرأ أو يحذف ملفاً حساساً بتمرير مفتاحه.

export const IMAGE_FOLDERS = [
  "products",
  "categories",
  "brands",
  "slides",
  "ads",
  "reviews",
  "payment-accounts",
  "couriers",
  "notifications",
  "site",
] as const

export type ImageFolder = (typeof IMAGE_FOLDERS)[number]

export const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
}

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024

const KEY_PATTERN = new RegExp(`^(?:${IMAGE_FOLDERS.join("|")})/[A-Za-z0-9._-]+\\.(?:jpe?g|png|webp|avif|gif|svg)$`)

export function isImageFolder(value: string): value is ImageFolder {
  return (IMAGE_FOLDERS as readonly string[]).includes(value)
}

/** هل المفتاح داخل مجلد عام مسموح وباسم ملف آمن؟ (يمنع .. و/ المتداخلة وأي مجلد آخر) */
export function isValidImageKey(key: string): boolean {
  return KEY_PATTERN.test(key) && !key.includes("..")
}
