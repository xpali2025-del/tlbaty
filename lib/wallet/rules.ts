// قواعد الرصيد وحدوده. بلا اعتماد على الخادم فتُستعمل في الواجهة للتحقق السريع، لكن الفرض الفعلي على الخادم.
// كل المبالغ بالعملة الأساسية (الريال اليمني القديم) مثل أسعار المنتجات.

export const MIN_TOPUP_BASE = 1_000
export const MAX_TOPUP_BASE = 500_000
/** أقصى رصيد تتحمله المحفظة (سقف يحدّ من أثر أي اختراق للحساب). */
export const MAX_BALANCE_BASE = 2_000_000
/** أقصى ما يُصرف من الرصيد خلال 24 ساعة. */
export const DAILY_SPEND_LIMIT_BASE = 1_000_000
export const MAX_PENDING_TOPUPS = 2
export const MAX_TOPUPS_PER_DAY = 5
/** بعد هذا العدد من طلبات الشحن المرفوضة خلال 7 أيام يُوقَف الشحن مؤقتاً. */
export const MAX_REJECTED_TOPUPS_7D = 3
/** شحن بهذا المبلغ فأكثر يُعلَّم «كبير» للمراجع. */
export const LARGE_TOPUP_BASE = 200_000
/** أقصى تعديل يدوي من الإدارة في العملية الواحدة. */
export const MAX_ADMIN_ADJUST_BASE = 500_000
/** بعد تغيير رقم الهاتف يُمنع الدفع من الرصيد لهذه المدة (حماية من سرقة الحساب). */
export const PHONE_CHANGE_COOLDOWN_MS = 24 * 3_600_000

export type WalletErrorCode =
  | "INSUFFICIENT"
  | "FROZEN"
  | "LIMIT"
  | "DAILY_LIMIT"
  | "COOLDOWN"
  | "DISABLED"
  | "TOO_MANY_PENDING"
  | "TOO_MANY_REQUESTS"
  | "TOO_MANY_REJECTED"
  | "DUPLICATE_REFERENCE"
  | "NOT_PENDING"
  | "NOT_FOUND"
  | "INVALID"

/** حدث أمني يُسجَّل بعد تراجع المعاملة (داخلها كان سيتراجع معها). */
export type WalletAuditEvent = { customerId: string; action: string; detail?: Record<string, unknown> }

export class WalletError extends Error {
  constructor(readonly code: WalletErrorCode, message: string, readonly auditEvent?: WalletAuditEvent) {
    super(message)
  }
}

export const WALLET_KIND_LABELS = {
  topup: "شحن رصيد",
  order_payment: "دفع طلب",
  order_refund: "إرجاع مبلغ طلب",
  admin_credit: "إضافة من الإدارة",
  admin_debit: "خصم من الإدارة",
} as const

export type WalletKind = keyof typeof WALLET_KIND_LABELS

/** المرجع بصيغة موحّدة (أحرف كبيرة، بلا مسافات/شرطات) فلا يتحايل أحد بتغيير الشكل لتكرار نفس الحوالة. */
export function normalizeReference(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[\s\-/]+/g, "")
    .toUpperCase()
}

/** مبلغ صالح: رقم موجب منتهٍ بخانتين عشريتين كحد أقصى. */
export function parseAmount(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : NaN
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.round(n * 100) / 100
}
