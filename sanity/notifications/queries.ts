// ============================================
// استعلامات GROQ لمشروع الإشعارات — حقول محددة فقط (بلا * ولا حقول ثقيلة)
//
// شرط الظهور للعميل في كل الاستعلامات العامة:
//   status == "published"
//   && publishedAt <= الآن
//   && (لا يوجد expiresAt || expiresAt > الآن)
// ============================================

/** شرط الصلاحية المشترك — $now يُمرَّر كوسيط ISO. */
const VISIBLE = /* groq */ `_type == "notification"
  && status == "published"
  && defined(publishedAt)
  && publishedAt <= $now
  && (!defined(expiresAt) || expiresAt > $now)`

/**
 * قائمة الإشعارات المعروضة للعميل — الأحدث أولاً، بترقيم صفحات.
 * $start و $end يحدّدان النطاق (Pagination / عرض المزيد).
 */
export const PUBLIC_NOTIFICATIONS = /* groq */ `*[${VISIBLE}]
  | order(publishedAt desc)[$start...$end]{
    _id,
    title,
    body,
    "imageUrl": image.asset->url,
    link,
    "priority": coalesce(priority, "normal"),
    publishedAt
  }`

/** إجمالي عدد الإشعارات الصالحة — لمعرفة وجود المزيد. */
export const PUBLIC_NOTIFICATIONS_COUNT = /* groq */ `count(*[${VISIBLE}])`

/**
 * استعلام العدّاد الخفيف: معرّفات فقط بلا صور ولا نصوص.
 * يُستخدم لحساب عدد غير المقروء فوق الجرس.
 */
export const NOTIFICATIONS_SUMMARY = /* groq */ `*[${VISIBLE}]
  | order(publishedAt desc)[0...200]{
    _id,
    publishedAt,
    "priority": coalesce(priority, "normal")
  }`

/**
 * كل الإشعارات للوحة الإدارة (بما فيها المسودات والمؤرشف).
 * imageRef مطلوب للإبقاء على الصورة الحالية عند التعديل.
 */
export const ADMIN_NOTIFICATIONS = /* groq */ `*[_type == "notification"]
  | order(coalesce(publishedAt, updatedAt, createdAt, _createdAt) desc){
    _id,
    title,
    body,
    "imageUrl": image.asset->url,
    "imageRef": image.asset._ref,
    link,
    "status": coalesce(status, "draft"),
    "priority": coalesce(priority, "normal"),
    publishedAt,
    expiresAt,
    createdBy,
    "createdAt": coalesce(createdAt, _createdAt),
    "updatedAt": coalesce(updatedAt, _updatedAt)
  }`

/** هل أصل الصورة مستخدم في مستند إشعار آخر؟ يمنع حذف صورة مشتركة. */
export const IMAGE_ASSET_USAGE_COUNT = /* groq */ `count(*[
  _type == "notification" && _id != $id && image.asset._ref == $assetRef
])`
