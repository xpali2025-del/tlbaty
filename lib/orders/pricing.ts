import { convertPrice, type Currency } from "@/lib/currency"
import { resolveShippingMethods } from "@/lib/shipping"
import type { Coupon, ShippingZone } from "@/lib/types"

// ============================================
// تسعير الطلب في الخادم.
//
// كان مسار الطلب يحفظ الأسعار والمجاميع كما أرسلها المتصفح، فيستطيع أي عميل تعديل الطلب
// ليدفع أي مبلغ. الآن يُعاد حساب كل شيء من قاعدة البيانات بنفس دوال الواجهة تماماً
// (السعر الأساسي بالريال ثم convertPrice لكل رقم)، والأرقام المرسلة تُستعمل فقط لمعرفة
// هل تغيّر السعر عمّا رآه العميل (priceChanged).
// ============================================

export const MAX_LINE_QUANTITY = 999

export type PricingProduct = { id: string; name: string; price: number; sku?: string; image?: string }

export type PricingInput = {
  items: { productId: string; size: string; color: string; quantity: number }[]
  /** المنتجات بحسب Product.id (رقم المنتج). */
  products: Map<string, PricingProduct>
  zones: ShippingZone[]
  city: string
  shippingMethodName: string
  coupons: Coupon[]
  couponCode: string
  /** العملات المتاحة والعملة الافتراضية؛ الرمز غير المعروف يعود إلى الافتراضية. */
  currencies: Currency[]
  defaultCurrencyCode: string
  currencyCode: string
}

export type PricedLine = {
  productId: string
  name: string
  sku: string
  image: string
  size: string
  color: string
  quantity: number
  /** بالعملة المختارة. */
  price: number
  lineTotal: number
}

export type PricingResult =
  | {
      ok: true
      currency: Currency
      lines: PricedLine[]
      shippingMethod: string
      couponCode: string
      /** بالعملة المختارة (كل رقم مُقرَّب على حدة كما تفعل الواجهة). */
      shippingPrice: number
      discount: number
      subtotal: number
      total: number
      /** بالسعر الأساسي (ريال) — للتدقيق والاختبار. */
      base: { subtotal: number; shipping: number; discount: number; total: number }
    }
  | { ok: false; error: "UNKNOWN_PRODUCT"; productId: string }
  | { ok: false; error: "INVALID_SHIPPING_METHOD" }
  | { ok: false; error: "INVALID_QUANTITY"; productId: string }

/** خصم الكوبون بالسعر الأساسي؛ 0 إن كان الكود غير صحيح أو لم يبلغ الحد الأدنى. */
export function couponDiscountBase(coupons: Coupon[], code: string, subtotalBase: number): { code: string; amount: number } {
  const wanted = code.trim().toUpperCase()
  if (!wanted) return { code: "", amount: 0 }
  const coupon = coupons.find((c) => c.code.toUpperCase() === wanted)
  if (!coupon) return { code: "", amount: 0 }
  if (coupon.minOrder && subtotalBase < coupon.minOrder) return { code: "", amount: 0 }
  const amount = coupon.type === "percent" ? Math.round((subtotalBase * coupon.discount) / 100) : coupon.discount
  return { code: coupon.code, amount: Math.max(0, amount) }
}

export function computeOrderPricing(input: PricingInput): PricingResult {
  const currency =
    input.currencies.find((c) => c.code === input.currencyCode) ??
    input.currencies.find((c) => c.code === input.defaultCurrencyCode) ??
    input.currencies[0]

  let subtotalBase = 0
  const lines: PricedLine[] = []
  for (const item of input.items) {
    const product = input.products.get(item.productId)
    if (!product) return { ok: false, error: "UNKNOWN_PRODUCT", productId: item.productId }
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > MAX_LINE_QUANTITY) {
      return { ok: false, error: "INVALID_QUANTITY", productId: item.productId }
    }
    subtotalBase += product.price * item.quantity
    const unit = convertPrice(product.price, currency)
    lines.push({
      productId: product.id,
      name: product.name,
      sku: product.sku ?? "",
      image: product.image ?? "",
      size: item.size,
      color: item.color,
      quantity: item.quantity,
      price: unit,
      lineTotal: unit * item.quantity,
    })
  }

  const methods = resolveShippingMethods(input.zones, input.city)
  const method = methods.find((m) => m.name === input.shippingMethodName)
  if (!method) return { ok: false, error: "INVALID_SHIPPING_METHOD" }

  const coupon = couponDiscountBase(input.coupons, input.couponCode, subtotalBase)
  const totalBase = Math.max(0, subtotalBase + method.price - coupon.amount)

  return {
    ok: true,
    currency,
    lines,
    shippingMethod: method.name,
    couponCode: coupon.code,
    shippingPrice: convertPrice(method.price, currency),
    discount: convertPrice(coupon.amount, currency),
    subtotal: convertPrice(subtotalBase, currency),
    total: convertPrice(totalBase, currency),
    base: { subtotal: subtotalBase, shipping: method.price, discount: coupon.amount, total: totalBase },
  }
}

/** هل يختلف حساب الخادم عمّا أرسله العميل (تسامح وحدة واحدة للتقريب)؟ */
export function priceChanged(
  server: { total: number; subtotal: number; shippingPrice: number; discount: number },
  client: { total: number; subtotal: number; shippingPrice: number; discount: number },
  tolerance = 1,
): boolean {
  return (["total", "subtotal", "shippingPrice", "discount"] as const).some(
    (k) => Math.abs(server[k] - client[k]) > tolerance,
  )
}
