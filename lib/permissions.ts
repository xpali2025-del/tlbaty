// صلاحيات لوحة الإدارة: كل «شاشة» صلاحية مستقلة. الملف خالٍ من أي اعتماد على الخادم
// فيُستخدم في الواجهة (إخفاء الشاشات) وفي الخادم (فرض الصلاحية في كل إجراء).

export const SCREENS = [
  "orders",
  "couriers",
  "notifications",
  "payment-accounts",
  "products",
  "categories",
  "brands",
  "slides",
  "coupons",
  "reviews",
  "ads",
  "shipping",
  "currencies",
  "wallets",
  "marketing",
  "size-charts",
  "settings",
  "users",
] as const

export type Screen = (typeof SCREENS)[number]

export const SCREEN_LABELS: Record<Screen, string> = {
  orders: "الطلبات",
  couriers: "المناديب وتوزيع الطلبات",
  notifications: "الإشعارات",
  "payment-accounts": "حسابات الدفع",
  products: "المنتجات",
  categories: "الأقسام",
  brands: "البراندات",
  slides: "السلايدر",
  coupons: "أكواد الخصم",
  reviews: "آراء العملاء",
  ads: "الإعلانات",
  shipping: "الشحن",
  currencies: "العملات وأسعار الصرف",
  wallets: "المحافظ والرصيد",
  marketing: "التذكيرات والعروض",
  "size-charts": "جداول المقاسات",
  settings: "إعدادات المتجر",
  users: "المستخدمون والصلاحيات",
}

export const ROLES = ["admin", "manager", "editor", "operator"] as const
export type Role = (typeof ROLES)[number]

export const ROLE_LABELS: Record<Role, string> = {
  admin: "مدير عام",
  manager: "مدير متجر",
  editor: "محرر محتوى",
  operator: "مشغّل طلبات",
}

/** الصلاحيات الافتراضية لكل دور؛ يمكن تخصيصها لكل مستخدم عند إنشائه أو تعديله. */
export const ROLE_PRESETS: Record<Role, readonly Screen[]> = {
  admin: SCREENS,
  manager: SCREENS.filter((s) => s !== "users"),
  editor: ["products", "size-charts", "categories", "brands", "slides", "coupons", "reviews", "ads", "notifications"],
  operator: ["orders", "couriers", "notifications"],
}

export function isScreen(value: unknown): value is Screen {
  return typeof value === "string" && (SCREENS as readonly string[]).includes(value)
}

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value)
}

/** يُنظّف قائمة صلاحيات قادمة من نموذج: قيم معروفة فقط، بلا تكرار، بترتيب ثابت. */
export function normalizePermissions(input: unknown): Screen[] {
  if (!Array.isArray(input)) return []
  const wanted = new Set(input.filter(isScreen))
  return SCREENS.filter((s) => wanted.has(s))
}

export function hasScreen(permissions: ReadonlySet<Screen> | readonly Screen[], screen: Screen): boolean {
  return Array.isArray(permissions) ? permissions.includes(screen) : (permissions as ReadonlySet<Screen>).has(screen)
}
