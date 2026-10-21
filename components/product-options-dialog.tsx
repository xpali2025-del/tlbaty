"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Minus, Plus, ShoppingBag } from "lucide-react"
import type { WishlistItem } from "@/lib/types"
import { useCart } from "./cart-provider"
import { useCurrency } from "./currency-provider"
import { useToast } from "@/hooks/use-toast"
import { useIsMobile } from "@/hooks/use-mobile"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"

export type OptionsMode = "cart" | "order"

interface ProductOptionsDialogProps {
  item: WishlistItem | null
  mode: OptionsMode
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ProductOptionsDialog({ item, mode, open, onOpenChange }: ProductOptionsDialogProps) {
  const isMobile = useIsMobile()
  const { addItem } = useCart()
  const { format } = useCurrency()
  const { toast } = useToast()
  const router = useRouter()

  // لا نختار أول لون/مقاس تلقائياً — نتركهما فارغين حتى يختارهما العميل
  const [selectedColor, setSelectedColor] = useState("")
  const [selectedSize, setSelectedSize] = useState("")
  const [quantity, setQuantity] = useState(1)

  // إعادة ضبط الخيارات في كل مرة تُفتح فيها النافذة أو يتغيّر المنتج
  useEffect(() => {
    if (open) {
      setSelectedColor("")
      setSelectedSize("")
      setQuantity(1)
    }
  }, [open, item?.id])

  if (!item) return null

  const hasColors = item.colors.length > 0
  const hasSizes = item.sizes.length > 0
  const title = mode === "order" ? "طلب مباشر" : "إضافة إلى السلة"

  const handleConfirm = () => {
    if (hasColors && !selectedColor) {
      toast({ title: "الرجاء اختيار اللون قبل المتابعة" })
      return
    }
    if (hasSizes && !selectedSize) {
      toast({ title: "الرجاء اختيار المقاس قبل المتابعة" })
      return
    }

    addItem({
      productId: item.id,
      name: item.name,
      price: item.price,
      image: item.image,
      color: selectedColor,
      size: selectedSize,
      quantity,
    })

    onOpenChange(false)

    if (mode === "order") {
      router.push("/checkout")
    } else {
      toast({
        title: "تمت الإضافة إلى السلة",
        description: `${item.name} — الكمية: ${quantity}`,
      })
    }
  }

  const body = (
    <div className="space-y-6 px-4 pb-2">
      {/* الألوان */}
      {hasColors && (
        <div>
          <p className="mb-2 text-sm font-medium text-foreground">
            اللون: <span className="text-muted-foreground">{selectedColor || "اختر لوناً"}</span>
          </p>
          <div className="flex flex-wrap gap-3">
            {item.colors.map((color) => (
              <button
                type="button"
                key={color.name}
                onClick={() => setSelectedColor(color.name)}
                className={`h-9 w-9 rounded-full ring-2 ring-offset-2 ring-offset-background transition-all ${
                  selectedColor === color.name ? "ring-primary" : "ring-transparent"
                }`}
                style={{ backgroundColor: color.hex }}
                aria-label={`اختيار اللون ${color.name}`}
                aria-pressed={selectedColor === color.name}
                title={color.name}
              />
            ))}
          </div>
        </div>
      )}

      {/* المقاسات */}
      {hasSizes && (
        <div>
          <p className="mb-2 text-sm font-medium text-foreground">
            المقاس: <span className="text-muted-foreground">{selectedSize || "اختر مقاساً"}</span>
          </p>
          <div className="flex flex-wrap gap-2">
            {item.sizes.map((size) => (
              <button
                type="button"
                key={size}
                onClick={() => setSelectedSize(size)}
                aria-pressed={selectedSize === size}
                className={`h-10 rounded-full border px-4 text-sm font-medium transition-all ${
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
      <div>
        <p className="mb-2 text-sm font-medium text-foreground">الكمية</p>
        <div className="inline-flex items-center rounded-full border border-border">
          <button
            type="button"
            onClick={() => setQuantity((current) => Math.max(1, current - 1))}
            disabled={quantity <= 1}
            className="flex h-10 w-10 items-center justify-center transition-colors hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="تقليل الكمية"
          >
            <Minus className="h-4 w-4" />
          </button>
          <span className="w-10 text-center font-medium">{quantity}</span>
          <button
            type="button"
            onClick={() => setQuantity((current) => current + 1)}
            className="flex h-10 w-10 items-center justify-center transition-colors hover:text-primary"
            aria-label="زيادة الكمية"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* زر التأكيد */}
      <button
        type="button"
        onClick={handleConfirm}
        className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-primary py-3 font-bold text-primary-foreground transition-colors hover:bg-primary/90"
      >
        <ShoppingBag className="h-5 w-5" />
        {mode === "order" ? "متابعة الطلب" : "إضافة إلى السلة"}
      </button>
    </div>
  )

  const description = `${item.name} — ${format(item.price)}`

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent dir="rtl">
          <DrawerHeader className="text-right">
            <DrawerTitle>{title}</DrawerTitle>
            <DrawerDescription>{description}</DrawerDescription>
          </DrawerHeader>
          <div className="pb-6">{body}</div>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="sm:max-w-md">
        <DialogHeader className="text-right">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  )
}
