"use client"

import Link from "next/link"
import { Minus, Plus, Trash2, MessageCircle, ArrowLeft, ShoppingBag } from "lucide-react"
import { SafeImage } from "@/components/safe-image"
import { Header } from "@/components/header"
import { FooterClient } from "@/components/footer-client"
import { MobileNav } from "@/components/mobile-nav"
import { useCart } from "@/components/cart-provider"
import { useCurrency } from "@/components/currency-provider"
import { SITE_CONFIG } from "@/lib/site"

export default function CartPage() {
  const { items, removeItem, updateQuantity, subtotal } = useCart()
  const { format } = useCurrency()
  const discount = 30
  const total = subtotal - (subtotal > 100 ? discount : 0)

  const handleWhatsAppCheckout = () => {
    const lines = items.map(
      (i) =>
        `• ${i.name}\n  المقاس: ${i.size} | اللون: ${i.color} | الكمية: ${i.quantity} | ${format(i.price * i.quantity)}`,
    )
    const msg = `مرحباً، أرغب في إتمام طلبي:\n\n${lines.join("\n\n")}\n\n*المجموع: ${format(total)}*`
    window.open(`https://wa.me/${SITE_CONFIG.contact.whatsapp}?text=${encodeURIComponent(msg)}`, "_blank")
  }

  return (
    <>
      <Header />
      <main className="pb-24 lg:pb-12 mx-auto max-w-6xl px-4 py-6">
        <h1 className="text-2xl md:text-3xl font-bold mb-6">سلة التسوق</h1>

        {items.length === 0 ? (
          <div className="bg-secondary rounded-3xl p-12 text-center">
            <ShoppingBag className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
            <h2 className="text-xl font-bold mb-2">السلة فارغة</h2>
            <p className="text-muted-foreground mb-6">ابدأ التسوق وأضف منتجاتك المفضلة</p>
            <Link
              href="/shop"
              className="inline-flex items-center gap-2 bg-primary text-primary-foreground rounded-full px-6 py-3 font-bold hover:bg-primary/90 transition-colors"
            >
              تصفح المتجر
              <ArrowLeft className="w-4 h-4" />
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-3">
              {items.map((item) => (
                <div
                  key={`${item.productId}-${item.size}-${item.color}`}
                  className="bg-card border border-border rounded-2xl p-3 flex gap-3"
                >
                  <div className="relative w-20 h-20 sm:w-24 sm:h-24 rounded-xl overflow-hidden bg-muted shrink-0">
                    <SafeImage src={item.image} alt={item.name} fill sizes="96px" className="object-cover" />
                  </div>
                  <div className="flex-1 min-w-0 flex flex-col">
                    <h3 className="font-bold text-sm md:text-base text-foreground line-clamp-1">{item.name}</h3>
                    <p className="text-xs text-muted-foreground">
                      {item.color} • المقاس {item.size}
                    </p>
                    <div className="flex items-center justify-between mt-auto pt-2">
                      <span className="font-bold text-primary">
                        {format(item.price * item.quantity)}
                      </span>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => removeItem(item.productId, item.size, item.color)}
                          className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center hover:bg-destructive hover:text-destructive-foreground transition-colors"
                          aria-label="حذف"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                        <div className="flex items-center bg-secondary rounded-full">
                          <button
                            onClick={() =>
                              updateQuantity(item.productId, item.size, item.color, item.quantity - 1)
                            }
                            className="w-8 h-8 flex items-center justify-center hover:text-primary transition-colors"
                            aria-label="تقليل"
                          >
                            <Minus className="w-3.5 h-3.5" />
                          </button>
                          <span className="w-7 text-center text-sm font-bold">{item.quantity}</span>
                          <button
                            onClick={() =>
                              updateQuantity(item.productId, item.size, item.color, item.quantity + 1)
                            }
                            className="w-8 h-8 flex items-center justify-center hover:text-primary transition-colors"
                            aria-label="زيادة"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* ملخص الطلب */}
            <aside className="bg-card border border-border rounded-2xl p-5 h-fit lg:sticky lg:top-20">
              <h2 className="font-bold text-lg mb-4">ملخص الطلب</h2>
              <dl className="space-y-2 text-sm mb-4">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">المجموع الفرعي</dt>
                  <dd className="font-medium">{format(subtotal)}</dd>
                </div>
                {subtotal > 100 && (
                  <div className="flex justify-between text-emerald-600">
                    <dt>الخصم</dt>
                    <dd className="font-medium">-{format(discount)}</dd>
                  </div>
                )}
              </dl>
              <div className="flex justify-between items-baseline pt-3 border-t border-border mb-5">
                <span className="font-bold">الإجمالي</span>
                <span className="font-bold text-xl text-primary">
                  {format(total)}
                </span>
              </div>
              <div className="space-y-2">
                <Link
                  href="/checkout"
                  className="w-full inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground rounded-full py-3 font-bold hover:bg-primary/90 transition-colors"
                >
                  إتمام الطلب 
                </Link>

              </div>
            </aside>
          </div>
        )}
      </main>
      <FooterClient />
      <MobileNav />
    </>
  )
}
