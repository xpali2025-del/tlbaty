"use client"

import { useEffect, useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  Package,
  FolderTree,
  Tag,
  Images,
  Ticket,
  Star,
  Megaphone,
  Settings,
  Truck,
  LogOut,
  ExternalLink,
  Boxes,
  ClipboardList,
  Users,
  Wallet,
  Bell,
  Bike,
  Coins,
  PiggyBank,
  BellRing,
  Ruler,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { Screen } from "@/lib/permissions"
import type { ManageData } from "./page"
import { AFFECTS, DATA_KEYS, SCREEN_DATA, TAB_PARAM, type DataKey } from "./screen-data"
import { ManageStoreProvider, type ManageStoreActions } from "./manage-store"
import { notifyScreenData, setProductSavedHandler, useSaveQueueLifecycle } from "./save-queue/queue"
import { SaveStatusBar } from "./save-queue/status-bar"
import type { AdminProduct } from "@/lib/admin"
import { Button } from "@/components/ui/button"
import { logout } from "./auth-actions"
import { ProductsManager } from "./components/products-manager"
import { CategoriesManager } from "./components/categories-manager"
import { BrandsManager } from "./components/brands-manager"
import { SlidesManager } from "./components/slides-manager"
import { CouponsManager } from "./components/coupons-manager"
import { ReviewsManager } from "./components/reviews-manager"
import { AdsManager } from "./components/ads-manager"
import { ShippingManager } from "./components/shipping-manager"
import { CurrenciesManager } from "./components/currencies-manager"
import { WalletsManager } from "./components/wallets-manager"
import { MarketingManager } from "./components/marketing-manager"
import { SizeChartsManager } from "./components/size-charts-manager"
import { SettingsManager } from "./components/settings-manager"
import { OrdersManager } from "./components/orders-manager"
import { CouriersManager } from "./components/couriers-manager"
import { UsersManager } from "./components/users-manager"
import { PaymentAccountsManager } from "./components/payment-accounts-manager"
import { NotificationsManager } from "./components/notifications-manager"

type TabId = Screen

type DashboardProps = {
  /** بيانات الشاشات التي حمّلها الخادم في هذا الرسم (كلها عند فتح الصفحة، أو الشاشة المفتوحة فقط بعد حفظ). */
  data: Partial<ManageData>
  loaded: readonly DataKey[]
  /** رسم بعد إجراء (حفظ/حذف): ما لم يُحمَّل قد يكون تغيّر. */
  afterAction: boolean
  initialTab: Screen | null
  currentUser: string | null
  /** الشاشات المسموحة لهذا المستخدم (البيانات الأخرى لا تُرسل للمتصفح أصلاً). */
  permissions: Screen[]
  roleLabel: string
}

type Store = { data: ManageData; stale: ReadonlySet<DataKey> }

/**
 * يدمج ما وصل من الخادم مع ما في المتصفح. ما وصل صار حديثاً؛ وبعد إجراء يُعلَّم كل ما لم يصل قديماً
 * (حفظ في شاشة قد يغيّر أخرى، كإلغاء طلب يعيد رصيد المحفظة) فيُحدَّث عند فتح شاشته.
 */
function merge(prev: Store | null, data: Partial<ManageData>, loaded: readonly DataKey[], afterAction: boolean): Store {
  const stale = new Set(prev?.stale)
  for (const key of DATA_KEYS) {
    if (loaded.includes(key)) stale.delete(key)
    else if (afterAction) stale.add(key)
  }
  return { data: { ...prev?.data, ...data } as ManageData, stale }
}

const byProductOrder = (a: AdminProduct, b: AdminProduct) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name, "ar")

/** يستبدل المنتج في مكانه، وإن تغيّر ترتيبه (الاسم أو الترتيب) أو كان جديداً يُدرَج في موضعه من القائمة. */
function upsertProductInList(list: AdminProduct[], item: AdminProduct): AdminProduct[] {
  const index = list.findIndex((p) => p._id === item._id)
  if (index >= 0 && list[index].name === item.name && list[index].sortOrder === item.sortOrder) return list.map((p, i) => (i === index ? item : p))
  const rest = index >= 0 ? list.filter((_, i) => i !== index) : list
  const at = rest.findIndex((p) => byProductOrder(item, p) < 0)
  return at < 0 ? [...rest, item] : [...rest.slice(0, at), item, ...rest.slice(at)]
}

