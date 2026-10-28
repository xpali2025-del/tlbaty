// ============================================
// حالات الطلب — منفصلة تماماً عن حالة الدفع (lib/payment.ts)
//
// قاعدة أساسية: تغيير حالة الطلب لا يغيّر حالة الدفع إطلاقاً، والعكس صحيح.
// تعيين مندوب لا يغيّر الحالة تلقائياً — تغيير الحالة إجراء مستقل وواضح.
//
// يدعم هذا الملف الطلبات القديمة التي حُفظت بالحالات الخمس الأولى
// ("shipped" و"completed") عبر normalizeOrderStatus.
// ============================================

export type OrderStatus =
  | "new"
  | "confirmed"
  | "processing"
  | "ready"
  | "assigned"
  | "on_the_way"
  | "delivered"
  | "failed"
  | "cancelled"
  | "returned"

export const ORDER_STATUSES: OrderStatus[] = [
  "new",
  "confirmed",
  "processing",
  "ready",
  "assigned",
  "on_the_way",
  "delivered",
  "failed",
  "cancelled",
  "returned",
]

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  new: "طلب جديد",
  confirmed: "تم تأكيد الطلب",
  processing: "قيد التجهيز",
  ready: "جاهز للتوصيل",
  assigned: "تم تعيين مندوب",
  on_the_way: "في الطريق",
  delivered: "تم التسليم",
  failed: "تعذر التسليم",
  cancelled: "ملغي",
  returned: "مرتجع",
}

/**
 * شارات الحالات — ألوان واضحة ومتباينة حسب المطلوب:
 * جديد أزرق، قيد التجهيز برتقالي، في الطريق بنفسجي،
 * تم التسليم أخضر، تعذر التسليم أحمر، ملغي رمادي.
 */
export const ORDER_STATUS_BADGE: Record<OrderStatus, string> = {
  new: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  confirmed: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  processing: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
  ready: "bg-teal-500/15 text-teal-600 dark:text-teal-400",
  assigned: "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400",
  on_the_way: "bg-violet-500/15 text-violet-600 dark:text-violet-400",
  delivered: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  failed: "bg-red-500/15 text-red-600 dark:text-red-400",
  cancelled: "bg-muted text-muted-foreground",
  returned: "bg-rose-500/15 text-rose-700 dark:text-rose-400",
}

/** الحالات المنتهية — لا يُسمح بأي انتقال بعدها. */
const TERMINAL: OrderStatus[] = ["cancelled", "returned"]

/**
 * الانتقالات المسموحة. أي انتقال غير مذكور هنا مرفوض من الخادم،
 * حتى لا تُقفز مراحل التجهيز أو يُعاد تسليم طلب ملغي.
 */
const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  new: ["confirmed", "processing", "cancelled"],
  confirmed: ["processing", "ready", "cancelled"],
  processing: ["ready", "cancelled"],
  ready: ["assigned", "on_the_way", "processing", "cancelled"],
  assigned: ["on_the_way", "ready", "cancelled"],
  on_the_way: ["delivered", "failed"],
  delivered: ["returned"],
  failed: ["assigned", "on_the_way", "returned", "cancelled"],
  cancelled: [],
  returned: [],
}

/** خرائط الحالات القديمة المحفوظة في طلبات سابقة. */
const LEGACY_ALIASES: Record<string, OrderStatus> = {
  shipped: "on_the_way",
  completed: "delivered",
}

export function isOrderStatus(value: unknown): value is OrderStatus {
  return typeof value === "string" && (ORDER_STATUSES as string[]).includes(value)
}

/**
 * يوحّد قيمة الحالة القادمة من قاعدة البيانات: يقبل الحالات الجديدة،
 * ويترجم الحالات القديمة، ويرجع "new" لأي قيمة مفقودة أو مجهولة
 * حتى لا تتعطل الطلبات القديمة.
 */
export function normalizeOrderStatus(value: unknown): OrderStatus {
  if (isOrderStatus(value)) return value
  if (typeof value === "string" && value in LEGACY_ALIASES) return LEGACY_ALIASES[value]
  return "new"
}

export function isTerminalOrderStatus(status: OrderStatus): boolean {
  return TERMINAL.includes(status)
}

/** الانتقالات المتاحة من الحالة الحالية. */
export function allowedOrderTransitions(current: OrderStatus): OrderStatus[] {
  return TRANSITIONS[current] ?? []
}

export function canTransitionOrder(current: OrderStatus, next: OrderStatus): boolean {
  return allowedOrderTransitions(current).includes(next)
}

/** عنصر واحد من سجل تغييرات حالة الطلب. */
export type OrderStatusHistoryEntry = {
  from?: string
  to?: string
  changedAt?: string
  changedBy?: string
  note?: string
}

/** نص الحالة، مع دعم القيم القديمة والمفقودة. */
export function describeOrderStatus(value: unknown): string {
  return ORDER_STATUS_LABELS[normalizeOrderStatus(value)]
}

/** طلب «مفتوح»: ما زال يحتاج عملاً من المندوب (لم يُسلَّم ولم يُلغَ ولم يُرجَع ولم يفشل تسليمه). */
/**
 * هل ما زال الطلب يحجز مخزونه ومبلغه المدفوع؟ كل ما لم يُسلَّم ولم يُلغَ ولم يُرجَع.
 * «تعذر التسليم» ليست نهائية (تنتقل بعدها إلى ملغي/مُرجَع/إعادة إسناد)، فتبقى تحجزهما — بخلاف isOpenOrderStatus.
 */
export function holdsStockAndPayment(status: OrderStatus): boolean {
  return !["delivered", "cancelled", "returned"].includes(status)
}

export function isOpenOrderStatus(status: OrderStatus): boolean {
  return !["delivered", "cancelled", "returned", "failed"].includes(status)
}
