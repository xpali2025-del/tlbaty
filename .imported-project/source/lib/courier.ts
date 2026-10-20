// ============================================
// نموذج المندوب — مشترك بين الخادم والواجهة (بلا server-only)
//
// المندوب مستند في مشروع Sanity الخاص بالطلبات، ولا يملك حساب دخول
// ولا تطبيقاً خاصاً في هذه المرحلة.
// ============================================

export type CourierStatus = "active" | "suspended"

/** صفّ ثابت (tuple) حتى يقبله z.enum مباشرة في Server Actions. */
export const COURIER_STATUSES = ["active", "suspended"] as const satisfies readonly CourierStatus[]

export const COURIER_STATUS_LABELS: Record<CourierStatus, string> = {
  active: "نشط",
  suspended: "موقوف",
}

export const COURIER_STATUS_BADGE: Record<CourierStatus, string> = {
  active: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  suspended: "bg-muted text-muted-foreground",
}

export function isCourierStatus(value: unknown): value is CourierStatus {
  return (
    typeof value === "string" && COURIER_STATUSES.includes(value as CourierStatus)
  )
}

/** يوحّد حالة المندوب القادمة من Sanity — أي قيمة مجهولة تُعالج كنشط. */
export function normalizeCourierStatus(value: unknown): CourierStatus {
  return isCourierStatus(value) ? value : "active"
}

/** المندوب كما يُقرأ في لوحة الإدارة. */
export type Courier = {
  _id: string
  name: string
  phone?: string
  imageUrl?: string
  cities: string[]
  status: CourierStatus
  adminNote?: string
  createdAt?: string
  /** إحصائيات محسوبة من الطلبات — لا تُحفظ في المستند. */
  stats: CourierStats
}

export type CourierStats = {
  /** كل الطلبات المسندة إليه على مرّ الوقت. */
  assigned: number
  /** الطلبات التي حالتها "في الطريق". */
  onTheWay: number
  /** الطلبات المنفذة (تم التسليم). */
  delivered: number
  /** الطلبات التي تعذّر تسليمها. */
  failed: number
}

export const EMPTY_COURIER_STATS: CourierStats = {
  assigned: 0,
  onTheWay: 0,
  delivered: 0,
  failed: 0,
}

/**
 * لقطة ثابتة من بيانات المندوب تُحفظ داخل الطلب.
 * تحمي الطلبات القديمة إذا عُدّل اسم المندوب أو رقمه لاحقاً.
 */
export type CourierSnapshot = {
  courierId?: string
  name?: string
  phone?: string
}

/** اسم المندوب المعروض في الطلب، أو رسالة واضحة عند غيابه. */
export function describeCourier(snapshot: CourierSnapshot | undefined): string {
  const name = (snapshot?.name ?? "").trim()
  return name || "لم يتم تعيين مندوب"
}
