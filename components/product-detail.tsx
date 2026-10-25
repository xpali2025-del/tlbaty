"use client"

import { availableFor, colorInStock, firstAvailable, lowStockMessage, sizeInStock } from "@/lib/variant-stock"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { SafeImage } from "@/components/safe-image"
import { SizeGuide } from "@/components/size-guide"
import { useState } from "react"
import {
  Heart,
  Minus,
  Plus,
  Truck,
  Shield,
  Headphones,
  RotateCcw,
  ShoppingCart,
} from "lucide-react"

import type { Product } from "@/lib/types"
import { useToast } from "@/hooks/use-toast"
import { useRecordRecentlyViewed } from "@/hooks/use-recently-viewed"
import { useCart } from "./cart-provider"
import { useWishlist } from "./wishlist-provider"
import { useCurrency } from "./currency-provider"

const FEATURES = [
  { icon: Truck, title: "شحن سريع", desc: "خلال 1-3 أيام" },
  { icon: Shield, title: "جودة عالية", desc: "منتجات أصلية 100%" },
  { icon: Headphones, title: "دعم 24/7", desc: "لخدمتكم دائماً" },
  { icon: RotateCcw, title: "إرجاع سهل", desc: "خلال يومين" },
]

export function ProductDetail({
  product,
  brandSlug,
}: {
  product: Product
  brandSlug?: string
}) {
  const [selectedImage, setSelectedImage] = useState(0)
  // أول تركيبة (لون، مقاس) متوفرة تُحدَّد افتراضياً حتى لا يبدأ العميل بخيار نفد.
  const initial = firstAvailable(product)
  const [selectedColor, setSelectedColor] = useState(initial.color)
  const [selectedSize, setSelectedSize] = useState(initial.size)
  const [quantity, setQuantity] = useState(1)

  const available = availableFor(product, selectedColor, selectedSize)
  const outOfStock = available <= 0
  const effectiveQuantity = Math.min(quantity, Math.max(1, available))
  const stockMessage = lowStockMessage(available)

  const chooseColor = (name: string) => {
    setSelectedColor(name)
    // المقاس المحدد قد لا يتوفر بهذا اللون: ننتقل لأول مقاس متوفر له.
    if (!sizeInStock(product, name, selectedSize)) {
      const next = firstAvailable(product, name)
      if (next.color === name) setSelectedSize(next.size)
    }
  }

  const { addItem } = useCart()
  const { isInWishlist, toggleItem } = useWishlist()
  const { format } = useCurrency()
  const { toast } = useToast()
  const router = useRouter()

  // تسجيل المنتج ضمن «المعروضة مؤخرًا» عند فتح صفحة تفاصيله فقط
  useRecordRecentlyViewed(product)

  const savedInWishlist = isInWishlist(product.id)

  const handleWishlist = () => {
    // الرغبات لا تعتمد على اللون أو المقاس أو الكمية المختارة
    const added = toggleItem(product)
    toast({
      title: added ? "تمت الإضافة إلى الرغبات" : "تم الحذف من الرغبات",
    })
  }

  const images = product.images && product.images.length > 0 ? product.images : [product.image]
  const oldPrice = product.oldPrice
  const hasDiscount = typeof oldPrice === "number" && oldPrice > product.price

  const addSelectedProduct = () => {
    addItem({
      productId: product.id,
      name: product.name,
      price: product.price,
      image: images[0] || product.image,
      color: selectedColor,
      size: selectedSize,
      quantity: effectiveQuantity,
    })
  }

  const handleAddToCart = () => {
    addSelectedProduct()
    toast({
      title: "تمت الإضافة إلى السلة",
      description: `${product.name} — الكمية: ${effectiveQuantity}`,
    })
  }

  const handleDirectOrder = () => {
    addSelectedProduct()
    router.push("/checkout")
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 md:gap-10">
        {/* الصور */}
        <div>
          <div className="relative aspect-square overflow-hidden rounded-3xl bg-secondary">
            <SafeImage
              src={images[selectedImage]}
              alt={product.name}
              fill
              priority
              sizes="(min-width: 768px) 50vw, 100vw"
              className="object-cover"
            />
            <button
              type="button"
              onClick={handleWishlist}
              aria-pressed={savedInWishlist}
              className="absolute left-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-background/90 transition-colors hover:bg-background"
              aria-label={savedInWishlist ? "حذف من الرغبات" : "إضافة إلى الرغبات"}
            >
              <Heart
                className={`h-5 w-5 transition-colors ${savedInWishlist ? "fill-primary text-primary" : "text-foreground"}`}
              />
            </button>
            <span className="absolute bottom-4 left-4 rounded-full bg-background/90 px-3 py-1 text-xs font-medium text-foreground">
              {selectedImage + 1}/{images.length}
            </span>
          </div>

          {images.length > 1 && (
            <div className="mt-4 flex gap-3 overflow-x-auto pb-1">
              {images.map((img, index) => (
                <button
                  type="button"
                  key={`${img}-${index}`}
                  onClick={() => setSelectedImage(index)}
                  className={`relative h-16 w-16 shrink-0 overflow-hidden rounded-xl ring-2 transition-all ${
                    selectedImage === index ? "ring-primary" : "ring-transparent"
                  }`}
                  aria-label={`عرض الصورة ${index + 1}`}
                >
                  <SafeImage
                    src={img}
                    alt={`${product.name} - صورة ${index + 1}`}
                    fill
                    sizes="64px"
                    className="object-cover"
                  />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* التفاصيل */}
        <div>
          <h1 className="mb-2 text-2xl font-bold text-foreground md:text-3xl text-balance">
            {product.name}
          </h1>

          {/* البراند وكود المنتج */}
          {product.brand && (
            <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              {product.brand &&
                (brandSlug ? (
                  <Link
                    href={`/brand/${brandSlug}`}
                    className="inline-flex min-h-11 items-center gap-1 font-medium text-primary hover:underline"
                  >
                    <span className="text-muted-foreground">البراند:</span>
                    {product.brand}
                  </Link>
                ) : (
                  <span className="text-foreground">
                    <span className="text-muted-foreground">البراند:</span> {product.brand}
                  </span>
                ))}
            </div>
          )}

          {/* رمز المنتج القصير (مثل DR-012) هو ما يذكره العميل عند التواصل ويبحث به؛ رقم الصنف الخارجي (SKU) ثانوي ويظهر إن اختلف. */}
          <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="text-sm text-muted-foreground">
              رمز المنتج:{" "}
              <span className="rounded-md bg-muted px-2 py-0.5 font-mono text-sm font-bold text-foreground" dir="ltr">
                {product.id}
              </span>
            </span>
            {product.sku && product.sku !== product.id && (
              <span className="text-xs text-muted-foreground">
                SKU: <span className="font-medium text-foreground" dir="ltr">{product.sku}</span>
              </span>
            )}
          </div>

          <div className="mb-5 flex items-center gap-3">
            <span className="text-2xl font-bold text-primary">
              {format(product.price)}
            </span>
            {hasDiscount && (
              <span className="text-lg text-muted-foreground line-through">
                {format(oldPrice)}
              </span>
            )}
          </div>

          <p className="mb-6 leading-relaxed text-muted-foreground text-pretty">
            {product.description}
          </p>

          {/* الألوان */}
          {product.colors && product.colors.length > 0 && (
            <div className="mb-6">
              <p className="mb-2 text-sm font-medium text-foreground">
                اللون:{" "}
                <span className="text-muted-foreground">{selectedColor}</span>
              </p>
              <div className="flex flex-wrap gap-3">
                {product.colors.map((color) => (
                  <button
                    type="button"
                    key={color.name}
                    onClick={() => chooseColor(color.name)}
                    disabled={!colorInStock(product, color.name)}
                    className={`relative h-11 w-11 rounded-full ring-2 ring-offset-2 ring-offset-background transition-all disabled:cursor-not-allowed disabled:opacity-40 ${
                      selectedColor === color.name ? "ring-primary" : "ring-transparent"
                    }`}
                    style={{ backgroundColor: color.hex }}
                    aria-label={`اختيار اللون ${color.name}${colorInStock(product, color.name) ? "" : " (نفد)"}`}
                    title={colorInStock(product, color.name) ? color.name : `${color.name} — نفد`}
                  />
                ))}
              </div>
            </div>
          )}

          {/* المقاسات */}
          {product.sizes && product.sizes.length > 0 && (
            <div className="mb-6">
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-foreground">المقاس</p>
                {product.sizeChart ? (
                  <SizeGuide
                    chart={product.sizeChart}
                    productSizes={product.sizes}
                    selectedSize={selectedSize}
                    isSizeAvailable={(size) => sizeInStock(product, selectedColor, size)}
                    isSizeAvailableInOtherColor={(size) => (product.colors ?? []).some((c) => c.name !== selectedColor && sizeInStock(product, c.name, size))}
                    onSelectSize={setSelectedSize}
                  />
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                {product.sizes.map((size) => (
                  <button
                    type="button"
                    key={size}
                    onClick={() => setSelectedSize(size)}
                    disabled={!sizeInStock(product, selectedColor, size)}
                    className={`h-11 rounded-full border px-4 text-sm font-medium transition-all disabled:cursor-not-allowed disabled:text-muted-foreground disabled:line-through disabled:opacity-50 ${
                      selectedSize === size
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-background text-foreground hover:border-primary"
                    }`}
                  >
                    {size}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* الكمية */}
          <div className="mb-6">
            <p className="mb-2 text-sm font-medium text-foreground">الكمية</p>
            <div className="inline-flex items-center rounded-full border border-border">
              <button
                type="button"
                onClick={() => setQuantity(Math.max(1, effectiveQuantity - 1))}
                disabled={effectiveQuantity <= 1}
                className="flex h-10 w-10 items-center justify-center transition-colors hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="تقليل الكمية"
              >
                <Minus className="h-4 w-4" />
              </button>
              <span className="w-10 text-center font-medium">{effectiveQuantity}</span>
              <button
                type="button"
                onClick={() => setQuantity(Math.min(effectiveQuantity + 1, Math.max(1, available)))}
                disabled={effectiveQuantity >= available}
                className="flex h-10 w-10 items-center justify-center transition-colors hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="زيادة الكمية"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
            {stockMessage ? (
              <p className={`mt-2 text-sm font-medium ${outOfStock ? "text-destructive" : "text-amber-600"}`} role="status">
                {stockMessage}
              </p>
            ) : null}
          </div>

          {/* أزرار الإجراء */}
          <div className="mb-8 flex gap-3">
            <button
              type="button"
              onClick={handleAddToCart}
              disabled={outOfStock}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-full border-2 border-primary bg-background py-3 font-bold text-primary transition-colors hover:bg-primary hover:text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-background disabled:hover:text-primary"
            >
              <ShoppingCart className="h-5 w-5" />
              إضافة للسلة
            </button>
            <button
              type="button"
              onClick={handleDirectOrder}
              disabled={outOfStock}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-primary py-3 font-bold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {outOfStock ? "نفد المخزون" : "طلب مباشر"}
            </button>
          </div>

          {/* المميزات */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {FEATURES.map((feature) => {
              const Icon = feature.icon

              return (
                <div key={feature.title} className="rounded-xl bg-secondary p-3 text-center">
                  <Icon className="mx-auto mb-1 h-5 w-5 text-primary" />
                  <p className="text-xs font-bold text-foreground">{feature.title}</p>
                  <p className="text-[11px] text-muted-foreground">{feature.desc}</p>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
