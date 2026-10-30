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
      <header className="sticky top-0 z-40 rounded-b-2xl border-b border-primary/5 bg-background/95 shadow-[0_6px_16px_-12px_rgba(0,0,0,0.3)] backdrop-blur-sm lg:rounded-none lg:border-border lg:shadow-none">
        <div dir="rtl" className="mx-auto flex h-[68px] max-w-7xl items-center justify-between gap-2 px-3 sm:px-4 lg:hidden">
          <Logo className="min-w-0 shrink [&_img]:max-h-12 [&_img]:max-w-[min(96px,100%)] [&_img]:object-contain" />
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            <CurrencyIconMenu variant="mobile" />
            <Link href="/search" className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/5 text-foreground transition-colors hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" aria-label="البحث">
              <Search className="h-[22px] w-[22px]" aria-hidden="true" />
            </Link>
            <NotificationsBell badgeSide="right" className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/5 hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" />
          </div>
        </div>
        <div className="mx-auto hidden h-16 max-w-7xl items-center justify-between gap-4 px-4 lg:flex">

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
                <span className="absolute top-0 left-0 bg-primary text-primary-foreground text-[11px] font-bold rounded-full w-5 h-5 flex items-center justify-center">
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
            {/* أدوات سطح المكتب */}
            <NotificationsBell />
            <Link
              href="/cart"
              className="p-2 text-foreground hover:text-primary transition-colors relative"
              aria-label={`السلة (${totalItems} منتج)`}
            >
              <ShoppingCart className="w-6 h-6" />
              {totalItems > 0 && (
                <span className="absolute top-0 left-0 bg-primary text-primary-foreground text-[11px] font-bold rounded-full w-5 h-5 flex items-center justify-center">
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
