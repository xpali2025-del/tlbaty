"use client"

import Link from "next/link"
import { Menu, Search, ShoppingCart, Heart, Clock3, X, Bell, PackageSearch, User } from "lucide-react"
import { useState } from "react"
import { useCart } from "./cart-provider"
import { useWishlist } from "./wishlist-provider"
import { Logo } from "./logo"
import { CurrencySelectorMenu, CurrencySelectorList } from "./currency-selector"
import { NotificationsBell } from "@/components/notifications-bell"
import { useNotifications } from "@/components/notifications-provider"

const NAV_LINKS = [
  { label: "الرئيسية", href: "/" },
  { label: "كافة المنتجات", href: "/categories" },
  { label: "الأقسام", href: "/shop" },
  { label: "الماركات", href: "/brands" },
  { label: "تواصل معنا", href: "/contact" },
]

export function Header() {
  const [open, setOpen] = useState(false)
  const { totalItems } = useCart()
  const { totalItems: wishlistCount } = useWishlist()
  // العدّاد يأتي من مزوّد الإشعارات (طلب خفيف واحد يُعاد استخدامه).
  const { unreadCount } = useNotifications()

  return (
    <>
      <header className="sticky top-0 z-40 bg-background/95 backdrop-blur-sm border-b border-border">
        <div className="mx-auto max-w-7xl px-4 h-16 flex items-center justify-between gap-4">
          <button
            onClick={() => setOpen(true)}
            className="p-2 -mr-2 text-foreground hover:text-primary transition-colors lg:hidden"
            aria-label="فتح القائمة"
          >
            <Menu className="w-6 h-6" />
          </button>

          <Logo />

          <nav className="hidden lg:flex items-center gap-8" aria-label="القائمة الرئيسية">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-sm font-medium text-foreground hover:text-primary transition-colors"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-1">
            <div className="hidden sm:block">
              <CurrencySelectorMenu />
            </div>
            <Link
              href="/search"
              className="p-2 text-foreground hover:text-primary transition-colors hidden md:block"
              aria-label="البحث"
            >
              <Search className="w-5 h-5" />
            </Link>
            <Link
              href="/recently-viewed"
              className="p-2 text-foreground hover:text-primary transition-colors hidden lg:block"
              aria-label="المنتجات المعروضة مؤخرًا"
            >
              <Clock3 className="w-6 h-6" />
            </Link>
            <Link
              href="/wishlist"
              className="p-2 text-foreground hover:text-primary transition-colors relative hidden lg:block"
              aria-label={`الرغبات (${wishlistCount} منتج)`}
            >
              <Heart className="w-6 h-6" />
              {wishlistCount > 0 && (
                <span className="absolute top-0 left-0 bg-primary text-primary-foreground text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center">
                  {wishlistCount}
                </span>
              )}
            </Link>
            <Link
              href="/account"
              className="p-2 text-foreground hover:text-primary transition-colors hidden lg:block"
              aria-label="حسابي"
            >
              <User className="w-6 h-6" />
            </Link>
            {/* الجرس بجانب السلة — ظاهر على الهاتف وسطح المكتب */}
            <NotificationsBell />
            <Link
              href="/cart"
              className="p-2 text-foreground hover:text-primary transition-colors relative"
              aria-label={`السلة (${totalItems} منتج)`}
            >
              <ShoppingCart className="w-6 h-6" />
              {totalItems > 0 && (
                <span className="absolute top-0 left-0 bg-primary text-primary-foreground text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center">
                  {totalItems}
                </span>
              )}
            </Link>
          </div>
        </div>
      </header>

      {/* القائمة الجانبية للموبايل */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="absolute right-0 top-0 bottom-0 w-80 max-w-[85vw] bg-background shadow-xl flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <Logo />
              <button onClick={() => setOpen(false)} className="p-2" aria-label="إغلاق القائمة">
                <X className="w-6 h-6" />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto p-4 flex flex-col gap-1">
              {NAV_LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className="px-4 py-3 rounded-lg text-foreground hover:bg-accent hover:text-primary transition-colors font-medium"
                >
                  {link.label}
                </Link>
              ))}
              {/* الإشعارات في القائمة الجانبية مع أيقونة جرس وعدد غير المقروء */}
              <Link
                href="/notifications"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 px-4 py-3 rounded-lg text-foreground hover:bg-accent hover:text-primary transition-colors font-medium"
              >
                <Bell className="w-5 h-5 shrink-0" aria-hidden="true" />
                الإشعارات
                {unreadCount > 0 && (
                  <span className="mr-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
              </Link>
              {/* حساب العميل — تسجيل الدخول وإدارة الحساب */}
              <Link
                href="/account"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 px-4 py-3 rounded-lg text-foreground hover:bg-accent hover:text-primary transition-colors font-medium"
              >
                <User className="w-5 h-5 shrink-0" aria-hidden="true" />
                حسابي
              </Link>
              {/* طلباتي — تعتمد على تسجيل الدخول وتعرض كل طلبات العميل تلقائياً */}
              <Link
                href="/orders"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 px-4 py-3 rounded-lg text-foreground hover:bg-accent hover:text-primary transition-colors font-medium"
              >
                <PackageSearch className="w-5 h-5 shrink-0" aria-hidden="true" />
                طلباتي
              </Link>
              <Link
                href="/recently-viewed"
                onClick={() => setOpen(false)}
                className="px-4 py-3 rounded-lg text-foreground hover:bg-accent hover:text-primary transition-colors font-medium"
              >
                المعروضة مؤخرًا
              </Link>
              <Link
                href="/about"
                onClick={() => setOpen(false)}
                className="px-4 py-3 rounded-lg text-foreground hover:bg-accent hover:text-primary transition-colors font-medium"
              >
                من نحن
              </Link>
              <Link
                href="/faq"
                onClick={() => setOpen(false)}
                className="px-4 py-3 rounded-lg text-foreground hover:bg-accent hover:text-primary transition-colors font-medium"
              >
                الأسئلة الشائعة
              </Link>
            </nav>
            <div className="mt-auto border-t border-border">
              <CurrencySelectorList onSelect={() => setOpen(false)} />
            </div>
          </div>
        </div>
      )}
    </>
  )
}
