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
import { AddressCount, Balance, CurrencyRow, RecentCount, ShareRow, WishlistCount } from "@/components/account/settings-client"
import { CountPill, SettingsGroup, SettingsRow } from "@/components/account/settings-ui"
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

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="mx-auto w-full max-w-2xl px-4 py-6 pb-28">
        <h1 className="mb-4 text-2xl font-bold tracking-tight">الإعدادات</h1>

        {/* القسم A: الملف الشخصي (يتطلب حساباً) */}
        {customer ? (
          <section aria-label="الملف الشخصي" className="mb-6">
            <div className="flex items-center gap-4 rounded-2xl border border-border bg-card p-4">
              <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-primary/10 text-2xl font-bold text-primary" aria-hidden="true">
                {name ? name.trim().charAt(0) : <User className="h-8 w-8" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-lg font-bold">{name ?? "عميلنا العزيز"}</p>
                <p className="mt-0.5 text-sm text-muted-foreground tabular-nums" dir="ltr" style={{ textAlign: "right" }}>
                  +{customer.phone}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">معرّف العميل: <span dir="ltr">{customer.publicId}</span></p>
              </div>
            </div>
          </section>
        ) : (
          <section aria-label="تسجيل الدخول" className="mb-6 rounded-2xl border border-primary/20 bg-primary/5 p-5 text-center">
            <span className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
              <User className="h-7 w-7 text-primary" aria-hidden="true" />
            </span>
            <h2 className="text-lg font-bold">أهلاً بك في {site.name}</h2>
            <p className="mx-auto mt-1 max-w-xs text-sm text-muted-foreground">
              سجّل الدخول أو أنشئ حساباً برقم هاتفك للوصول إلى طلباتك وعناوينك ورصيدك.
            </p>
            <Link
              href="/login?next=/account"
              className="mt-4 inline-flex min-h-12 w-full max-w-xs items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-bold text-primary-foreground hover:bg-primary/90"
            >
              <LogIn className="h-4 w-4" aria-hidden="true" />
              تسجيل الدخول / إنشاء حساب
            </Link>
          </section>
        )}

        <SettingsGroup title="حسابي">
          <SettingsRow href="/change-phone" icon={PencilLine} label="تغيير رقم الهاتف" description="تحديث الرقم المسجّل بحسابك" locked={!loggedIn} />
        </SettingsGroup>

        {/* القسم B: مركز العميل (يتطلب حساباً) */}
        <SettingsGroup title="مركز العميل" hint={loggedIn ? undefined : "هذه الخدمات خاصة بحسابك وتُفتح بعد تسجيل الدخول."}>
          <SettingsRow
            href="/orders"
            icon={ClipboardList}
            label="طلباتي"
            description="تتبّع طلباتك الحالية وسجل طلباتك"
            trailing={loggedIn && orderCount > 0 ? <CountPill>{orderCount}</CountPill> : undefined}
            locked={!loggedIn}
          />
          {site.payments.wallet && (
            <SettingsRow
              href="/account/wallet"
              icon={Wallet}
              label="رصيدي"
              description="رصيد حسابك وشحنه"
              trailing={wallet ? <Balance base={wallet.balance} /> : undefined}
              locked={!loggedIn}
            />
          )}
          <SettingsRow href="/account/addresses" icon={MapPinned} label="عناويني" description="المنزل والعمل وغيرها، لاختيارها بنقرة عند الطلب" trailing={loggedIn ? <AddressCount /> : undefined} locked={!loggedIn} />
          <SettingsRow href="/wishlist" icon={Heart} label="قائمة الرغبات" description="المنتجات التي أعجبتك" trailing={loggedIn ? <WishlistCount /> : undefined} locked={!loggedIn} />
          {/* لا يتطلب حساباً: يُحفظ في متصفح الزائر نفسه */}
          <SettingsRow href="/recently-viewed" icon={Clock3} label="شوهد مؤخراً" description="منتجات تصفحتها حديثاً" trailing={<RecentCount />} />
        </SettingsGroup>

        {/* القسم C: التفضيلات والتسوّق (متاح للجميع) */}
        <SettingsGroup title="التفضيلات والتسوّق">
          <CurrencyRow />
          <SettingsRow href="/notifications" icon={Bell} label="الإشعارات" description="عروض المتجر وتحديثات طلباتك" />
          <SettingsRow href="/brands" icon={Store} label="الماركات" description="تصفّح ماركات المتجر" />
        </SettingsGroup>
        {customer && (
          <div className="-mt-3 mb-6">
            <MarketingConsent initial={customer.marketingOptIn} />
          </div>
        )}

        {/* القسم D: المساعدة والمعلومات */}
        <SettingsGroup title="المساعدة والمعلومات">
          <SettingsRow href="/faq" icon={HelpCircle} label="الأسئلة الشائعة" />
          <SettingsRow href="/contact" icon={Headphones} label="تواصل معنا" description="قنوات الدعم والتواصل" />
          <ShareRow title={site.name} text={`تسوّق من ${site.name}`} />
          <SettingsRow href="/about" icon={Info} label="عن المتجر" description={BUILD_ID ? `النسخة ${BUILD_ID}` : "معلومات عامة عن المتجر"} />
          <SettingsRow href="/privacy" icon={ShieldCheck} label="الخصوصية والشروط" />
        </SettingsGroup>

        {/* القسم E: إجراءات الحساب */}
        {customer && <AccountActions />}
      </main>
      <MobileNav />
    </div>
  )
}
