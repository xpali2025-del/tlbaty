"use client"

import Image from "next/image"
import { Package } from "lucide-react"
import { resolveItemProductNumber } from "@/lib/product-number"
import type { AdminOrderItem } from "@/lib/admin-orders"

// ============================================
// عناصر الطلب — تعرض صورة المنتج واسمه ورقمه ورقم SKU
// واللون والمقاس والكمية والسعر والإجمالي.
//
// كل الحقول اختيارية حتى تبقى الطلبات القديمة معروضة بلا أعطال.
// ============================================

export function money(value?: number, currency?: string): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-"
  return `${value.toLocaleString("ar-YE")} ${currency ?? "ريال"}`
}

/** سطر واحد من عناصر الطلب — تصميم بطاقات يعمل على الشاشات الصغيرة. */
function ItemCard({ item, currency }: { item: AdminOrderItem; currency?: string }) {
  const productNumber = resolveItemProductNumber(item)
  const options = [item.color, item.size].filter(Boolean).join(" / ")

  return (
    <li className="flex gap-3 border-b p-3 last:border-b-0">
      {item.image ? (
        <Image
          src={item.image || "/placeholder.svg"}
          alt={item.name ?? "منتج"}
          width={56}
          height={56}
          className="h-14 w-14 shrink-0 rounded-lg border object-cover"
        />
      ) : (
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg border bg-muted">
          <Package className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
        </div>
      )}

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold">{item.name || "منتج غير مسمى"}</p>

        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
          {productNumber ? (
            <span
              className="rounded-md bg-primary/10 px-1.5 py-0.5 font-mono font-bold text-primary"
              dir="ltr"
            >
              {productNumber}
            </span>
          ) : (
            <span className="text-muted-foreground">بلا رقم منتج</span>
          )}
          {item.sku ? (
            <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono" dir="ltr">
              SKU: {item.sku}
            </span>
          ) : null}
        </div>

        <p className="mt-1 text-xs text-muted-foreground">
          {options || "بلا خيارات"} • الكمية: {item.quantity ?? 1}
        </p>
      </div>

      <div className="shrink-0 text-left">
        <p className="text-xs text-muted-foreground">{money(item.price, currency)}</p>
        <p className="text-sm font-bold">{money(item.lineTotal, currency)}</p>
      </div>
    </li>
  )
}

export function OrderItemsTable({
  items,
  currency,
}: {
  items: AdminOrderItem[]
  currency?: string
}) {
  if (items.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
        لا توجد عناصر مسجلة في هذا الطلب
      </p>
    )
  }

  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="border-b bg-muted/50 px-3 py-2 text-xs font-bold text-muted-foreground">
        المنتجات ({items.length})
      </div>
      <ul>
        {items.map((item, index) => (
          <ItemCard key={`${item.productId ?? "item"}-${index}`} item={item} currency={currency} />
        ))}
      </ul>
    </div>
  )
}
