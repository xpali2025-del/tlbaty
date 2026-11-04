"use client"

import Link from "next/link"
import { Heart } from "lucide-react"
import { SafeImage } from "@/components/safe-image"
import type { Product } from "@/lib/types"
import { useWishlist } from "@/components/wishlist-provider"
import { useCurrency } from "@/components/currency-provider"
import { useToast } from "@/hooks/use-toast"

export function ProductCard({ product }: { product: Product; compact?: boolean }) {
  const oldPrice = product.oldPrice
  const hasDiscount = typeof oldPrice === "number" && oldPrice > product.price
  const discountPercentage = hasDiscount
    ? Math.round(((oldPrice - product.price) / oldPrice) * 100)
    : 0

  const { format } = useCurrency()
  const { isInWishlist, toggleItem } = useWishlist()
  const { toast } = useToast()
  const saved = isInWishlist(product.id)

  const handleWishlist = () => {
    const added = toggleItem(product)
    toast({
      title: added ? "تمت الإضافة إلى الرغبات" : "تم الحذف من الرغبات",
    })
  }

  return (
    <article className="group overflow-hidden rounded-[1.4rem] border border-border/70 bg-card shadow-[0_14px_36px_-30px_rgba(57,24,33,0.5)] transition-all duration-300 hover:-translate-y-1 hover:border-primary/25 hover:shadow-[0_22px_45px_-28px_rgba(57,24,33,0.48)]">
      <div className="relative aspect-[3/4] overflow-hidden bg-secondary">
        <Link href={`/product/${product.slug}`} aria-label={product.name}>
          <SafeImage
            src={product.image}
            alt={product.name}
            fill
            className="object-cover transition-transform duration-700 ease-out group-hover:scale-[1.04]"
            sizes="(max-width: 768px) 50vw, 33vw"
          />
          <span className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/20 to-transparent opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />
        </Link>

        <button
          type="button"
          onClick={handleWishlist}
          className={`absolute left-3 top-3 flex size-11 items-center justify-center rounded-full border border-white/60 bg-background/90 shadow-sm backdrop-blur transition-all hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
            saved ? "text-primary" : "text-foreground hover:text-primary"
          }`}
          aria-label={saved ? "إزالة من المفضلة" : "إضافة إلى المفضلة"}
        >
          <Heart className={`size-5 ${saved ? "fill-current" : ""}`} aria-hidden="true" />
        </button>
      </div>

      <div className="flex flex-col gap-2.5 p-3 md:p-3.5">
        {(product.isNew || discountPercentage > 0 || product.isBestseller) && (
          <div className="flex min-h-6 flex-wrap items-center gap-1.5" aria-label="حالة المنتج">
            {product.isNew && (
              <span className="rounded-full bg-foreground px-2 py-0.5 text-[10px] font-bold text-background">
                جديد
              </span>
            )}
            {discountPercentage > 0 && (
              <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold text-primary-foreground">
                خصم {discountPercentage}%
              </span>
            )}
            {product.isBestseller && (
              <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-bold text-secondary-foreground">
                الأكثر مبيعاً
              </span>
            )}
          </div>
        )}

        <Link href={`/product/${product.slug}`}>
          <h3 className="line-clamp-2 min-h-10 text-sm font-bold leading-5 text-foreground transition-colors group-hover:text-primary md:text-base">
            {product.name}
          </h3>
        </Link>

        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-base font-extrabold text-primary md:text-lg">
            {format(product.price)}
          </span>
          {product.oldPrice && (
            <span className="text-xs text-muted-foreground line-through md:text-sm">
              {format(product.oldPrice)}
            </span>
          )}
        </div>
      </div>
    </article>
  )
}
