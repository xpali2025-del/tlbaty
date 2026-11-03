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
    <header className="sticky top-0 z-40 rounded-b-2xl border-b border-pink-100/80 bg-white text-black shadow-[0_10px_28px_rgba(25,15,18,0.07)] lg:rounded-none lg:border-border lg:bg-background/95 lg:text-foreground lg:shadow-none lg:backdrop-blur-sm">
      <div className="mx-auto flex h-[72px] max-w-7xl items-center justify-between gap-3 px-4 lg:hidden">
        <Logo className="min-w-0 max-w-[112px] shrink [&_img]:max-h-11 [&_img]:max-w-full" />

        <div className="flex shrink-0 items-center gap-2" aria-label="أدوات الترويسة">
          <CurrencyIconMenu appearance="label" align="start" />
          <Link
            href="/search"
            className="flex size-11 items-center justify-center rounded-full bg-[#fff3f6] text-black transition-colors hover:bg-[#ffe7ee] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            aria-label="البحث"
          >
            <Search className="size-[22px]" aria-hidden="true" />
          </Link>
          <NotificationsBell className="flex size-11 items-center justify-center rounded-full bg-[#fff3f6] p-0 text-black hover:bg-[#ffe7ee] hover:text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2" />
        </div>
      </div>

      <div className="mx-auto hidden h-16 max-w-7xl items-center justify-between gap-4 px-4 lg:flex">
        <Logo />

        <nav className="flex items-center gap-8" aria-label="القائمة الرئيسية">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm font-medium text-foreground transition-colors hover:text-primary"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-1">
          <Link href="/search" className="p-2 text-foreground transition-colors hover:text-primary" aria-label="البحث">
            <Search className="size-6" aria-hidden="true" />
          </Link>
          <CurrencyIconMenu />
          <Link
            href="/recently-viewed"
            className="p-2 text-foreground transition-colors hover:text-primary"
            aria-label="المنتجات المعروضة مؤخرًا"
          >
            <Clock3 className="size-6" />
          </Link>
          <Link
            href="/wishlist"
            className="relative p-2 text-foreground transition-colors hover:text-primary"
            aria-label={`الرغبات (${wishlistCount} منتج)`}
          >
            <Heart className="size-6" />
            {wishlistCount > 0 && (
              <span className="absolute left-0 top-0 flex size-5 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
                {wishlistCount}
              </span>
            )}
          </Link>
          <Link href="/account" className="p-2 text-foreground transition-colors hover:text-primary" aria-label="حسابي">
            <User className="size-6" />
          </Link>
          <NotificationsBell />
          <Link
            href="/cart"
            className="relative p-2 text-foreground transition-colors hover:text-primary"
            aria-label={`السلة (${totalItems} منتج)`}
          >
            <ShoppingCart className="size-6" />
            {totalItems > 0 && (
              <span className="absolute left-0 top-0 flex size-5 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
                {totalItems}
              </span>
            )}
          </Link>
        </div>
      </div>
    </header>
  )
}
