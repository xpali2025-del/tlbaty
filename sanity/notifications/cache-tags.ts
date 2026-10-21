// أسماء وسوم كاش الإشعارات في مكان واحد حتى تتطابق طبقة القراءة
// مع إجراءات اللوحة عند الإبطال. مستقلة تماماً عن وسوم المحتوى والطلبات.

export const NOTIFICATION_TAGS = {
  /** قائمة الإشعارات المنشورة المعروضة للعملاء في /notifications. */
  list: "notifications:list",
  /** الاستعلام الخفيف لعدّاد الجرس (معرّفات فقط). */
  summary: "notifications:summary",
} as const
