// ============================================
// رقم المنتج — مشتق من معرّف المنتج بشكل ثابت (Deterministic)
//
// لماذا مشتق ولا يُرسل من المتصفح؟ لأن الرقم يجب أن يكون غير قابل للتلاعب،
// وأن يبقى ثابتاً لنفس المنتج في كل الطلبات، وأن يعمل مع المنتجات الحالية
// دون أن يضطر المسؤول لترقيمها يدوياً.
//
// رقم المنتج مستقل عن SKU: الأول تلقائي دائماً، والثاني رقم صنف خارجي اختياري.
// ============================================

const PREFIX = "TJ"

/**
 * يبني رقم المنتج الظاهر من معرّف المنتج.
 * يعيد سلسلة فارغة إذا لم يوجد معرّف — حتى تُعرض الطلبات القديمة بلا رقم
 * بدل أن تظهر برقم مضلل.
 */
export function buildProductNumber(productId: unknown): string {
  if (typeof productId !== "string") return ""
  // معرّفات Sanity قد تحتوي شرطات أو بادئة drafts. نأخذ الحروف والأرقام فقط.
  const clean = productId.replace(/^drafts\./, "").replace(/[^a-zA-Z0-9]/g, "")
  if (!clean) return ""
  return `${PREFIX}-${clean.slice(-8).toUpperCase()}`
}

/**
 * رقم المنتج المعروض لعنصر طلب: يفضّل اللقطة المحفوظة وقت الطلب،
 * ويعود للاشتقاق من المعرّف حتى تظهر الطلبات القديمة برقم صحيح.
 */
export function resolveItemProductNumber(item: {
  productNumber?: string
  productId?: string
}): string {
  const saved = (item.productNumber ?? "").trim()
  if (saved) return saved
  return buildProductNumber(item.productId)
}
