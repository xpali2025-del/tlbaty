import { redirect } from "next/navigation"
import { getManageContext } from "@/lib/manage-auth"
import { headers } from "next/headers"
import { isScreen, ROLE_LABELS, type Screen } from "@/lib/permissions"
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
import { DATA_KEYS, SCREEN_DATA, TAB_PARAM, type DataKey } from "./screen-data"

// قراءة الكوكي في isManageAuthed تجعل الصفحة ديناميكية تلقائياً،
// وبيانات الإدارة تُجلب بـ no-store، فتظل اللوحة خارج استراتيجية On-Demand Revalidation.

type Can = (screen: Screen) => boolean

/** محمّل كل مفتاح بيانات: من يحق له رؤيته، وقيمته الفارغة لمن لا يحق له. */
function loaders(can: Can) {
  const wantsCategories = can("products") || can("categories") || can("ads")
  const entry = <T,>(allowed: boolean, empty: T, load: () => Promise<T>) => () => (allowed ? load() : Promise.resolve(empty))
  return {
    products: entry(can("products"), [], getAdminProducts),
    categories: entry(wantsCategories, [], getAdminCategories),
    brands: entry(can("products") || can("brands"), [], getAdminBrands),
    slides: entry(can("slides"), [], getAdminSlides),
    coupons: entry(can("coupons"), [], getAdminCoupons),
    reviews: entry(can("reviews"), [], getAdminReviews),
    ads: entry(can("ads"), [], getAdminAds),
    settings: entry(can("settings"), null, getAdminSettings),
    shipping: entry(can("shipping") || can("currencies"), { zones: [], currencies: [], defaultCurrency: "YER" }, async () => {
      const data = await getAdminShipping()
      return {
        zones: can("shipping") ? data.zones : [],
        currencies: can("currencies") ? data.currencies : [],
        defaultCurrency: can("currencies") ? data.defaultCurrency : "YER",
      }
    }),
    wallets: entry(can("wallets"), EMPTY_ADMIN_WALLETS, getAdminWalletOverview),
    marketing: entry(can("marketing"), EMPTY_ADMIN_MARKETING, getAdminMarketing),
    // المنتجات تحتاج الجداول لاختيارها في نموذج المنتج، فتُحمَّل لمن يملك إحدى الصلاحيتين.
    sizeCharts: entry(can("size-charts") || can("products"), [], getAdminSizeCharts),
    // الدفعة الأولى فقط من الطلبات — الباقي يُحمَّل عند الطلب.
    ordersPage: entry(can("orders"), { orders: [], total: 0, hasMore: false }, () => getAdminOrdersPage({ status: "all", sort: "newest" }, 0)),
    orderStats: entry(can("orders"), EMPTY_ORDER_STATS, getAdminOrderStats),
    couriers: entry(can("orders") || can("couriers"), [], getAdminCouriers),
    users: entry(can("users"), [], getAdminUsers),
    paymentAccounts: entry(can("payment-accounts"), [], getAdminPaymentAccounts),
    notifications: entry(can("notifications"), EMPTY_ADMIN_NOTIFICATIONS, getAdminNotifications),
  } satisfies Record<DataKey, () => Promise<unknown>>
}

export type ManageData = { [K in DataKey]: Awaited<ReturnType<ReturnType<typeof loaders>[K]>> }

async function load(can: Can, keys: readonly DataKey[]): Promise<Partial<ManageData>> {
  const table = loaders(can)
  const values = await Promise.all(keys.map((key) => table[key]()))
  return Object.fromEntries(keys.map((key, i) => [key, values[i]])) as Partial<ManageData>
}

/**
 * طلب من داخل اللوحة نفسها (إعادة رسم بعد حفظ، أو تحديث شاشة) يحمّل بيانات الشاشة المفتوحة فقط؛
 * فتح الصفحة أو إعادة تحميلها من المتصفح يحمّل كل الشاشات.
 */
async function keysFor(tab: Screen | null): Promise<{ keys: readonly DataKey[]; afterAction: boolean }> {
  const h = await headers()
  const afterAction = h.has("next-action")
  const fromDashboard = afterAction || h.get("rsc") === "1"
  return { keys: tab && fromDashboard ? SCREEN_DATA[tab] : DATA_KEYS, afterAction }
}

// الإجراءات (حفظ المنتج ورفع الصور...) تعمل ضمن حدود هذا المسار؛ المهلة الافتراضية القصيرة تُفشل الحفظ عند بطء القاعدة.
export const maxDuration = 60

export default async function ManagePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await getManageContext()
  if (!ctx) {
    redirect("/manage/login")
  }
  // لا نستعلم ولا نرسل للمتصفح إلا بيانات الشاشات المسموحة (أسرع وأكثر أماناً).
  const can: Can = (screen) => ctx.permissions.includes(screen)
  const requested = (await searchParams)[TAB_PARAM]
  const tab = isScreen(requested) && can(requested) ? requested : null
  const { keys, afterAction } = await keysFor(tab)

  let data: Partial<ManageData>
  try {
    data = await load(can, keys)
  } catch (error) {
    // صفحة بيضاء لا تخبر المدير بشيء: نشخّص السبب (ترحيلات/اتصال/صلاحية) ونعرضه، ونسجّل التفاصيل في سجلات الخادم.
    console.error("manage page load failed:", error)
    const kind = classifyDbError(error)
    const digest = typeof (error as { digest?: unknown })?.digest === "string" ? (error as { digest: string }).digest : null
    return <LoadFailure hint={DB_ERROR_HINTS[kind]} kind={kind} digest={digest} />
  }
  return (
    <Dashboard
      data={data}
      loaded={keys}
      afterAction={afterAction}
      initialTab={tab}
      currentUser={ctx.username}
      permissions={ctx.permissions}
      roleLabel={ctx.role === "owner" ? "المالك" : ROLE_LABELS[ctx.role]}
    />
  )
}
