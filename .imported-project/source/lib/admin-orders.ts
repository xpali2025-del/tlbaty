import "server-only"

import { ordersClient } from "@/sanity/orders/client"
import type {
  PaymentAccountSnapshot,
  PaymentMethod,
  PaymentStatus,
  PaymentStatusHistoryEntry,
} from "@/lib/payment"
import {
  ORDER_STATUSES,
  normalizeOrderStatus,
  type OrderStatus,
  type OrderStatusHistoryEntry,
} from "@/lib/order-status"
import type { CourierSnapshot } from "@/lib/courier"
import { customerKey } from "@/lib/phone"

// ============================================
// طبقة قراءة الطلبات للوحة الإدارة (/manage)
// تجلب الطلبات من مشروع Sanity المستقل الخاص بالطلبات.
//
// الأداء: كل الاستعلامات محددة الحقول، والطلبات تُجلب على دفعات مرقّمة
// (لا نحمّل كل الطلبات دفعة واحدة)، والعدّادات وتقسيم المدن يُحسبان
// من استعلام واحد خفيف — بلا استعلام لكل طلب.
// ============================================

export type { OrderStatus }

/** حجم الدفعة الواحدة من الطلبات. */
export const ORDERS_PAGE_SIZE = 25

export type AdminOrderItem = {
  productId?: string
  /** لقطة رقم المنتج وقت الطلب — قد تغيب في الطلبات القديمة. */
  productNumber?: string
  sku?: string
  image?: string
  name?: string
  size?: string
  color?: string
  quantity?: number
  price?: number
  lineTotal?: number
}

export type AdminOrder = {
  _id: string
  orderNumber?: string
  /** حالة موحّدة دائماً — الحالات القديمة مترجمة، والمفقودة تصبح "new". */
  status: OrderStatus
  /** القيمة الأصلية المحفوظة في Sanity، للتشخيص وسجل الحالات. */
  rawStatus?: string
  customerId?: string
  customerName?: string
  phone?: string
  city?: string
  address?: string
  customerLocation?: { lat?: number; lng?: number }
  locationAccuracy?: number
  locationCapturedAt?: string
  addressSource?: string
  items: AdminOrderItem[]
  /** ملاحظة اختيارية كتبها العميل — غير موجودة في الطلبات القديمة. */
  customerNote?: string
  shippingMethod?: string
  shippingPrice?: number
  couponCode?: string
  discount?: number
  subtotal?: number
  total?: number
  currency?: string
  createdAt?: string

  // ---------- التوصيل ----------
  /** لقطة المندوب — تغيب في الطلبات القديمة وغير الموزّعة. */
  courierSnapshot?: CourierSnapshot
  courierAssignedAt?: string
  deliveredAt?: string
  statusHistory?: OrderStatusHistoryEntry[]

  // ---------- الدفع (منفصل تماماً عن status) ----------
  paymentMethod?: PaymentMethod
  paymentStatus?: PaymentStatus
  paymentAccountSnapshot?: PaymentAccountSnapshot
  transferSenderName?: string
  transferReference?: string
  transferSubmittedAt?: string
  /** هل يوجد إثبات حوالة محفوظ؟ لا نعيد الملف أو رابطه إطلاقاً. */
  hasPaymentProof?: boolean
  paymentProofUploadedAt?: string
  paymentVerifiedAt?: string
  paymentRejectedAt?: string
  paymentRejectionReason?: string
  paymentAdminNote?: string
  duplicateTransferReference?: boolean
  paymentStatusHistory?: PaymentStatusHistoryEntry[]
}

