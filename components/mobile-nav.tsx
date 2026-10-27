"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { ShoppingBag, FolderClosed, Home, Settings, ShoppingCart } from "lucide-react"
import { useCart } from "./cart-provider"

// القائمة بترتيب العرض من اليسار إلى اليمين (dir="ltr")؛ فيقرأها العربي من اليمين:
// المنتجات ← الأقسام ← الرئيسية ← السلة ← الإعدادات (الرغبات صارت في صفحة الإعدادات).
const ITEMS = [
  { href: "/account", label: "الإعدادات", icon: Settings },
  { href: "/cart", label: "السلة", icon: ShoppingCart },
  { href: "/", label: "الرئيسية", icon: Home, center: true },
  { href: "/shop", label: "الأقسام", icon: FolderClosed },
  { href: "/categories", label: "المنتجات", icon: ShoppingBag },
]

export function MobileNav() {
  const pathname = usePathname()
  const { totalItems } = useCart()

  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-40 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-0 lg:hidden pointer-events-none"
      aria-label="التنقل السفلي"
    >
      <ul
        dir="ltr"
        className="pointer-events-auto relative mx-auto flex max-w-md items-end justify-between rounded-[1.75rem] border border-primary/10 bg-background px-4 py-1.5 shadow-[0_-4px_30px_-8px_rgba(233,30,99,0.35)]"
      >
        {ITEMS.map((item) => {
          const Icon = item.icon
          const base = item.href.split("?")[0]
          const isActive = pathname === base || (base !== "/" && pathname.startsWith(`${base}/`))
          const isCart = item.href === "/cart"

          if (item.center) {
            return (
              <li key={item.href} className="flex-1 flex justify-center">
                <Link
                  href={item.href}
                  aria-label={item.label}
                  className="-mt-8 flex h-16 w-16 flex-col items-center justify-center gap-0.5 rounded-full bg-gradient-to-b from-primary to-primary/80 text-primary-foreground shadow-lg shadow-primary/40 ring-4 ring-background transition-transform active:scale-95"
                >
                  <Icon className="h-6 w-6" strokeWidth={1.75} aria-hidden="true" />
                  <span className="text-[11px] font-bold">{item.label}</span>
                </Link>
              </li>
            )
          }

          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                className={`flex flex-col items-center gap-1 py-1.5 transition-colors ${
                  isActive ? "text-primary" : "text-primary/70 hover:text-primary"
                }`}
              >
                <span className="relative">
                  <Icon className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
                  {isCart && totalItems > 0 && (
                    <span className="absolute -top-2 -left-2 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
                      {totalItems}
                    </span>
                  )}
                </span>
                <span className="text-[11px] font-medium">{item.label}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
