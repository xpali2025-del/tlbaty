import { normalizeArabic } from "@/lib/yemen-governorates"
import type { ShippingMethod, ShippingZone } from "@/lib/types"

// قواعد اختيار طريقة التوصيل — مشتركة بين صفحة الدفع (الواجهة) وحساب الطلب في الخادم،
// فلا يختلف ما يراه العميل عمّا يُحتسب عليه.

// تُستخدم فقط عند عدم إعداد أي طرق توصيل (قيمة آمنة احتياطية).
export const FALLBACK_SHIPPING_METHODS: ShippingMethod[] = [
  { id: "express", icon: "express", name: "شحن سريع", desc: "1 - 6 ساعات", price: 1000 },
  { id: "standard", icon: "standard", name: "شحن عادي", desc: "1 - 2 أيام", price: 500 },
  { id: "pickup", icon: "pickup", name: "استلام من المتجر", desc: "صنعاء شارع الرقاص", price: 0 },
]

/**
 * طرق التوصيل المتاحة للمحافظة المختارة:
 * - إن وُجد إعداد خاص بالمحافظة استُخدم.
 * - وإلا فالإعداد الافتراضي (باقي المحافظات).
 * - وإلا القيمة الاحتياطية الآمنة.
 */
export function resolveShippingMethods(zones: ShippingZone[], city: string): ShippingMethod[] {
  const cityKey = normalizeArabic(city)
  const defaultZone = zones.find((z) => z.isDefault)
  const cityZone = cityKey ? zones.find((z) => !z.isDefault && normalizeArabic(z.governorate) === cityKey) : undefined
  const zone = cityZone ?? defaultZone
  const methods = zone?.methods?.filter((m) => m && m.name)
  return methods && methods.length > 0 ? methods : FALLBACK_SHIPPING_METHODS
}
