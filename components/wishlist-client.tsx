"use client"

import { useState } from "react"
import Link from "next/link"
import { Trash2, ArrowLeft, Heart, ShoppingBag } from "lucide-react"
import { SafeImage } from "@/components/safe-image"
import { Header } from "@/components/header"
import { FooterClient } from "@/components/footer-client"
import { MobileNav } from "@/components/mobile-nav"
import { useWishlist } from "@/components/wishlist-provider"
import { useCurrency } from "@/components/currency-provider"
import { ProductOptionsDialog, type OptionsMode } from "@/components/product-options-dialog"
import type { WishlistItem } from "@/lib/types"

export function WishlistClient() {
  const { items, removeItem } = useWishlist()
  const { format } = useCurrency()

  const [activeItem, setActiveItem] = useState<WishlistItem | null>(null)
  const [mode, setMode] = useState<OptionsMode>("cart")
  const [dialogOpen, setDialogOpen] = useState(false)

  const openOptions = (item: WishlistItem, nextMode: OptionsMode) => {
    setActiveItem(item)
    setMode(nextMode)
    setDialogOpen(true)
  }

  return (
    <>
      <Header />
      <main className="pb-24 lg:pb-12 mx-auto max-w-6xl px-4 py-6">
        <h1 className="text-2xl md:text-3xl font-bold mb-6">قائمة الرغبات</h1>

        {items.length === 0 ? (
          <div className="bg-secondary rounded-3xl p-12 text-center">
            <Heart className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
            <h2 className="text-xl font-bold mb-2">لا توجد منتجات في الرغبات</h2>
            <p className="text-muted-foreground mb-6">أضف منتجاتك المفضلة لتجدها هنا بسهولة</p>
            <Link
              href="/categories"
              className="inline-flex items-center gap-2 bg-primary text-primary-foreground rounded-full px-6 py-3 font-bold hover:bg-primary/90 transition-colors"
            >
              تصفح المنتجات
              <ArrowLeft className="w-4 h-4" />
            </Link>
          </div>
        ) : (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {items.map((item) => {
              const hasDiscount =
                typeof item.oldPrice === "number" && item.oldPrice > item.price

              return (
                <li
                  key={item.id}
                  className="bg-card border border-border rounded-2xl p-3 flex gap-3"
                >
                  <Link
                    href={`/product/${item.slug}`}
                    className="relative w-24 h-24 rounded-xl overflow-hidden bg-muted shrink-0"
                    aria-label={`عرض تفاصيل ${item.name}`}
                  >
                    <SafeImage src={item.image} alt={item.name} fill sizes="96px" className="object-cover" />
                  </Link>

                  <div className="flex-1 min-w-0 flex flex-col">
                    <div className="flex items-start justify-between gap-2">
                      <Link href={`/product/${item.slug}`} className="min-w-0">
                        <h3 className="font-bold text-sm md:text-base text-foreground line-clamp-1 hover:text-primary transition-colors">
                          {item.name}
                        </h3>
                      </Link>
                      <button
                        type="button"
                        onClick={() => removeItem(item.id)}
                        className="w-8 h-8 shrink-0 rounded-full bg-secondary flex items-center justify-center hover:bg-destructive hover:text-destructive-foreground transition-colors"
                        aria-label={`حذف ${item.name} من الرغبات`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <span className="text-xs text-muted-foreground">
                      رقم الصنف: <span className="font-medium text-foreground" dir="ltr">{item.id}</span>
                    </span>

                    <div className="flex items-baseline gap-2 mt-1">
                      <span className="font-bold text-primary">
                        {format(item.price)}
                      </span>
                      {hasDiscount && (
                        <span className="text-xs text-price-old line-through">
                          {format(item.oldPrice as number)}
                        </span>
                      )}
                    </div>

                    <div className="mt-auto pt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => openOptions(item, "cart")}
                        className="inline-flex items-center gap-1.5 rounded-full border-2 border-primary bg-background px-3 py-1.5 text-xs font-bold text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
                      >
                        <ShoppingBag className="h-4 w-4" />
                        إضافة إلى السلة
                      </button>
                      <button
                        type="button"
                        onClick={() => openOptions(item, "order")}
                        className="inline-flex items-center rounded-full bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground transition-colors hover:bg-primary/90"
                      >
                        طلب مباشر
                      </button>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </main>

      <ProductOptionsDialog item={activeItem} mode={mode} open={dialogOpen} onOpenChange={setDialogOpen} />

      <FooterClient />
      <MobileNav />
    </>
  )
}
