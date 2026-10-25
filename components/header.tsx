"use client"

import Link from "next/link"
import { Search, ShoppingCart, Heart, Clock3, User } from "lucide-react"
import { useCart } from "./cart-provider"
import { useWishlist } from "./wishlist-provider"
import { Logo } from "./logo"
import { CurrencyIconMenu } from "./currency-selector"
import { NotificationsBell } from "@/components/notifications-bell"

const NAV_LINKS = [
  { label: "الرئيسية", href: "/" },
  { label: "كافة المنتجات", href: "/categories" },
  { label: "الأقسام", href: "/shop" },
  { label: "الماركات", href: "/brands" },
  { label: "تواصل معنا", href: "/contact" },
]

export function Header() {
  const { totalItems } = useCart()
  const { totalItems: wishlistCount } = useWishlist()

  return (
    <>
      <header className="sticky top-0 z-40 bg-background/95 backdrop-blur-sm border-b border-border">
        <div className="mx-auto max-w-7xl px-4 h-16 flex items-center justify-between gap-4">
          {/* الهاتف: البحث والعملة بأيقونتين فقط مكان زر القائمة (الروابط في الشريط السفلي وصفحة الإعدادات) */}
          <div className="-mr-2 flex items-center lg:hidden">
            <Link href="/search" className="p-2 text-foreground transition-colors hover:text-primary" aria-label="البحث">
              <Search className="h-6 w-6" aria-hidden="true" />
            </Link>
            <CurrencyIconMenu align="start" />
          </div>

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
            {/* سطح المكتب: نفس أيقونتي البحث والعملة */}
            <div className="hidden items-center lg:flex">
              <Link href="/search" className="p-2 text-foreground transition-colors hover:text-primary" aria-label="البحث">
                <Search className="h-6 w-6" aria-hidden="true" />
              </Link>
              <CurrencyIconMenu />
            </div>
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

    </>
  )
}
