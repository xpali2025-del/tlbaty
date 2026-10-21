"use client"

import { useState } from "react"
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
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { Screen } from "@/lib/permissions"
import { Button } from "@/components/ui/button"
import type {
  AdminProduct,
  AdminCategory,
  AdminBrand,
  AdminSlide,
  AdminCoupon,
  AdminReview,
  AdminAd,
  AdminSettings,
  AdminShipping,
  AdminPaymentAccount,
} from "@/lib/admin"
import type { OrderStats, OrdersPage } from "@/lib/admin-orders"
import type { Courier } from "@/lib/courier"
import type { AdminNotificationsResult } from "@/lib/admin-notifications"
import type { AdminUser } from "@/lib/manage-users"
import { logout } from "./auth-actions"
import { ProductsManager } from "./components/products-manager"
import { CategoriesManager } from "./components/categories-manager"
import { BrandsManager } from "./components/brands-manager"
import { SlidesManager } from "./components/slides-manager"
import { CouponsManager } from "./components/coupons-manager"
import { ReviewsManager } from "./components/reviews-manager"
import { AdsManager } from "./components/ads-manager"
import { ShippingManager } from "./components/shipping-manager"
import { SettingsManager } from "./components/settings-manager"
import { OrdersManager } from "./components/orders-manager"
import { CouriersManager } from "./components/couriers-manager"
import { UsersManager } from "./components/users-manager"
import { PaymentAccountsManager } from "./components/payment-accounts-manager"
import { NotificationsManager } from "./components/notifications-manager"

type TabId =
  | "orders"
  | "couriers"
  | "notifications"
  | "payment-accounts"
  | "products"
  | "categories"
  | "brands"
  | "slides"
  | "coupons"
  | "reviews"
  | "ads"
  | "users"
  | "shipping"
  | "settings"

type DashboardProps = {
  products: AdminProduct[]
  categories: AdminCategory[]
  brands: AdminBrand[]
  slides: AdminSlide[]
  coupons: AdminCoupon[]
  reviews: AdminReview[]
  ads: AdminAd[]
  settings: AdminSettings
  shipping: AdminShipping
  /** الدفعة الأولى من الطلبات فقط — الباقي يُحمَّل من الخادم عند الحاجة. */
  ordersPage: OrdersPage
  orderStats: OrderStats
  couriers: Courier[]
  users: AdminUser[]
  paymentAccounts: AdminPaymentAccount[]
  notifications: AdminNotificationsResult
  currentUser: string | null
  /** الشاشات المسموحة لهذا المستخدم (البيانات الأخرى لا تُرسل للمتصفح أصلاً). */
  permissions: Screen[]
  roleLabel: string
}

export function Dashboard(props: DashboardProps) {
  const router = useRouter()
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
    { id: "shipping", label: "الشحن والعملات", icon: Truck },
    { id: "settings", label: "إعدادات الموقع", icon: Settings },
  ] as { id: TabId; label: string; icon: typeof Package; count?: number }[]).filter((item) => props.permissions.includes(item.id))
  const [tab, setTab] = useState<TabId>(nav[0]?.id ?? "orders")

  return (
    <div className="mx-auto flex min-h-screen max-w-[1400px] flex-col lg:flex-row">
      {/* الشريط الجانبي */}
      <aside className="border-b bg-card lg:min-h-screen lg:w-64 lg:shrink-0 lg:border-b-0 lg:border-l">
        <div className="flex items-center gap-2 border-b p-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Boxes className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold">لوحة الإدارة</p>
            <p className="truncate text-xs text-muted-foreground">{props.currentUser ? `${props.currentUser} · ${props.roleLabel}` : "لوحة تحكم المتجر"}</p>
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
                onClick={() => setTab(item.id)}
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
      <main className="flex-1 p-4 lg:p-6">
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
          <ProductsManager products={props.products} categories={props.categories} brands={props.brands} />
        )}
        {tab === "categories" && <CategoriesManager categories={props.categories} />}
        {tab === "brands" && <BrandsManager brands={props.brands} />}
        {tab === "slides" && <SlidesManager slides={props.slides} />}
        {tab === "coupons" && <CouponsManager coupons={props.coupons} />}
        {tab === "reviews" && <ReviewsManager reviews={props.reviews} />}
        {tab === "ads" && <AdsManager ads={props.ads} categories={props.categories} />}
        {tab === "users" && <UsersManager users={props.users} currentUser={props.currentUser} />}
        {tab === "shipping" && <ShippingManager data={props.shipping} />}
        {tab === "settings" && <SettingsManager settings={props.settings} />}
      </main>
    </div>
  )
}
