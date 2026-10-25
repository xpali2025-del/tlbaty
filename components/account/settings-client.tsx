"use client"

import { useState } from "react"
import { Check, Coins, Share2 } from "lucide-react"
import { CountPill, SettingsButtonRow } from "@/components/account/settings-ui"
import { useCurrency } from "@/components/currency-provider"
import { useWishlist } from "@/components/wishlist-provider"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { useRecentlyViewed } from "@/hooks/use-recently-viewed"
import { useSavedAddresses } from "@/hooks/use-saved-addresses"
import { useToast } from "@/hooks/use-toast"

/** عدّاد الرغبات من المتصفح (مصدره التخزين المحلي المتزامن مع الحساب). */
export function WishlistCount() {
  const { totalItems } = useWishlist()
  return totalItems > 0 ? <CountPill>{totalItems}</CountPill> : null
}

export function RecentCount() {
  const { items } = useRecentlyViewed()
  return items.length > 0 ? <CountPill>{items.length}</CountPill> : null
}

export function AddressCount() {
  const { addresses } = useSavedAddresses()
  return addresses.length > 0 ? <CountPill>{addresses.length}</CountPill> : null
}

/** رصيد المحفظة بالعملة المختارة (المخزَّن بالأساس). */
export function Balance({ base }: { base: number }) {
  const { format } = useCurrency()
  return <span className="shrink-0 text-sm font-bold tabular-nums text-primary">{format(base)}</span>
}

/** صف تغيير العملة: يفتح قائمة العملات. عملة واحدة فقط → صف معلومات بلا فعل. */
export function CurrencyRow() {
  const { currencies, currency, setCurrencyCode } = useCurrency()
  const [open, setOpen] = useState(false)
  const single = currencies.length < 2
  return (
    <>
      <SettingsButtonRow
        icon={Coins}
        label="العملة"
        description={single ? "عملة المتجر الوحيدة" : "اختر العملة التي تُعرض بها الأسعار"}
        trailing={<span className="shrink-0 text-xs text-muted-foreground">{currency.name} ({currency.symbol})</span>}
        onClick={() => !single && setOpen(true)}
      />
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" dir="rtl" className="max-h-[80vh] gap-0 overflow-y-auto rounded-t-2xl p-0 sm:mx-auto sm:max-w-md">
          <SheetHeader className="border-b p-4 pr-14 text-right">
            <SheetTitle>اختر العملة</SheetTitle>
            <SheetDescription className="sr-only">تُحوَّل كل أسعار المتجر إلى العملة المختارة.</SheetDescription>
          </SheetHeader>
          <ul className="p-2" role="radiogroup" aria-label="العملة">
            {currencies.map((c) => {
              const active = c.code === currency.code
              return (
                <li key={c.code}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => {
                      setCurrencyCode(c.code)
                      setOpen(false)
                    }}
                    className={`flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-right text-sm ${active ? "bg-primary/10 font-bold text-primary" : "hover:bg-muted"}`}
                  >
                    <span className="flex-1">{c.name}</span>
                    <span className="text-xs text-muted-foreground">{c.symbol}</span>
                    {active && <Check className="h-4 w-4" aria-hidden="true" />}
                  </button>
                </li>
              )
            })}
          </ul>
        </SheetContent>
      </Sheet>
    </>
  )
}

/** مشاركة رابط المتجر: قائمة المشاركة في الجوال، ونسخ الرابط إن لم تتوفر. */
export function ShareRow({ title, text }: { title: string; text: string }) {
  const { toast } = useToast()
  const share = async () => {
    const url = window.location.origin
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ title, text, url })
        return
      }
      await navigator.clipboard.writeText(url)
      toast({ title: "تم نسخ رابط المتجر", description: url })
    } catch (e) {
      // إغلاق نافذة المشاركة ليس خطأ
      if (e instanceof DOMException && e.name === "AbortError") return
      toast({ title: "تعذّرت المشاركة", description: url })
    }
  }
  return <SettingsButtonRow icon={Share2} label="مشاركة التطبيق" description="أرسل رابط المتجر لأصدقائك" onClick={share} />
}
