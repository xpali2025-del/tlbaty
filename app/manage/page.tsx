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
  getAdminSizeCharts,
} from "@/lib/admin"
import { EMPTY_ORDER_STATS, getAdminOrdersPage, getAdminOrderStats } from "@/lib/admin-orders"
import { getAdminCouriers } from "@/lib/admin-couriers"
import { EMPTY_ADMIN_WALLETS, getAdminWalletOverview } from "@/lib/admin-wallet"
import { EMPTY_ADMIN_MARKETING, getAdminMarketing } from "@/lib/admin-marketing"
import { EMPTY_ADMIN_NOTIFICATIONS, getAdminNotifications } from "@/lib/admin-notifications"
import { getAdminUsers } from "@/lib/manage-users"
import { classifyDbError, DB_ERROR_HINTS } from "@/lib/db-error"
import { Dashboard } from "./dashboard"
import { LoadFailure } from "./load-failure"

// قراءة الكوكي في isManageAuthed تجعل الصفحة ديناميكية تلقائياً،
// وبيانات الإدارة تُجلب بـ no-store، فتظل اللوحة خارج استراتيجية On-Demand Revalidation.

async function loadAll(
  can: (screen: Screen) => boolean,
  need: <T>(allowed: boolean, empty: T, load: () => Promise<T>) => Promise<T>,
) {
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
    walletOverview,
    marketing,
    sizeCharts,
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
    need(can("wallets"), EMPTY_ADMIN_WALLETS, getAdminWalletOverview),
    need(can("marketing"), EMPTY_ADMIN_MARKETING, getAdminMarketing),
    // المنتجات تحتاج الجداول لاختيارها في نموذج المنتج، فتُحمَّل لمن يملك إحدى الصلاحيتين.
    need(can("size-charts") || can("products"), [], getAdminSizeCharts),
    // الدفعة الأولى فقط من الطلبات — الباقي يُحمَّل عند الطلب.
    need(can("orders"), { orders: [], total: 0, hasMore: false }, () => getAdminOrdersPage({ status: "all", sort: "newest" }, 0)),
    need(can("orders"), EMPTY_ORDER_STATS, getAdminOrderStats),
    need(can("orders") || can("couriers"), [], getAdminCouriers),
    need(can("users"), [], getAdminUsers),
    need(can("payment-accounts"), [], getAdminPaymentAccounts),
    need(can("notifications"), EMPTY_ADMIN_NOTIFICATIONS, getAdminNotifications),
  ])
  return { products, categories, brands, slides, coupons, reviews, ads, settings, shipping, walletOverview, marketing, sizeCharts, ordersPage, orderStats, couriers, users, paymentAccounts, notifications }
}

export default async function ManagePage() {
  const ctx = await getManageContext()
  if (!ctx) {
    redirect("/manage/login")
  }
  const can = (screen: Screen) => ctx.permissions.includes(screen)
  // لا نستعلم ولا نرسل للمتصفح إلا بيانات الشاشات المسموحة (أسرع وأكثر أماناً).
  const need = <T,>(allowed: boolean, empty: T, load: () => Promise<T>) => (allowed ? load() : Promise.resolve(empty))

  let data: Awaited<ReturnType<typeof loadAll>>
  try {
    data = await loadAll(can, need)
  } catch (error) {
    // صفحة بيضاء لا تخبر المدير بشيء: نشخّص السبب (ترحيلات/اتصال/صلاحية) ونعرضه، ونسجّل التفاصيل في سجلات الخادم.
    console.error("manage page load failed:", error)
    const kind = classifyDbError(error)
    const digest = typeof (error as { digest?: unknown })?.digest === "string" ? (error as { digest: string }).digest : null
    return <LoadFailure hint={DB_ERROR_HINTS[kind]} kind={kind} digest={digest} />
  }
  const { products, categories, brands, slides, coupons, reviews, ads, settings, shipping, walletOverview, marketing, sizeCharts, ordersPage, orderStats, couriers, users, paymentAccounts, notifications } = data

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
      wallets={walletOverview}
      marketing={marketing}
      sizeCharts={sizeCharts}
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