/** حقول الطلب الكاملة — تُستخدم في صفحة واحدة فقط من الطلبات. */
const ORDER_FIELDS = /* groq */ `
  _id, orderNumber, "rawStatus": status, customerId, customerName, phone, city, address,
  "customerLocation": { "lat": customerLocation.lat, "lng": customerLocation.lng },
  locationAccuracy, locationCapturedAt, addressSource,
  "items": coalesce(items[]{ productId, productNumber, sku, image, name, size, color, quantity, price, lineTotal }, []),
  customerNote,
  shippingMethod, shippingPrice, couponCode, discount, subtotal, total, currency, createdAt,
  "courierSnapshot": {
    "courierId": coalesce(courierSnapshot.courierId, courier._ref),
    "name": coalesce(courierSnapshot.name, courier->name),
    "phone": coalesce(courierSnapshot.phone, courier->phone)
  },
  courierAssignedAt, deliveredAt,
  "statusHistory": coalesce(statusHistory[]{ from, to, changedAt, changedBy, note }, []),
  paymentMethod, paymentStatus,
  "paymentAccountSnapshot": paymentAccountSnapshot{
    sourceDocumentId, providerName, accountDisplayName, accountHolderName, accountNumber, imageUrl
  },
  transferSenderName, transferReference, transferSubmittedAt,
  "hasPaymentProof": defined(paymentProof.asset.asset._ref),
  "paymentProofUploadedAt": paymentProof.uploadedAt,
  paymentVerifiedAt, paymentRejectedAt, paymentRejectionReason, paymentAdminNote,
  "duplicateTransferReference": coalesce(duplicateTransferReference, false),
  "paymentStatusHistory": coalesce(paymentStatusHistory[]{ status, changedAt, changedBy, note }, [])
`

/**
 * القيم الخام المقبولة لكل حالة — تشمل الأسماء القديمة
 * حتى تظهر الطلبات السابقة عند التصفية بالحالة الجديدة.
 */
const STATUS_RAW_VALUES: Record<OrderStatus, string[]> = {
  new: ["new"],
  confirmed: ["confirmed"],
  processing: ["processing"],
  ready: ["ready"],
  assigned: ["assigned"],
  on_the_way: ["on_the_way", "shipped"],
  delivered: ["delivered", "completed"],
  failed: ["failed"],
  cancelled: ["cancelled"],
  returned: ["returned"],
}

export type OrderSortKey = "newest" | "oldest" | "total-desc" | "total-asc"

export type OrderFilters = {
  search?: string
  status?: OrderStatus | "all"
  paymentStatus?: PaymentStatus | "all"
  paymentMethod?: PaymentMethod | "all"
  city?: string
  courierId?: string
  /** الطلبات التي لم يُعيّن لها مندوب فقط. */
  unassignedOnly?: boolean
  /** تاريخ الطلب (YYYY-MM-DD). */
  dateFrom?: string
  dateTo?: string
  /** تاريخ التسليم (YYYY-MM-DD). */
  deliveredFrom?: string
  deliveredTo?: string
  sort?: OrderSortKey
}

const HAS_COURIER = `(defined(courierSnapshot.courierId) || defined(courier._ref))`

const SORT_CLAUSES: Record<OrderSortKey, string> = {
  newest: "createdAt desc",
  oldest: "createdAt asc",
  "total-desc": "total desc",
  "total-asc": "total asc",
}

