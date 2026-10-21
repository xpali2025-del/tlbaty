import "server-only"

import { ordersClient } from "@/sanity/orders/client"

// ============================================
// طلبات العميل — تُجلب بمعرّف العميل من الجلسة على الخادم وحده.
//
// قاعدة أمنية صارمة: لا يُقبل أي معرّف يرسله العميل. كل الاستعلامات
// تُقيّد بـ customerId (ورقم الهاتف المحلي) المشتقّين من جلسة الخادم،
// فلا يستطيع عميل رؤية طلبات غيره حتى لو خمّن رقم طلب آخر.
//
// دعم الطلبات القديمة: الطلبات التي أُنشئت قبل وجود customerId تُطابَق
// عبر customerPhoneNormalized مقابل رقم هاتف العميل المخزّن في جلسته —
// وهو أيضاً قيمة خادمية لا تأتي من الواجهة.
// ============================================

/** الحقول المسموح عرضها في قائمة الطلبات — ملخّص خفيف بلا تفاصيل حساسة. */
const SUMMARY_PROJECTION = `{
  orderNumber,
  status,
  createdAt,
  "lastUpdatedAt": coalesce(_updatedAt, createdAt),
  total,
  currency,
  currencyCode,
  paymentStatus,
  paymentMethod,
  "itemsCount": count(items),
  "firstItemImage": items[0].image,
  "firstItemName": items[0].name
}`

/**
 * تفاصيل الطلب الكاملة المسموح عرضها للعميل صاحب الجلسة.
 * الحقول الحساسة مستثناة: الإحداثيات، دقة الموقع، إثبات الحوالة،
 * الملاحظات الإدارية، سجل الموظفين، هاتف المندوب، وأي رموز أو مفاتيح.
 */
const DETAIL_PROJECTION = `{
  orderNumber,
  status,
  createdAt,
  "lastUpdatedAt": coalesce(_updatedAt, createdAt),
  paymentStatus,
  paymentMethod,
  customerName,
  phone,
  city,
  address,
  customerNote,
  shippingMethod,
  shippingPrice,
  discount,
  subtotal,
  total,
  currency,
  currencyCode,
  deliveredAt,
  courierAssignedAt,
  "courierName": courierSnapshot.name,
  "items": items[]{
    productNumber,
    sku,
    image,
    name,
    size,
    color,
    quantity,
    price,
    lineTotal
  },
  "statusTimeline": statusHistory[]{ "status": to, changedAt }
}`

/** عنصر واحد في قائمة "طلباتي". */
export type CustomerOrderSummary = {
  orderNumber: string
  status: string
  createdAt: string | null
  lastUpdatedAt: string | null
  total: number | null
  currency: string | null
  currencyCode: string | null
  paymentStatus: string | null
  paymentMethod: string | null
  itemsCount: number
  firstItemImage: string | null
  firstItemName: string | null
}

/** تفاصيل طلب واحد كما تُعرض لصاحبه. */
export type CustomerOrderDetail = {
  orderNumber: string
  status: string
  createdAt: string | null
  lastUpdatedAt: string | null
  paymentStatus: string | null
  paymentMethod: string | null
  customerName: string | null
  phone: string | null
  city: string | null
  address: string | null
  customerNote: string | null
  shippingMethod: string | null
  shippingPrice: number | null
  discount: number | null
  subtotal: number | null
  total: number | null
  currency: string | null
  currencyCode: string | null
  deliveredAt: string | null
  courierAssignedAt: string | null
  courierName: string | null
  items: Array<{
    productNumber: string | null
    sku: string | null
    image: string | null
    name: string | null
    size: string | null
    color: string | null
    quantity: number | null
    price: number | null
    lineTotal: number | null
  }>
  statusTimeline: Array<{ status: string; changedAt: string }>
}

const MAX_ORDER_NUMBER_LENGTH = 40

/**
 * شرط الملكية المشترك: الطلب يخص العميل إن طابق customerId جلسته،
 * أو (للطلبات القديمة بلا customerId) طابق رقمه المحلي رقم هاتف العميل.
 * كل من $customerId و$phone مشتقّان من الجلسة على الخادم.
 */
const OWNERSHIP_FILTER = `(
  customerId == $customerId ||
  (!defined(customerId) && defined(customerPhoneNormalized) && customerPhoneNormalized == $phone)
)`

/** يجلب كل طلبات العميل من الأحدث إلى الأقدم. */
export async function listOrdersByCustomerId(
  customerId: string,
  phone: string,
): Promise<CustomerOrderSummary[]> {
  if (!ordersClient) return []

  try {
    const orders = await ordersClient.fetch<CustomerOrderSummary[] | null>(
      `*[_type == "order" && ${OWNERSHIP_FILTER}] | order(createdAt desc) ${SUMMARY_PROJECTION}`,
      { customerId, phone },
      { cache: "no-store" },
    )
    return Array.isArray(orders) ? orders : []
  } catch {
    console.log("[v0] listOrdersByCustomerId query failed")
    return []
  }
}

/**
 * يجلب طلباً واحداً برقمه، لكن فقط إن كان مملوكاً لصاحب الجلسة.
 * رقم الطلب يأتي من الرابط (مدخل عميل) لكنه لا يكفي وحده: الاستعلام
 * يشترط الملكية عبر معرّف الجلسة، فلا يُعاد أي طلب لا يخص العميل.
 */
export async function getOrderForCustomer(
  customerId: string,
  phone: string,
  orderNumber: string,
): Promise<CustomerOrderDetail | null> {
  if (!ordersClient) return null

  const normalized = orderNumber.trim().slice(0, MAX_ORDER_NUMBER_LENGTH).toUpperCase()
  if (!normalized) return null

  try {
    const order = await ordersClient.fetch<CustomerOrderDetail | null>(
      `*[_type == "order" && upper(orderNumber) == $orderNumber && ${OWNERSHIP_FILTER}][0] ${DETAIL_PROJECTION}`,
      { orderNumber: normalized, customerId, phone },
      { cache: "no-store" },
    )
    if (!order) return null

    // تنظيف الخط الزمني إلى مدخلات صالحة فقط.
    const statusTimeline = (order.statusTimeline ?? []).filter(
      (entry): entry is { status: string; changedAt: string } =>
        typeof entry?.status === "string" &&
        entry.status.length > 0 &&
        typeof entry?.changedAt === "string" &&
        entry.changedAt.length > 0,
    )

    return { ...order, statusTimeline }
  } catch {
    console.log("[v0] getOrderForCustomer query failed")
    return null
  }
}
