// بيانات العميل التي تتبعه بين الأجهزة: السلة، الرغبات، العناوين المحفوظة، المشاهَدة مؤخراً.
// منطق خالص (بلا DOM ولا قاعدة بيانات) يُستخدم في المتصفح (الدمج وقرار المزامنة) وفي الخادم وفي الاختبارات.

export type CustomerData = {
  cart: Record<string, unknown>[]
  wishlist: Record<string, unknown>[]
  addresses: Record<string, unknown>[]
  recentlyViewed: Record<string, unknown>[]
}

export const EMPTY_CUSTOMER_DATA: CustomerData = { cart: [], wishlist: [], addresses: [], recentlyViewed: [] }

export const MAX_RECENT = 20

const str = (v: unknown) => (typeof v === "string" ? v : "")
const cartKey = (i: Record<string, unknown>) => `${str(i.productId)}|${str(i.size)}|${str(i.color)}`
const qty = (i: Record<string, unknown>) => (typeof i.quantity === "number" && i.quantity > 0 ? i.quantity : 1)

export function isEmptyData(d: CustomerData): boolean {
  return d.cart.length + d.wishlist.length + d.addresses.length + d.recentlyViewed.length === 0
}

/** بصمة نصية ثابتة لمقارنة محتوى بيانين (تتجاهل ترتيب المفاتيح داخل العناصر لا ترتيب العناصر). */
export function dataHash(d: CustomerData): string {
  const norm = (list: Record<string, unknown>[]) =>
    list.map((item) => JSON.stringify(Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))))
  return JSON.stringify([norm(d.cart), norm(d.wishlist), norm(d.addresses), norm(d.recentlyViewed)])
}

/**
 * دمج أول تسجيل دخول على هذا الجهاز (ما جمعه الزائر قبل الدخول + ما في حسابه):
 * اتحاد بلا حذف. السلة: نفس المنتج/المقاس/اللون بأكبر كمية (لا تُجمع حتى لا تتضاعف عند التكرار).
 * الرغبات والمشاهَدات: اتحاد بالمعرّف. العناوين: اتحاد بالمعرّف والأحدث تعديلاً يفوز.
 */
export function mergeCustomerData(local: CustomerData, server: CustomerData): CustomerData {
  const cart = new Map<string, Record<string, unknown>>()
  for (const item of [...server.cart, ...local.cart]) {
    const k = cartKey(item)
    const prev = cart.get(k)
    cart.set(k, prev ? { ...prev, ...item, quantity: Math.max(qty(prev), qty(item)) } : item)
  }

  const byId = (lists: Record<string, unknown>[][], pickNewer = false) => {
    const out = new Map<string, Record<string, unknown>>()
    for (const item of lists.flat()) {
      const id = str(item.id)
      if (!id) continue
      const prev = out.get(id)
      if (!prev) out.set(id, item)
      else if (pickNewer && str(item.updatedAt) > str(prev.updatedAt)) out.set(id, item)
    }
    return [...out.values()]
  }

  return {
    cart: [...cart.values()],
    wishlist: byId([local.wishlist, server.wishlist]),
    addresses: byId([local.addresses, server.addresses], true),
    // المشاهَدات: الأحدث (المحلي) أولاً
    recentlyViewed: byId([local.recentlyViewed, server.recentlyViewed]).slice(0, MAX_RECENT),
  }
}

export type SyncMeta = { customerId: string; syncedAt: string; hash: string }

export type SyncPlan =
  | { action: "noop" }
  | { action: "apply-server"; data: CustomerData }
  | { action: "merge"; data: CustomerData }
  | { action: "push-local" }

/**
 * قرار المزامنة عند فتح الموقع لعميل مسجّل الدخول:
 * - أول مرة لهذا الحساب على هذا الجهاز (لا meta): دمج ما جمعه كزائر مع حسابه.
 * - الجهاز كان لحساب آخر (meta لعميل مختلف): نتجاهل المحلي كلياً ونأخذ بيانات الحساب (لا تسرّب بين حسابين).
 * - نفس الحساب: إن كان الخادم أحدث مما زامنّاه آخر مرة فهو الأصل (عُدّل من جهاز آخر)، وإلا إن عُدّل المحلي ندفعه.
 */
export function planSync(input: {
  customerId: string
  meta: SyncMeta | null
  server: { data: CustomerData; updatedAt: string | null }
  local: CustomerData
}): SyncPlan {
  const { customerId, meta, server, local } = input
  if (!meta) {
    if (isEmptyData(local)) return isEmptyData(server.data) ? { action: "noop" } : { action: "apply-server", data: server.data }
    const merged = mergeCustomerData(local, server.data)
    return dataHash(merged) === dataHash(server.data) ? { action: "noop" } : { action: "merge", data: merged }
  }
  if (meta.customerId !== customerId) return { action: "apply-server", data: server.data }
  if (server.updatedAt && server.updatedAt > meta.syncedAt && dataHash(server.data) !== dataHash(local)) {
    // الخادم أحدث؛ إن كان المحلي عُدّل أيضاً بعد آخر مزامنة فالخادم يفوز (آخر كاتب) كي لا تتضارب الأجهزة.
    return { action: "apply-server", data: server.data }
  }
  return dataHash(local) !== meta.hash ? { action: "push-local" } : { action: "noop" }
}
