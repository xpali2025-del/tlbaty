// أي بيانات تحتاجها كل شاشة في اللوحة. يشترك فيه الخادم (ماذا يُحمَّل) والمتصفح (ماذا يُحدَّث).
//
// بعد أي حفظ يعيد Next.js رسم /manage ضمن رد الإجراء نفسه. لو حمّلنا بيانات كل الشاشات (~50 استعلاماً)
// لانتظر المدير ذلك كله مع كل حفظ؛ لذا يُحمَّل في إعادة الرسم ما تعرضه الشاشة المفتوحة فقط،
// وتبقى بيانات الشاشات الأخرى في المتصفح وتُحدَّث عند فتحها.
import type { Screen } from "@/lib/permissions"

export const DATA_KEYS = [
  "products",
  "categories",
  "brands",
  "slides",
  "coupons",
  "reviews",
  "ads",
  "settings",
  "shipping",
  "wallets",
  "marketing",
  "sizeCharts",
  "ordersPage",
  "orderStats",
  "couriers",
  "users",
  "paymentAccounts",
  "notifications",
] as const

export type DataKey = (typeof DATA_KEYS)[number]

export const SCREEN_DATA: Record<Screen, readonly DataKey[]> = {
  orders: ["ordersPage", "orderStats", "couriers"],
  couriers: ["couriers"],
  notifications: ["notifications"],
  "payment-accounts": ["paymentAccounts"],
  products: ["products", "categories", "brands", "sizeCharts"],
  categories: ["categories"],
  brands: ["brands"],
  slides: ["slides"],
  coupons: ["coupons"],
  reviews: ["reviews"],
  ads: ["ads", "categories"],
  users: ["users"],
  shipping: ["shipping"],
  currencies: ["shipping"],
  wallets: ["wallets"],
  marketing: ["marketing"],
  "size-charts": ["sizeCharts"],
  settings: ["settings"],
}

/** معامل الرابط الذي يحمل الشاشة المفتوحة (?tab=products). */
export const TAB_PARAM = "tab"
