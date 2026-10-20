// ============================================
// إعدادات مشروع Sanity الخاص بالطلبات (مشروع مستقل ومنفصل)
// - projectId/dataset/apiVersion تُقرأ من متغيرات NEXT_PUBLIC (يحتاجها الاستوديو في المتصفح)
// - التوكن (SANITY_ORDERS_TOKEN) خادمي فقط ولا يُكشف للمتصفح إطلاقاً
// ============================================

export const ordersProjectId = process.env.NEXT_PUBLIC_SANITY_ORDERS_PROJECT_ID ?? ""

export const ordersDataset = process.env.NEXT_PUBLIC_SANITY_ORDERS_DATASET ?? "production"

export const ordersApiVersion = process.env.NEXT_PUBLIC_SANITY_ORDERS_API_VERSION ?? "2026-01-01"

/** توكن الكتابة — خادمي فقط. مطلوب لحفظ الطلبات عبر مسار الـ API. */
export const ordersToken = process.env.SANITY_ORDERS_TOKEN ?? ""

/**
 * هل تم ضبط مشروع الطلبات بالكامل (المعرّف + توكن الكتابة)؟
 * إن لم يُضبط بعد، يفتح الموقع واتساب مباشرة دون تعطيل تجربة العميل.
 */
export const isOrdersConfigured = ordersProjectId.length > 0 && ordersToken.length > 0

/** هل معرّف مشروع الطلبات موجود؟ (كافٍ لتشغيل الاستوديو الذي يعتمد على تسجيل دخول Sanity) */
export const isOrdersStudioConfigured = ordersProjectId.length > 0
