// ============================================
// إعدادات مشروع Sanity الثالث — الإشعارات الداخلية فقط
//
// مشروع مستقل تماماً عن:
//   - مشروع المحتوى  (NEXT_PUBLIC_SANITY_PROJECT_ID / SANITY_API_TOKEN)
//   - مشروع الطلبات  (NEXT_PUBLIC_SANITY_ORDERS_PROJECT_ID / SANITY_ORDERS_TOKEN)
//
// لا يُعاد استخدام أي توكن من المشروعين السابقين هنا، ولا تُنقل أي
// مستندات بينها. الإشعارات تُقرأ وتُكتب في هذا المشروع وحده.
//
// معرّف المشروع/الداتاسيت من متغيرات NEXT_PUBLIC لأن القراءة العامة قد
// تحدث من مكوّنات الخادم وأدوات بناء روابط الصور. أما توكن الكتابة
// (SANITY_NOTIFICATIONS_API_TOKEN) فهو خادمي بحت ولا يبدأ بـ NEXT_PUBLIC
// ولا يُطبع في أي سجل أو رسالة خطأ.
// ============================================

export const notificationsProjectId = process.env.NEXT_PUBLIC_SANITY_NOTIFICATIONS_PROJECT_ID ?? ""

export const notificationsDataset = process.env.NEXT_PUBLIC_SANITY_NOTIFICATIONS_DATASET ?? "production"

export const notificationsApiVersion =
  process.env.NEXT_PUBLIC_SANITY_NOTIFICATIONS_API_VERSION ?? "2026-01-01"

/**
 * استخدام CDN للقراءة العامة المنشورة.
 * القيمة الافتراضية true حسب المطلوب — والقراءات الإدارية تتجاوزه دائماً
 * بعميل منفصل بـ useCdn: false.
 */
export const notificationsUseCdn = process.env.NEXT_PUBLIC_SANITY_NOTIFICATIONS_USE_CDN !== "false"

/** هل معرّف المشروع مضبوط؟ (كافٍ للقراءة العامة للإشعارات المنشورة) */
export const isNotificationsReadConfigured = notificationsProjectId.length > 0

/**
 * هل الكتابة مهيأة؟ يحتاجها إنشاء/تعديل/نشر/حذف الإشعارات من لوحة /manage.
 * لا نكشف التوكن نفسه — نتحقق من وجوده فقط عبر دالة خادمية.
 */
export function isNotificationsWriteConfigured(): boolean {
  return notificationsProjectId.length > 0 && Boolean(process.env.SANITY_NOTIFICATIONS_API_TOKEN?.trim())
}

/**
 * تقرير إعدادات مقروء للوحة الإدارة — يبيّن المتغيرات الناقصة بالاسم فقط
 * ولا يعرض أي قيمة أو توكن إطلاقاً.
 */
export type NotificationsConfigReport = {
  ready: boolean
  readReady: boolean
  missing: string[]
}

export function getNotificationsConfigReport(): NotificationsConfigReport {
  const missing: string[] = []
  if (!notificationsProjectId) missing.push("NEXT_PUBLIC_SANITY_NOTIFICATIONS_PROJECT_ID")
  if (!process.env.SANITY_NOTIFICATIONS_API_TOKEN?.trim()) missing.push("SANITY_NOTIFICATIONS_API_TOKEN")

  return {
    ready: missing.length === 0,
    readReady: isNotificationsReadConfigured,
    missing,
  }
}
