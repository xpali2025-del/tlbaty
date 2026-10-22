// ============================================
// نموذج الدفع المشترك بين الواجهة والخادم (بلا server-only حتى تستفيد منه الواجهة)
//
// فصل تام بين ثلاثة أمور:
//   1) طريقة الدفع        => paymentMethod
//   2) حالة التحقق من الدفع => paymentStatus
//   3) حالة الطلب          => status (موجودة أصلاً ولا تتأثر تلقائياً)
// ============================================

/**
 * المزوّدون الأوليون — يظهرون كخيارات مقترحة في لوحة الإدارة،
 * ويمكن دائماً إدخال اسم مزوّد جديد غير موجود في القائمة.
 */
export const INITIAL_PAYMENT_PROVIDERS = ["خدمة حاسب", "جيب", "جوالي", "قطبي"] as const

/** طريقة الدفع التي اختارها العميل. */
export type PaymentMethod = "cash_on_delivery" | "manual_transfer" | "wallet"

/** حالة الدفع/التحقق — منفصلة تماماً عن حالة الطلب. */
export type PaymentStatus =
  | "pending_on_delivery"
  | "pending_verification"
  | "verified"
  | "rejected"
  | "paid"
  | "refunded"
  | "cancelled"

export const PAYMENT_METHODS: PaymentMethod[] = ["cash_on_delivery", "manual_transfer", "wallet"]

export const PAYMENT_STATUSES: PaymentStatus[] = [
  "pending_on_delivery",
  "pending_verification",
  "verified",
  "rejected",
  "paid",
  "refunded",
  "cancelled",
]

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash_on_delivery: "الدفع عند الاستلام",
  manual_transfer: "الدفع عبر حساب دفع",
  wallet: "الدفع من الرصيد",
}

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  pending_on_delivery: "الدفع عند الاستلام",
  pending_verification: "جارٍ التحقق من الدفع",
  verified: "تم التحقق من الدفع",
  rejected: "تعذّر التحقق من الدفع",
  paid: "تم الدفع",
  refunded: "تمت إعادة المبلغ",
  cancelled: "دفع ملغي",
}

/**
 * أصناف الشارات لحالة الدفع في لوحة الإدارة.
 * ألوان مميزة عن شارات حالة الطلب حتى لا يختلط الحقلان بصرياً.
 */
export const PAYMENT_STATUS_BADGE: Record<PaymentStatus, string> = {
  pending_on_delivery: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
  pending_verification: "bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/30",
  verified: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  rejected: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30",
  paid: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  refunded: "bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/30",
  cancelled: "bg-muted text-muted-foreground border-border",
}

/** نص مختصر يُعرض للعميل وفي الرسائل. */
export const PAYMENT_STATUS_CUSTOMER_LABELS: Record<PaymentStatus, string> = {
  ...PAYMENT_STATUS_LABELS,
  pending_on_delivery: "بانتظار التحصيل",
}

export function isPaymentMethod(value: unknown): value is PaymentMethod {
  return typeof value === "string" && (PAYMENT_METHODS as string[]).includes(value)
}

export function isPaymentStatus(value: unknown): value is PaymentStatus {
  return typeof value === "string" && (PAYMENT_STATUSES as string[]).includes(value)
}

/** الحالة الابتدائية — يحدّدها الخادم وحده اعتماداً على طريقة الدفع. */
export function initialPaymentStatus(method: PaymentMethod): PaymentStatus {
  if (method === "wallet") return "paid"
  return method === "cash_on_delivery" ? "pending_on_delivery" : "pending_verification"
}

/**
 * الانتقالات المسموحة فقط — مفصولة حسب طريقة الدفع.
 * أي انتقال غير مذكور هنا مرفوض (مثل: دفع عند الاستلام => verified).
 */
const TRANSITIONS: Record<PaymentMethod, Partial<Record<PaymentStatus, PaymentStatus[]>>> = {
  cash_on_delivery: {
    pending_on_delivery: ["paid", "cancelled"],
  },
  manual_transfer: {
    pending_verification: ["verified", "rejected"],
    rejected: ["pending_verification"],
    verified: ["refunded", "cancelled"],
  },
  // الدفع من الرصيد يُخصم لحظة الطلب؛ لا انتقال يدوي — الإرجاع للمحفظة يتم تلقائياً عند إلغاء/إرجاع الطلب.
  wallet: {},
}

/** الانتقالات المتاحة من الحالة الحالية لطريقة دفع معيّنة. */
export function allowedPaymentTransitions(
  method: PaymentMethod,
  current: PaymentStatus,
): PaymentStatus[] {
  return TRANSITIONS[method]?.[current] ?? []
}

export function canTransitionPayment(
  method: PaymentMethod,
  current: PaymentStatus,
  next: PaymentStatus,
): boolean {
  return allowedPaymentTransitions(method, current).includes(next)
}

/** Snapshot ثابت من حساب الدفع يُحفظ داخل الطلب (لا Cross-project Reference). */
export type PaymentAccountSnapshot = {
  sourceDocumentId?: string
  providerName?: string
  accountDisplayName?: string
  accountHolderName?: string
  accountNumber?: string
  imageUrl?: string
}

/** حساب دفع مفعّل كما يُعرض للعميل. */
export type PaymentAccount = {
  id: string
  providerName: string
  accountDisplayName: string
  accountHolderName: string
  accountNumber: string
  imageUrl?: string
  instructions: string
  sortOrder: number
}

/** عنصر واحد من سجل تغييرات حالة الدفع. */
export type PaymentStatusHistoryEntry = {
  status?: PaymentStatus
  changedAt?: string
  changedBy?: string
  note?: string
}

/**
 * نص حالة الدفع مع مراعاة طريقة الدفع:
 * "تم الدفع" في طلب الدفع عند الاستلام تعني "تم الدفع عند التسليم".
 */
export function paymentStatusLabel(
  status: PaymentStatus | undefined,
  method?: PaymentMethod,
): string {
  if (!status) return "حالة الدفع غير مسجلة"
  if (status === "paid" && method === "cash_on_delivery") return "تم الدفع عند التسليم"
  return PAYMENT_STATUS_LABELS[status]
}

/** نص وصفي لطريقة الدفع مع اسم المزوّد إن وُجد، أو رسالة الطلبات القديمة. */
export function describePaymentMethod(
  method: PaymentMethod | undefined,
  providerName?: string,
): string {
  if (method === "cash_on_delivery") return PAYMENT_METHOD_LABELS.cash_on_delivery
  if (method === "wallet") return PAYMENT_METHOD_LABELS.wallet
  if (method === "manual_transfer") {
    return providerName ? `تحويل عبر ${providerName}` : "تحويل عبر حساب دفع"
  }
  return "طريقة الدفع غير مسجلة"
}

/** نص حالة الدفع، أو رسالة واضحة للطلبات القديمة التي لا تحتوي بيانات دفع. */
export function describePaymentStatus(status: PaymentStatus | undefined): string {
  return status ? PAYMENT_STATUS_CUSTOMER_LABELS[status] : "حالة الدفع غير مسجلة"
}
