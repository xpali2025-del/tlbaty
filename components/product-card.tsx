"use client"

import Link from "next/link"
import { Heart } from "lucide-react"
import { SafeImage } from "@/components/safe-image"
import type { Product } from "@/lib/types"
import { useWishlist } from "@/components/wishlist-provider"
import { useCurrency } from "@/components/currency-provider"
import { useToast } from "@/hooks/use-toast"

export function ProductCard({ product, compact = false }: { product: Product; compact?: boolean }) {
  const oldPrice = product.oldPrice
  const hasDiscount = typeof oldPrice === "number" && oldPrice > product.price

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
    <div className="group relative">
      <Link prefetch={false}
        href={`/product/${product.slug}`}
        className="block bg-card rounded-2xl overflow-hidden border border-border hover:border-primary/40 hover:shadow-lg transition-all"
        itemScope
        itemType="https://schema.org/Product"
      >
        <div className="relative aspect-square bg-muted overflow-hidden">
          <SafeImage
            src={product.image}
            alt={product.name}
            fill
            sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
            className="object-cover group-hover:scale-105 transition-transform duration-500"
            itemProp="image"
          />
          {hasDiscount && (
            <span className="absolute top-2 right-2 bg-primary text-primary-foreground text-xs font-bold px-2 py-1 rounded-full">
              -{Math.round(((oldPrice - product.price) / oldPrice) * 100)}%
            </span>
          )}
          {product.isNew && !hasDiscount && (
            <span className="absolute top-2 right-2 bg-accent-foreground text-accent text-xs font-bold px-2 py-1 rounded-full">
              جديد
            </span>
          )}
        </div>
        <div className={`p-3 ${compact ? "" : "md:p-4"}`}>
          <h3
            className={`font-medium text-foreground line-clamp-1 mb-1 ${compact ? "text-sm" : "text-sm md:text-base"}`}
            itemProp="name"
          >
            {product.name}
          </h3>
          {!compact && (
            <div className="flex items-center gap-1 mb-2">
              <span className="text-xs text-muted-foreground">
                رقم الصنف: <span className="font-medium text-foreground" dir="ltr">{product.id}</span>
              </span>
            </div>
          )}
          <div className="flex items-baseline gap-2" itemProp="offers" itemScope itemType="https://schema.org/Offer">
            <span className="font-bold text-primary" itemProp="price" content={String(product.price)}>
              {format(product.price)}
            </span>
            {hasDiscount && (
              <span className="text-xs text-price-old line-through">
                {format(oldPrice)}
              </span>
            )}
            <meta itemProp="priceCurrency" content="YER" />
          </div>
        </div>
      </Link>

      {/* زر الرغبات — عنصر مستقل خارج الرابط حتى لا يفتح صفحة المنتج عند الضغط */}
      <button
        type="button"
        onClick={handleWishlist}
        aria-pressed={saved}
        aria-label={saved ? "حذف من الرغبات" : "إضافة إلى الرغبات"}
        className="absolute top-0 left-0 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-transparent transition-colors [&>svg]:box-content [&>svg]:rounded-full [&>svg]:bg-background/90 [&>svg]:p-1.5 [&>svg]:shadow-sm hover:[&>svg]:bg-background"
      >
        <Heart
          className={`h-5 w-5 transition-colors ${saved ? "fill-primary text-primary" : "text-foreground"}`}
        />
      </button>
    </div>
  )
}