/** يبني شروط GROQ ومعاملاتها من الفلاتر — بلا أي دمج نصوص من المستخدم. */
function buildFilter(filters: OrderFilters): {
  clause: string
  params: Record<string, unknown>
} {
  const conditions: string[] = [`_type == "order"`]
  const params: Record<string, unknown> = {}

  const status = filters.status
  if (status && status !== "all") {
    params.statusValues = STATUS_RAW_VALUES[status]
    // "new" تشمل الطلبات القديمة التي لا تحمل حقل حالة إطلاقاً.
    conditions.push(
      status === "new"
        ? `(!defined(status) || status in $statusValues)`
        : `status in $statusValues`,
    )
  }

  if (filters.paymentStatus && filters.paymentStatus !== "all") {
    params.paymentStatus = filters.paymentStatus
    conditions.push(`paymentStatus == $paymentStatus`)
  }

  if (filters.paymentMethod && filters.paymentMethod !== "all") {
    params.paymentMethod = filters.paymentMethod
    conditions.push(`paymentMethod == $paymentMethod`)
  }

  const city = (filters.city ?? "").trim()
  if (city) {
    params.city = city
    conditions.push(`city == $city`)
  }

  if (filters.unassignedOnly) {
    conditions.push(`!${HAS_COURIER}`)
  } else {
    const courierId = (filters.courierId ?? "").trim()
    if (courierId) {
      params.courierId = courierId
      conditions.push(`coalesce(courierSnapshot.courierId, courier._ref) == $courierId`)
    }
  }

  if (filters.dateFrom) {
    params.dateFrom = `${filters.dateFrom}T00:00:00Z`
    conditions.push(`createdAt >= $dateFrom`)
  }
  if (filters.dateTo) {
    params.dateTo = `${filters.dateTo}T23:59:59Z`
    conditions.push(`createdAt <= $dateTo`)
  }
  if (filters.deliveredFrom) {
    params.deliveredFrom = `${filters.deliveredFrom}T00:00:00Z`
    conditions.push(`deliveredAt >= $deliveredFrom`)
  }
  if (filters.deliveredTo) {
    params.deliveredTo = `${filters.deliveredTo}T23:59:59Z`
    conditions.push(`deliveredAt <= $deliveredTo`)
  }

  const search = (filters.search ?? "").trim().slice(0, 120)
  if (search) {
    params.q = `*${search}*`
    // البحث برقم المنتج يعمل أيضاً على الطلبات القديمة بلا لقطة رقم:
    // نطابق الجزء المشتق من معرّف المنتج بعد إزالة البادئة.
    params.qBare = `*${search.replace(/^tj-/i, "")}*`
    conditions.push(
      `(orderNumber match $q || customerName match $q || phone match $q ||
        transferReference match $q || courierSnapshot.name match $q ||
        count(items[productNumber match $q]) > 0 ||
        count(items[sku match $q]) > 0 ||
        count(items[name match $q]) > 0 ||
        count(items[productId match $qBare]) > 0)`,
    )
  }

  return { clause: conditions.join(" && "), params }
}

export type OrdersPage = {
  orders: AdminOrder[]
  total: number
  /** هل يوجد المزيد بعد هذه الدفعة؟ */
  hasMore: boolean
}

const EMPTY_PAGE: OrdersPage = { orders: [], total: 0, hasMore: false }

type RawOrder = Omit<AdminOrder, "status"> & { rawStatus?: string }

function hydrate(raw: RawOrder): AdminOrder {
  const courier = raw.courierSnapshot
  const hasCourier = Boolean((courier?.courierId ?? "").trim())
  return {
    ...raw,
    status: normalizeOrderStatus(raw.rawStatus),
    courierSnapshot: hasCourier ? courier : undefined,
    items: Array.isArray(raw.items) ? raw.items : [],
  }
}

/**
 * يجلب دفعة واحدة من الطلبات مع العدد الكلي المطابق للفلاتر،
 * في استعلام واحد. يعيد دفعة فارغة إن لم يُضبط مشروع الطلبات.
 */
export async function getAdminOrdersPage(
  filters: OrderFilters = {},
  page = 0,
  pageSize = ORDERS_PAGE_SIZE,
): Promise<OrdersPage> {
  if (!ordersClient) return EMPTY_PAGE

  const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 0
  const safeSize = Math.min(Math.max(Math.floor(pageSize) || ORDERS_PAGE_SIZE, 1), 100)
  const { clause, params } = buildFilter(filters)
  const sort = SORT_CLAUSES[filters.sort ?? "newest"]
  const offset = safePage * safeSize

  const query = /* groq */ `{
    "orders": *[${clause}] | order(${sort}) [$offset...$end]{ ${ORDER_FIELDS} },
    "total": count(*[${clause}])
  }`

  try {
    const result = await ordersClient.fetch<{ orders: RawOrder[]; total: number }>(
      query,
      { ...params, offset, end: offset + safeSize },
      { cache: "no-store" },
    )
    const orders = (result?.orders ?? []).map(hydrate)
    const total = typeof result?.total === "number" ? result.total : orders.length
    return { orders, total, hasMore: offset + orders.length < total }
  } catch (error) {
    console.error("[v0] getAdminOrdersPage failed:", error)
    return EMPTY_PAGE
  }
}

// ============================================
// الإحصائيات وتقسيم المدن — استعلام واحد خفيف الحقول
// ============================================

export type OrderStatusCounts = Record<OrderStatus, number> & { all: number }

