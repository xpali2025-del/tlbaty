// مخزون كل لون ومقاس. بلا اعتماد على الخادم: تستعمله الواجهة (تعطيل غير المتوفر) والخادم (خصم الطلب) بنفس القواعد.
//
// منتج له صفوف في variantStock يُتتبَّع مخزونه لكل (لون، مقاس)؛ وإلا يبقى المخزون الواحد product.stock.
// لون/مقاس '' يعني أن المنتج بلا ألوان/مقاسات.

export type VariantStock = { color: string; size: string; stock: number }

type WithStock = { stock: number; variantStock?: VariantStock[] }

/** هل يُتتبَّع مخزون المنتج لكل لون ومقاس؟ */
export function isVariantTracked(p: Pick<WithStock, "variantStock">): boolean {
  return (p.variantStock?.length ?? 0) > 0
}

/**
 * يوحّد اللون/المقاس المطلوب مع أبعاد المنتج: إن لم تكن للمنتج ألوان (كل الصفوف color='') يُهمل اللون المرسل،
 * وكذلك المقاس. هكذا لا يفشل طلب بسبب لون افتراضي أرسله المتصفح لمنتج بلا ألوان.
 */
export function normalizeVariantKey(variants: readonly VariantStock[], color: string, size: string): { color: string; size: string } {
  const colorless = variants.every((v) => v.color === "")
  const sizeless = variants.every((v) => v.size === "")
  // صفوف المخزون تُحفظ بلا مسافات طرفية؛ منتجات قديمة قد تحفظ مقاساتها بمسافة (« M») فتُطابَق بعد الحذف.
  return { color: colorless ? "" : color.trim(), size: sizeless ? "" : size.trim() }
}

/** الكمية المتاحة لتركيبة (لون، مقاس): مخزون الصف المطابق، 0 إن لم يوجد، أو المخزون الواحد لمنتج غير متتبَّع. */
export function availableFor(p: WithStock, color: string, size: string): number {
  const variants = p.variantStock
  if (!variants || variants.length === 0) return Math.max(0, p.stock)
  const key = normalizeVariantKey(variants, color, size)
  return variants.find((v) => v.color === key.color && v.size === key.size)?.stock ?? 0
}

/** هل يتوفر اللون بأي مقاس؟ */
export function colorInStock(p: WithStock, color: string): boolean {
  const variants = p.variantStock
  if (!variants || variants.length === 0) return p.stock > 0
  const key = normalizeVariantKey(variants, color, "")
  return variants.some((v) => v.color === key.color && v.stock > 0)
}

/** هل يتوفر المقاس للون المحدد؟ */
export function sizeInStock(p: WithStock, color: string, size: string): boolean {
  return availableFor(p, color, size) > 0
}

/** أول تركيبة متوفرة (لتحديدها افتراضياً)، مع تفضيل اللون المحدد. */
export function firstAvailable(
  p: WithStock & { colors?: { name: string }[]; sizes?: string[] },
  preferredColor?: string,
): { color: string; size: string } {
  const colors = p.colors?.map((c) => c.name) ?? []
  const sizes = p.sizes ?? []
  const colorOptions = colors.length ? (preferredColor && colors.includes(preferredColor) ? [preferredColor, ...colors.filter((c) => c !== preferredColor)] : colors) : [""]
  const sizeOptions = sizes.length ? sizes : [""]
  for (const color of colorOptions) {
    for (const size of sizeOptions) if (availableFor(p, color, size) > 0) return { color, size }
  }
  return { color: colorOptions[0] ?? "", size: sizeOptions[0] ?? "" }
}

/** نص تنبيه قلة المخزون للعميل، أو null. */
export const LOW_STOCK_THRESHOLD = 5
export function lowStockMessage(available: number): string | null {
  if (available <= 0) return "نفد المخزون"
  if (available <= LOW_STOCK_THRESHOLD) return `متبقي ${available} فقط`
  return null
}
