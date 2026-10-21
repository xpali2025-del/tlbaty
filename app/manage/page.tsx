import { redirect } from "next/navigation"
import { getManageContext } from "@/lib/manage-auth"
import { ROLE_LABELS, type Screen } from "@/lib/permissions"
import {
  getAdminProducts,
  getAdminCategories,
  getAdminBrands,
  getAdminSlides,
  getAdminCoupons,
  getAdminReviews,
  getAdminAds,
  getAdminSettings,
  getAdminShipping,
  getAdminPaymentAccounts,
} from "@/lib/admin"
import { EMPTY_ORDER_STATS, getAdminOrdersPage, getAdminOrderStats } from "@/lib/admin-orders"
import { getAdminCouriers } from "@/lib/admin-couriers"
import { EMPTY_ADMIN_NOTIFICATIONS, getAdminNotifications } from "@/lib/admin-notifications"
import { getAdminUsers } from "@/lib/manage-users"
import { Dashboard } from "./dashboard"

// قراءة الكوكي في isManageAuthed تجعل الصفحة ديناميكية تلقائياً،
// وبيانات الإدارة تُجلب بـ no-store، فتظل اللوحة خارج استراتيجية On-Demand Revalidation.

export default async function ManagePage() {
  const ctx = await getManageContext()
  if (!ctx) {
    redirect("/manage/login")
  }
  const can = (screen: Screen) => ctx.permissions.includes(screen)
  // لا نستعلم ولا نرسل للمتصفح إلا بيانات الشاشات المسموحة (أسرع وأكثر أماناً).
  const need = <T,>(allowed: boolean, empty: T, load: () => Promise<T>) => (allowed ? load() : Promise.resolve(empty))

  const wantsCategories = can("products") || can("categories") || can("ads")
  const [
    products,
    categories,
    brands,
    slides,
    coupons,
    reviews,
    ads,
    settings,
    shipping,
    ordersPage,
    orderStats,
    couriers,
    users,
    paymentAccounts,
    notifications,
  ] = await Promise.all([
    need(can("products"), [], getAdminProducts),
    need(wantsCategories, [], getAdminCategories),
    need(can("products") || can("brands"), [], getAdminBrands),
    need(can("slides"), [], getAdminSlides),
    need(can("coupons"), [], getAdminCoupons),
    need(can("reviews"), [], getAdminReviews),
    need(can("ads"), [], getAdminAds),
    need(can("settings"), null, getAdminSettings),
    need(can("shipping") || can("currencies"), { zones: [], currencies: [], defaultCurrency: "YER" }, async () => {
      const data = await getAdminShipping()
      return {
        zones: can("shipping") ? data.zones : [],
        currencies: can("currencies") ? data.currencies : [],
        defaultCurrency: can("currencies") ? data.defaultCurrency : "YER",
      }
    }),
    // الدفعة الأولى فقط من الطلبات — الباقي يُحمَّل عند الطلب.
    need(can("orders"), { orders: [], total: 0, hasMore: false }, () => getAdminOrdersPage({ status: "all", sort: "newest" }, 0)),
    need(can("orders"), EMPTY_ORDER_STATS, getAdminOrderStats),
    need(can("orders") || can("couriers"), [], getAdminCouriers),
    need(can("users"), [], getAdminUsers),
    need(can("payment-accounts"), [], getAdminPaymentAccounts),
    need(can("notifications"), EMPTY_ADMIN_NOTIFICATIONS, getAdminNotifications),
  ])

  return (
    <Dashboard
      products={products}
      categories={categories}
      brands={brands}
      slides={slides}
      coupons={coupons}
      reviews={reviews}
      ads={ads}
      settings={settings}
      shipping={shipping}
      ordersPage={ordersPage}
      orderStats={orderStats}
      couriers={couriers}
      users={users}
      paymentAccounts={paymentAccounts}
      notifications={notifications}
      currentUser={ctx.username}
      permissions={ctx.permissions}
      roleLabel={ctx.role === "owner" ? "المالك" : ROLE_LABELS[ctx.role]}
    />
  )
}