export type CityStats = {
  city: string
  total: number
  newOrders: number
  unassigned: number
  onTheWay: number
  delivered: number
  customers: number
}

export type OrderStats = {
  statusCounts: OrderStatusCounts
  paymentCounts: Record<string, number>
  /** الطلبات التي لم يُعيّن لها مندوب — عبر كل الحالات. */
  unassigned: number
  cities: CityStats[]
  /** كل المدن الموجودة في الطلبات، مرتبة أبجدياً — لقائمة التصفية. */
  cityNames: string[]
  /** إجمالي الطلبات في المشروع. */
  total: number
}

function emptyStatusCounts(): OrderStatusCounts {
  const counts = { all: 0 } as OrderStatusCounts
  for (const s of ORDER_STATUSES) counts[s] = 0
  return counts
}

export const EMPTY_ORDER_STATS: OrderStats = {
  statusCounts: emptyStatusCounts(),
  paymentCounts: {},
  unassigned: 0,
  cities: [],
  cityNames: [],
  total: 0,
}

type StatsRow = {
  status?: string
  paymentStatus?: string
  city?: string
  customerId?: string
  phone?: string
  hasCourier?: boolean
}

const STATS_QUERY = /* groq */ `*[_type == "order"]{
  status, paymentStatus, city, customerId, phone,
  "hasCourier": ${HAS_COURIER}
}`

/**
 * يحسب كل عدّادات الملخص وتقسيم المدن من استعلام واحد يعيد
 * ستة حقول صغيرة لكل طلب — لا يجلب المنتجات ولا بيانات الدفع.
 */
export async function getAdminOrderStats(): Promise<OrderStats> {
  if (!ordersClient) return EMPTY_ORDER_STATS

  let rows: StatsRow[] = []
  try {
    rows = await ordersClient.fetch<StatsRow[]>(STATS_QUERY, {}, { cache: "no-store" })
  } catch (error) {
    console.error("[v0] getAdminOrderStats failed:", error)
    return EMPTY_ORDER_STATS
  }

  const statusCounts = emptyStatusCounts()
  const paymentCounts: Record<string, number> = {}
  let unassigned = 0

  // نجمع لكل مدينة عدّاداتها ومجموعة مفاتيح عملائها الفريدة.
  const cityMap = new Map<
    string,
    { counts: Omit<CityStats, "city" | "customers">; customers: Set<string> }
  >()

  for (const row of rows ?? []) {
    const status = normalizeOrderStatus(row.status)
    statusCounts.all += 1
    statusCounts[status] += 1

    if (row.paymentStatus) {
      paymentCounts[row.paymentStatus] = (paymentCounts[row.paymentStatus] ?? 0) + 1
    }

    const isUnassigned = !row.hasCourier
    if (isUnassigned) unassigned += 1

    const city = (row.city ?? "").trim() || "بلا مدينة"
    let entry = cityMap.get(city)
    if (!entry) {
      entry = {
        counts: { total: 0, newOrders: 0, unassigned: 0, onTheWay: 0, delivered: 0 },
        customers: new Set<string>(),
      }
      cityMap.set(city, entry)
    }
    entry.counts.total += 1
    if (status === "new") entry.counts.newOrders += 1
    if (isUnassigned) entry.counts.unassigned += 1
    if (status === "on_the_way") entry.counts.onTheWay += 1
    if (status === "delivered") entry.counts.delivered += 1

    // العميل يُعرف بـ customerId إن وُجد، وإلا بالهاتف الموحّد.
    const key = customerKey({ customerId: row.customerId, phone: row.phone })
    if (key) entry.customers.add(key)
  }

  const cities: CityStats[] = [...cityMap.entries()]
    .map(([city, entry]) => ({ city, ...entry.counts, customers: entry.customers.size }))
    .sort((a, b) => b.total - a.total || a.city.localeCompare(b.city, "ar"))

  return {
    statusCounts,
    paymentCounts,
    unassigned,
    cities,
    cityNames: cities.map((c) => c.city).sort((a, b) => a.localeCompare(b, "ar")),
    total: statusCounts.all,
  }
}
