"use client"

import { useState } from "react"
import Link from "next/link"
import { Heart, ShoppingCart } from "lucide-react"
import { SafeImage } from "@/components/safe-image"
import { ProductOptionsDialog } from "@/components/product-options-dialog"
import type { Product, WishlistItem } from "@/lib/types"
import { useCart } from "@/components/cart-provider"
import { useWishlist } from "@/components/wishlist-provider"
import { useCurrency } from "@/components/currency-provider"
import { useToast } from "@/hooks/use-toast"

export function ProductCard({ product }: { product: Product; compact?: boolean }) {
  const [optionsOpen, setOptionsOpen] = useState(false)
  const oldPrice = product.oldPrice
  const hasDiscount = typeof oldPrice === "number" && oldPrice > product.price
  const discountPercentage = hasDiscount
    ? Math.round(((oldPrice - product.price) / oldPrice) * 100)
    : 0

  const { format } = useCurrency()
  const { addItem } = useCart()
  const { isInWishlist, toggleItem } = useWishlist()
  const { toast } = useToast()
  const saved = isInWishlist(product.id)
  const hasOptions = product.colors.length > 0 || product.sizes.length > 0
  const optionItem: WishlistItem = {
    id: product.id,
    slug: product.slug,
    name: product.name,
    price: product.price,
    oldPrice: product.oldPrice,
    image: product.image,
    colors: product.colors,
    sizes: product.sizes,
  }

  const handleWishlist = () => {
    const added = toggleItem(product)
    toast({
      title: added ? "تمت الإضافة إلى الرغبات" : "تم الحذف من الرغبات",
    })
  }

  const handleCart = () => {
    if (hasOptions) {
      setOptionsOpen(true)
      return
    }

    addItem({
      productId: product.id,
      name: product.name,
      price: product.price,
      image: product.image,
      color: "",
      size: "",
      quantity: 1,
    })
    toast({ title: "تمت الإضافة إلى السلة" })
  }

  return (
    <>
      <article className="group overflow-hidden rounded-[1.4rem] border border-border/70 bg-white shadow-[0_14px_36px_-30px_rgba(57,24,33,0.5)] transition-[border-color,box-shadow,transform] duration-300 even:translate-y-7 hover:border-primary/25 hover:shadow-[0_22px_45px_-28px_rgba(57,24,33,0.48)] md:even:translate-y-0">
        <div className="relative aspect-[3/4] overflow-hidden bg-secondary">
          <Link href={`/product/${product.slug}`} aria-label={product.name}>
            <SafeImage
              src={product.image}
              alt={product.name}
              fill
              className="object-cover transition-transform duration-700 ease-out group-hover:scale-[1.04]"
              sizes="(max-width: 768px) 50vw, 33vw"
            />
          </Link>

          {(product.isNew || discountPercentage > 0 || product.isBestseller) && (
            <div className="absolute right-2 top-2 flex max-w-[65%] flex-wrap gap-1" aria-label="حالة المنتج">
              {product.isNew && <span className="rounded-full bg-foreground/90 px-1.5 py-0.5 text-[9px] font-bold text-background">جديد</span>}
              {discountPercentage > 0 && <span className="rounded-full bg-primary/95 px-1.5 py-0.5 text-[9px] font-bold text-primary-foreground">خصم {discountPercentage}%</span>}
              {product.isBestseller && <span className="rounded-full bg-white/90 px-1.5 py-0.5 text-[9px] font-bold text-foreground">الأكثر مبيعاً</span>}
            </div>
          )}

          <button
            type="button"
            onClick={handleWishlist}
            className={`absolute left-1.5 top-1.5 flex size-11 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${saved ? "text-primary" : "text-foreground hover:text-primary"}`}
            aria-label={saved ? "إزالة من المفضلة" : "إضافة إلى المفضلة"}
          >
            <span className="flex size-8 items-center justify-center rounded-full border border-white/60 bg-white/90 shadow-sm backdrop-blur">
              <Heart className={`size-4 ${saved ? "fill-current" : ""}`} aria-hidden="true" />
            </span>
          </button>
        </div>

        <div className="flex flex-col gap-0.5 bg-white px-1.5 py-[5px] text-foreground">
          <Link href={`/product/${product.slug}`} className="min-w-0">
            <h3 className="truncate text-[13px] font-bold leading-4 transition-colors group-hover:text-primary md:text-sm">
              {product.name}
            </h3>
          </Link>

          <div className="flex min-w-0 items-baseline gap-1.5 whitespace-nowrap leading-4">
            <span className="text-sm font-extrabold text-primary md:text-base">{format(product.price)}</span>
            {hasDiscount && <span className="truncate text-[10px] text-muted-foreground line-through md:text-xs">{format(oldPrice)}</span>}
          </div>

          {hasOptions && (
            <button
              type="button"
              onClick={() => setOptionsOpen(true)}
              className={`grid min-h-4 min-w-0 items-center gap-1 text-start text-[10px] text-muted-foreground ${product.colors.length > 0 && product.sizes.length > 0 ? "grid-cols-2" : "grid-cols-1"}`}
              aria-label="عرض خيارات اللون والمقاس"
            >
              {product.colors.length > 0 && (
                <span className="flex min-w-0 items-center gap-0.5 overflow-hidden whitespace-nowrap">
                  <span className="shrink-0">ألوان</span>
                  {product.colors.slice(0, 3).map((color) => (
                    <span key={color.name} className="size-2.5 shrink-0 rounded-full border border-black/10" style={{ backgroundColor: color.hex }} title={color.name} />
                  ))}
                  {product.colors.length > 3 && <span className="shrink-0">+{product.colors.length - 3}</span>}
                </span>
              )}
              {product.sizes.length > 0 && (
                <span className="min-w-0 truncate whitespace-nowrap">مقاس: {product.sizes.slice(0, 2).join("، ")}{product.sizes.length > 2 ? ` +${product.sizes.length - 2}` : ""}</span>
              )}
            </button>
          )}

          <button
            type="button"
            onClick={handleCart}
            disabled={product.stock <= 0}
            className="flex h-11 w-full items-center justify-center disabled:cursor-not-allowed disabled:opacity-50"
            aria-label={product.stock > 0 ? `إضافة ${product.name} إلى السلة` : `${product.name} غير متوفر`}
          >
            <span className="flex h-8 w-full items-center justify-center gap-1 rounded-full bg-primary px-2 text-[11px] font-bold text-primary-foreground transition-colors hover:bg-primary/90">
              <ShoppingCart className="size-3.5" aria-hidden="true" />
              {product.stock > 0 ? "إضافة للسلة" : "غير متوفر"}
            </span>
          </button>
        </div>
      </article>

      <ProductOptionsDialog item={optionItem} mode="cart" open={optionsOpen} onOpenChange={setOptionsOpen} />
    </>
  )
}
