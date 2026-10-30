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
      <header className="sticky top-0 z-40 rounded-b-2xl border-b border-primary/5 bg-background/95 shadow-[0_6px_16px_-12px_rgba(0,0,0,0.3)] backdrop-blur-sm lg:rounded-none lg:border-border lg:shadow-[0_6px_18px_-14px_rgba(0,0,0,0.25)]">
        <div dir="rtl" className="mx-auto flex h-[68px] max-w-7xl items-center justify-between gap-2 px-3 sm:px-4 lg:hidden">
          <Logo className="min-w-0 shrink [&_img]:max-h-12 [&_img]:max-w-[min(96px,100%)] [&_img]:object-contain" />
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            <CurrencyIconMenu variant="pill" />
            <Link href="/search" className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/5 text-foreground transition-colors hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" aria-label="البحث">
              <Search className="h-[22px] w-[22px]" aria-hidden="true" />
            </Link>
            <NotificationsBell badgeSide="right" className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/5 hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" />
          </div>
        </div>
        <div dir="rtl" className="mx-auto hidden h-20 max-w-7xl items-center gap-3 px-4 lg:flex xl:gap-6">
          <Logo className="shrink-0 [&_img]:max-h-14 [&_img]:max-w-[110px] [&_img]:object-contain" />

          <nav className="flex min-w-0 flex-1 items-center justify-center gap-3 xl:gap-6" aria-label="القائمة الرئيسية">
            {NAV_LINKS.map((link) => (
              <Link key={link.href} href={link.href} className="whitespace-nowrap text-xs font-medium text-foreground transition-colors hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary xl:text-sm">
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="flex shrink-0 items-center gap-1 xl:gap-2">
            <CurrencyIconMenu variant="pill" />
            <Link href="/search" className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/5 text-foreground transition-colors hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" aria-label="البحث">
              <Search className="h-[22px] w-[22px]" aria-hidden="true" />
            </Link>
            <NotificationsBell badgeSide="right" className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/5 hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" />
            <Link href="/account" className="flex h-11 w-11 items-center justify-center rounded-full text-foreground transition-colors hover:bg-primary/5 hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" aria-label="حسابي">
              <User className="h-[22px] w-[22px]" aria-hidden="true" />
            </Link>
            <Link href="/wishlist" className="relative flex h-11 w-11 items-center justify-center rounded-full text-foreground transition-colors hover:bg-primary/5 hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" aria-label={`الرغبات (${wishlistCount} منتج)`}>
              <Heart className="h-[22px] w-[22px]" aria-hidden="true" />
              {wishlistCount > 0 && <span className="absolute right-0 top-0 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[11px] font-bold text-primary-foreground">{wishlistCount}</span>}
            </Link>
            <Link href="/recently-viewed" className="flex h-11 w-11 items-center justify-center rounded-full text-foreground transition-colors hover:bg-primary/5 hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" aria-label="المنتجات المعروضة مؤخرًا">
              <Clock3 className="h-[22px] w-[22px]" aria-hidden="true" />
            </Link>
            <Link href="/cart" className="relative flex h-11 w-11 items-center justify-center rounded-full text-foreground transition-colors hover:bg-primary/5 hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" aria-label={`السلة (${totalItems} منتج)`}>
              <ShoppingCart className="h-[22px] w-[22px]" aria-hidden="true" />
              {totalItems > 0 && <span className="absolute right-0 top-0 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[11px] font-bold text-primary-foreground">{totalItems}</span>}
            </Link>
          </div>
        </div>
      </header>

    </>
  )
}
