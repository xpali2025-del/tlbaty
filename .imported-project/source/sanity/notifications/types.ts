// ============================================
// أنواع الإشعارات — مشتركة بين الخادم واللوحة وواجهة العملاء
// بلا أي استخدام لـ any.
// ============================================

/** حالات الإشعار الثلاث. */
export const NOTIFICATION_STATUSES = ["draft", "published", "archived"] as const
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number]

/** أولوية الإشعار. */
export const NOTIFICATION_PRIORITIES = ["normal", "important"] as const
export type NotificationPriority = (typeof NOTIFICATION_PRIORITIES)[number]

/** ترجمة الحالة إلى العربية كما هو مطلوب في الواجهة. */
export const NOTIFICATION_STATUS_LABELS: Record<NotificationStatus, string> = {
  draft: "مسودة",
  published: "منشور",
  archived: "مؤرشف",
}

export const NOTIFICATION_PRIORITY_LABELS: Record<NotificationPriority, string> = {
  normal: "عادي",
  important: "مهم",
}

/** حدود التحقق — نفس القيم تُستخدم في المخطط وفي تحقق الخادم. */
export const NOTIFICATION_LIMITS = {
  titleMin: 3,
  titleMax: 120,
  bodyMin: 3,
  bodyMax: 1000,
  linkMax: 300,
  createdByMax: 80,
} as const

/** إشعار كما يُعرض للعميل في /notifications. */
export type PublicNotification = {
  _id: string
  title: string
  body: string
  imageUrl: string | null
  link: string | null
  priority: NotificationPriority
  publishedAt: string
}

/** عنصر مختصر لحساب عدد غير المقروء فوق الجرس. */
export type NotificationSummaryItem = {
  _id: string
  publishedAt: string
  priority: NotificationPriority
}

/** إشعار كما يُعرض داخل لوحة الإدارة (يشمل المسودات والمؤرشف). */
export type AdminNotification = {
  _id: string
  title: string
  body: string
  imageUrl: string | null
  /** مرجع أصل الصورة — لازم للإبقاء على الصورة عند التعديل بدون رفع جديد. */
  imageRef: string | null
  link: string | null
  status: NotificationStatus
  priority: NotificationPriority
  publishedAt: string | null
  expiresAt: string | null
  createdBy: string | null
  createdAt: string | null
  updatedAt: string | null
}

/** إحصاءات اللوحة. */
export type NotificationStats = {
  total: number
  published: number
  draft: number
  archived: number
}

/** نتيجة موحّدة لكل إجراء خادمي في اللوحة. */
export type NotificationActionResult = { ok: true; message: string } | { ok: false; error: string }
