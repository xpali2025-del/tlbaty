import Link from "next/link"
import {
  Bell,
  Clock3,
  ClipboardList,
  Headphones,
  Heart,
  HelpCircle,
  Info,
  LogIn,
  MapPinned,
  PencilLine,
  ShieldCheck,
  Store,
  User,
  Wallet,
} from "lucide-react"
import { Header } from "@/components/header"
import { MobileNav } from "@/components/mobile-nav"
import { AccountActions } from "@/components/auth/account-actions"
import { MarketingConsent } from "@/components/auth/marketing-consent"
import { AddressCount, Balance, CurrencyCard, RecentCount, ShareRow, WishlistCount } from "@/components/account/settings-client"
import { PreferencesGroup, SettingsGroup, SettingsRow, StatTile } from "@/components/account/settings-ui"
import { getCurrentCustomer } from "@/lib/otp/session"
import { countOrdersForCustomer, getCustomerDisplayName } from "@/lib/otp/customer-orders"
import { getSiteConfig } from "@/lib/site-config"
import { getBalance } from "@/lib/wallet/customer"

export const dynamic = "force-dynamic"

export const metadata = {
  title: "الإعدادات | Tajline",
  description: "حسابك وطلباتك وعناوينك ورصيدك، وتفضيلات المتجر والمساعدة.",
  robots: { index: false, follow: false },
}

const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID

export default async function SettingsPage() {
  const [customer, site] = await Promise.all([getCurrentCustomer(), getSiteConfig()])
  const loggedIn = Boolean(customer)

  // بيانات الحساب فقط للمسجّل؛ الزائر لا نستعلم له شيئاً.
  const [name, orderCount, wallet] = customer
    ? await Promise.all([
        getCustomerDisplayName(customer),
        countOrdersForCustomer(customer),
        site.payments.wallet ? getBalance(customer.id).catch(() => null) : Promise.resolve(null),
      ])
    : [null, 0, null]

  const tiles = [
    { href: "/orders", icon: ClipboardList, label: "طلباتي", value: orderCount > 0 ? orderCount : 0 },
    ...(site.payments.wallet
      ? [{ href: "/account/wallet", icon: Wallet, label: "رصيدي", value: wallet ? <Balance base={wallet.balance} plain /> : 0 }]
      : []),
    { href: "/account/addresses", icon: MapPinned, label: "عناويني", value: <AddressCount plain /> },
    { href: "/wishlist", icon: Heart, label: "قائمة الرغبات", value: <WishlistCount plain /> },
  ]

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="mx-auto w-full max-w-2xl px-4 py-6 pb-28">
        <h1 className="mb-6 text-2xl font-bold tracking-tight">الإعدادات</h1>

        {/* الملف الشخصي (يتطلب حساباً) أو دعوة تسجيل الدخول للزائر */}
        {customer ? (
          <section aria-label="الملف الشخصي" className="mb-8 rounded-2xl border border-border bg-card p-4">
            <div className="flex items-center gap-4">
              <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-primary text-2xl font-bold text-primary-foreground" aria-hidden="true">
                {name ? name.trim().charAt(0) : <User className="h-8 w-8" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xl font-bold">{name ?? "عميلنا العزيز"}</p>
                <p className="mt-0.5 text-sm text-muted-foreground tabular-nums" dir="ltr" style={{ textAlign: "right" }}>
                  +{customer.phone}
                </p>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
              <p className="text-xs text-muted-foreground">
                معرّف العميل: <span dir="ltr" className="font-medium text-foreground">{customer.publicId}</span>
              </p>
              <Link
                href="/change-phone"
                className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <PencilLine className="h-4 w-4" aria-hidden="true" />
                تغيير رقم الهاتف
              </Link>
            </div>
          </section>
        ) : (
          <section aria-label="تسجيل الدخول" className="mb-8 rounded-2xl border border-border bg-card p-5">
            <h2 className="text-lg font-bold">أهلاً بك في {site.name}</h2>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              سجّل الدخول أو أنشئ حساباً برقم هاتفك للوصول إلى طلباتك وعناوينك ورصيدك.
            </p>
            <Link
              href="/login?next=/account"
              className="mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-bold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 sm:w-auto"
            >
              <LogIn className="h-4 w-4" aria-hidden="true" />
              تسجيل الدخول / إنشاء حساب
            </Link>
          </section>
        )}

        {/* مركز العميل: وصول سريع بلاطات (للزائر خافتة بقفل) */}
        <section className="mb-8" aria-label="مركز العميل">
          <h2 className="mb-2 px-1 text-sm font-bold text-muted-foreground">مركز العميل</h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {tiles.map((t, i) => (
              <StatTile
                key={t.href}
                href={t.href}
                icon={t.icon}
                label={t.label}
                value={t.value}
                locked={!loggedIn}
                className={tiles.length % 2 === 1 && i === tiles.length - 1 ? "col-span-2 md:col-span-1" : ""}
              />
            ))}
          </div>
          {!loggedIn && <p className="mt-2 px-1 text-xs text-muted-foreground">هذه الخدمات خاصة بحسابك وتُفتح بعد تسجيل الدخول.</p>}
        </section>

        {/* التفضيلات: عملة العرض، وموافقة العروض للمسجّل */}
        <PreferencesGroup title="التفضيلات">
          <CurrencyCard />
          {customer && <MarketingConsent initial={customer.marketingOptIn} />}
        </PreferencesGroup>

        {/* اكتشف وتابع (متاح للجميع) */}
        <SettingsGroup title="اكتشف وتابع">
          <SettingsRow href="/notifications" icon={Bell} label="الإشعارات" description="عروض المتجر وتحديثات طلباتك" />
          <SettingsRow href="/brands" icon={Store} label="الماركات" description="تصفّح ماركات المتجر" />
          {/* لا يتطلب حساباً: يُحفظ في متصفح الزائر نفسه */}
          <SettingsRow href="/recently-viewed" icon={Clock3} label="شوهد مؤخراً" description="منتجات تصفحتها حديثاً" trailing={<RecentCount />} />
        </SettingsGroup>

        {/* المساعدة والمعلومات */}
        <SettingsGroup title="المساعدة والمعلومات">
          <SettingsRow href="/faq" icon={HelpCircle} label="الأسئلة الشائعة" />
          <SettingsRow href="/contact" icon={Headphones} label="تواصل معنا" description="قنوات الدعم والتواصل" />
          <ShareRow title={site.name} text={`تسوّق من ${site.name}`} />
          <SettingsRow href="/about" icon={Info} label="عن المتجر" description={BUILD_ID ? `النسخة ${BUILD_ID}` : "معلومات عامة عن المتجر"} />
          <SettingsRow href="/privacy" icon={ShieldCheck} label="الخصوصية والشروط" />
        </SettingsGroup>

        {/* إجراءات الحساب: أخيراً ومنفصلة */}
        {customer && <AccountActions />}
      </main>
      <MobileNav />
    </div>
  )
}
