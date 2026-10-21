import { redirect } from "next/navigation"
import { isManageAuthed, getManageSessionUser } from "@/lib/manage-auth"
import {
  getAdminProducts,
  getAdminCategories,
  getAdminBrands,
  getAdminSlides,
  getAdminCoupons,
  getAdminReviews,
  getAdminAds,
  getAdminSettings,
  getAdminPaymentAccounts,
} from "@/lib/admin"
import { getAdminOrdersPage, getAdminOrderStats } from "@/lib/admin-orders"
import { getAdminCouriers } from "@/lib/admin-couriers"
import { getAdminNotifications } from "@/lib/admin-notifications"
import { getAdminUsers } from "@/lib/manage-users"
import { Dashboard } from "./dashboard"

// قراءة الكوكي في isManageAuthed تجعل الصفحة ديناميكية تلقائياً،
// وبيانات الإدارة تُجلب بـ no-store، فتظل اللوحة خارج استراتيجية On-Demand Revalidation.

export default async function ManagePage() {
  if (!(await isManageAuthed())) {
    redirect("/manage/login")
  }

  const [
    products,
    categories,
    brands,
    slides,
    coupons,
    reviews,
    ads,
    settings,
    ordersPage,
    orderStats,
    couriers,
    users,
    paymentAccounts,
    notifications,
    currentUser,
  ] = await Promise.all([
      getAdminProducts(),
      getAdminCategories(),
      getAdminBrands(),
      getAdminSlides(),
      getAdminCoupons(),
      getAdminReviews(),
      getAdminAds(),
      getAdminSettings(),
      // الدفعة الأولى فقط من الطلبات — الباقي يُحمَّل عند الطلب.
      getAdminOrdersPage({ status: "all", sort: "newest" }, 0),
      getAdminOrderStats(),
      getAdminCouriers(),
    getAdminUsers(),
    getAdminPaymentAccounts(),
    getAdminNotifications(),
    getManageSessionUser(),
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
      ordersPage={ordersPage}
      orderStats={orderStats}
      couriers={couriers}
      users={users}
      paymentAccounts={paymentAccounts}
      notifications={notifications}
      currentUser={currentUser}
    />
  )
}