export function Dashboard({ data: incoming, loaded, afterAction, initialTab, currentUser, permissions, roleLabel }: DashboardProps) {
  const router = useRouter()
  const [, startRefresh] = useTransition()
  const [received, setReceived] = useState(incoming)
  const [store, setStore] = useState(() => merge(null, incoming, loaded, afterAction))
  // عدد التعديلات المحلية (عنصر محفوظ أُدرج من رد الحفظ)، ورقمه حين بدأ آخر تحديث خلفي (null = لا تحديث جارٍ).
  const [mutations, setMutations] = useState(0)
  const [refreshStartedAt, setRefreshStartedAt] = useState<number | null>(null)
  if (incoming !== received) {
    setReceived(incoming)
    // رد تحديث بدأ قبل حفظ محلي قرأ الخادم فيه نسخة أقدم مما في المتصفح: لو دُمج لاستبدل العنصر المحفوظ بنسخته القديمة
    // (تبدو القائمة كأن الحفظ ضاع، ويُرفض التعديل التالي بتعارض كاذب). يُهمل، وتبقى البيانات معلَّمة قديمة فتُحدَّث لاحقاً.
    const fromRefresh = !afterAction && refreshStartedAt !== null
    if (fromRefresh) setRefreshStartedAt(null)
    if (!(fromRefresh && refreshStartedAt !== mutations)) setStore((prev) => merge(prev, incoming, loaded, afterAction))
  }
  const props = store.data
  const actions = useMemo<ManageStoreActions>(
    () => ({
      upsertProduct: (item) => {
        setMutations((n) => n + 1)
        setStore((prev) => {
          const stale = new Set(prev.stale)
          stale.delete("products")
          for (const key of AFFECTS.products ?? []) stale.add(key)
          return { data: { ...prev.data, products: upsertProductInList(prev.data.products, item) }, stale }
        })
      },
    }),
    [],
  )
  // طابور الحفظ: ما يُحفظ في الخلفية يُدرَج في القائمة عند وصول رد الخادم، من أي شاشة كان المدير.
  useEffect(() => {
    setProductSavedHandler(actions.upsertProduct)
  }, [actions])
  useSaveQueueLifecycle()
  const nav: { id: TabId; label: string; icon: typeof Package; count?: number }[] = ([
    { id: "orders", label: "الطلبات", icon: ClipboardList, count: props.orderStats.total },
    { id: "couriers", label: "المناديب والتوزيع", icon: Bike, count: props.couriers.length },
    {
      id: "notifications",
      label: "الإشعارات",
      icon: Bell,
      count: props.notifications.stats.total,
    },
    {
      id: "payment-accounts",
      label: "حسابات الدفع",
      icon: Wallet,
      count: props.paymentAccounts.length,
    },
    { id: "products", label: "المنتجات", icon: Package, count: props.products.length },
    { id: "categories", label: "الأقسام", icon: FolderTree, count: props.categories.length },
    { id: "brands", label: "البراندات", icon: Tag, count: props.brands.length },
    { id: "slides", label: "السلايدر", icon: Images, count: props.slides.length },
    { id: "coupons", label: "أكواد الخصم", icon: Ticket, count: props.coupons.length },
    { id: "reviews", label: "آراء العملاء", icon: Star, count: props.reviews.length },
    { id: "ads", label: "الإعلانات", icon: Megaphone, count: props.ads.length },
    { id: "users", label: "المستخدمون", icon: Users, count: props.users.length },
    { id: "shipping", label: "الشحن", icon: Truck },
    { id: "currencies", label: "العملات", icon: Coins },
    { id: "size-charts", label: "جداول المقاسات", icon: Ruler, count: props.sizeCharts.length },
    { id: "marketing", label: "التذكيرات والعروض", icon: BellRing },
    { id: "wallets", label: "المحافظ والرصيد", icon: PiggyBank, count: props.wallets.totals.pendingCount || undefined },
    { id: "settings", label: "إعدادات الموقع", icon: Settings },
  ] as { id: TabId; label: string; icon: typeof Package; count?: number }[]).filter((item) => permissions.includes(item.id))
  const [tab, setTab] = useState<TabId>(initialTab ?? nav[0]?.id ?? "orders")
  // وصلت بيانات جديدة للشاشة المفتوحة (رد حفظ أو تحديث): عمليات الحفظ التي تنتظر ظهورها فيها تزول من العرض.
  useEffect(() => {
    notifyScreenData(tab)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- تتبّع وصول البيانات لا تبديل الشاشة
  }, [received])

  // الرابط يحمل الشاشة المفتوحة، فيعرف الخادم بعد أي حفظ أي بيانات يعيد تحميلها (وتبقى الشاشة بعد إعادة التحميل).
  const syncUrl = (screen: TabId) => {
    const url = new URL(window.location.href)
    if (url.searchParams.get(TAB_PARAM) === screen) return
    url.searchParams.set(TAB_PARAM, screen)
    window.history.replaceState(null, "", url)
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- مرة عند الفتح: الشاشة الافتراضية أيضاً في الرابط
  useEffect(() => syncUrl(tab), [])

  // لوحة بدأت من رسم جزئي (رجوع بالمتصفح من صفحة أخرى أعاد شاشة واحدة) لا تملك بيانات بقية الشاشات: تحميل كامل.
  const incomplete = DATA_KEYS.some((key) => store.data[key] === undefined)
  useEffect(() => {
    if (incomplete) window.location.reload()
  }, [incomplete])

  const openTab = (next: TabId) => {
    setTab(next)
    syncUrl(next)
    // بيانات تغيّرت منذ تحميلها (حفظ في شاشة أخرى): تُحدَّث في الخلفية وتبقى المعروضة حتى تصل.
    if (SCREEN_DATA[next].some((key) => store.stale.has(key))) {
      setRefreshStartedAt(mutations)
      startRefresh(() => router.refresh())
    }
  }

  if (incomplete) return <p className="p-6 text-sm text-muted-foreground">جارٍ تحميل اللوحة…</p>

  return (
    <ManageStoreProvider value={actions}>
      <div className="mx-auto flex min-h-screen max-w-[1400px] flex-col lg:flex-row">
        {/* الشريط الجانبي */}
        <aside className="border-b bg-card lg:min-h-screen lg:w-64 lg:shrink-0 lg:border-b-0 lg:border-l">
          <div className="flex items-center gap-2 border-b p-4">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Boxes className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold">لوحة الإدارة</p>
              <p className="truncate text-xs text-muted-foreground">{currentUser ? `${currentUser} · ${roleLabel}` : "لوحة تحكم المتجر"}</p>
            </div>
          </div>

          <nav className="flex gap-1 overflow-x-auto p-2 lg:flex-col lg:overflow-visible">
            {nav.map((item) => {
              const Icon = item.icon
              const active = tab === item.id
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => openTab(item.id)}
                  className={cn(
                    "flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors lg:w-full",
                    active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span>{item.label}</span>
                  {item.count !== undefined ? (
                    <span
                      className={cn(
                        "mr-auto hidden rounded-full px-1.5 text-xs lg:inline",
                        active ? "bg-primary-foreground/20" : "bg-muted-foreground/10",
                      )}
                    >
                      {item.count}
                    </span>
                  ) : null}
                </button>
              )
            })}
          </nav>

          <div className="flex gap-2 border-t p-2 lg:flex-col">
            <Button variant="outline" size="sm" className="flex-1 justify-start gap-2 bg-transparent" asChild>
              <a href="/" target="_blank" rel="noreferrer">
                <ExternalLink className="h-4 w-4" />
                عرض المتجر
              </a>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="flex-1 justify-start gap-2 text-destructive hover:text-destructive"
              onClick={async () => {
                await logout()
                router.replace("/manage/login")
                router.refresh()
              }}
            >
              <LogOut className="h-4 w-4" />
              تسجيل الخروج
            </Button>
          </div>

          <div className="border-t p-4 text-center">
            <p className="text-xs text-muted-foreground">
              صُمم بواسطة <span className="font-semibold text-foreground">Nasim Mohammed</span>
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground" dir="ltr">
              774786786
            </p>
          </div>
        </aside>

        {/* المحتوى */}
        <main className="min-w-0 flex-1 p-4 lg:p-6">
          <SaveStatusBar onShowProblems={(screen) => (nav.some((n) => n.id === screen) ? openTab(screen as TabId) : undefined)} />
          {nav.length === 0 && <p className="text-sm text-muted-foreground">لا توجد شاشات مسموحة لحسابك. تواصل مع مدير النظام.</p>}
          {tab === "orders" && (
            <OrdersManager
              initialPage={props.ordersPage}
              stats={props.orderStats}
              couriers={props.couriers}
            />
          )}
          {tab === "couriers" && <CouriersManager couriers={props.couriers} />}
          {tab === "notifications" && <NotificationsManager data={props.notifications} />}
          {tab === "payment-accounts" && <PaymentAccountsManager accounts={props.paymentAccounts} />}
          {tab === "products" && (
            <ProductsManager products={props.products} categories={props.categories} brands={props.brands} sizeCharts={props.sizeCharts} />
          )}
          {tab === "categories" && <CategoriesManager categories={props.categories} />}
          {tab === "brands" && <BrandsManager brands={props.brands} />}
          {tab === "slides" && <SlidesManager slides={props.slides} />}
          {tab === "coupons" && <CouponsManager coupons={props.coupons} />}
          {tab === "reviews" && <ReviewsManager reviews={props.reviews} />}
          {tab === "ads" && <AdsManager ads={props.ads} categories={props.categories} />}
          {tab === "users" && <UsersManager users={props.users} currentUser={currentUser} />}
          {tab === "shipping" && <ShippingManager data={props.shipping} />}
          {tab === "currencies" && (
            <CurrenciesManager currencies={props.shipping.currencies} defaultCurrency={props.shipping.defaultCurrency} />
          )}
          {tab === "wallets" && <WalletsManager initial={props.wallets} />}
          {tab === "marketing" && <MarketingManager initial={props.marketing} />}
          {tab === "size-charts" && <SizeChartsManager charts={props.sizeCharts} />}
          {tab === "settings" && <SettingsManager settings={props.settings} />}
        </main>
      </div>
    </ManageStoreProvider>
  )
}
