"use client"

import { Check, Coins, Share2 } from "lucide-react"
import { CountPill, SettingsButtonRow } from "@/components/account/settings-ui"
import { useCurrency } from "@/components/currency-provider"
import { useWishlist } from "@/components/wishlist-provider"
import { useRecentlyViewed } from "@/hooks/use-recently-viewed"
import { useSavedAddresses } from "@/hooks/use-saved-addresses"
import { useToast } from "@/hooks/use-toast"

/** عدّاد: شارة في الصفوف (plain=false)، أو رقم مجرد داخل البلاطات (plain). صفر لا يُعرض شارة. */
function Count({ n, plain }: { n: number; plain?: boolean }) {
  if (plain) return <>{n}</>
  return n > 0 ? <CountPill>{n}</CountPill> : null
}

/** عدّاد الرغبات من المتصفح (مصدره التخزين المحلي المتزامن مع الحساب). */
export function WishlistCount({ plain }: { plain?: boolean }) {
  const { totalItems } = useWishlist()
  return <Count n={totalItems} plain={plain} />
}

export function RecentCount() {
  const { items } = useRecentlyViewed()
  return <Count n={items.length} />
}

export function AddressCount({ plain }: { plain?: boolean }) {
  const { addresses } = useSavedAddresses()
  return <Count n={addresses.length} plain={plain} />
}

/** رصيد المحفظة بالعملة المختارة (المخزَّن بالأساس). */
export function Balance({ base, plain }: { base: number; plain?: boolean }) {
  const { format } = useCurrency()
  if (plain) return <span className="text-sm">{format(base)}</span>
  return <span className="shrink-0 text-sm font-bold tabular-nums text-primary">{format(base)}</span>
}

/**
 * بطاقة العملة بارزة أعلى الصفحة: كل العملات المتاحة أزرار تُختار بنقرة واحدة وتتحوّل الأسعار فوراً.
 * عملة واحدة فقط → لا تُعرض (لا خيار يُقدَّم).
 */
export function CurrencyCard() {
  const { currencies, currency, setCurrencyCode } = useCurrency()
  if (currencies.length < 2) return null
  return (
    <div role="group" aria-label="العملة" className="p-4">
      <div className="mb-3 flex items-center gap-3">
        <Coins className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0">
          <h3 className="text-sm font-bold">عملة عرض الأسعار</h3>
          <p className="text-xs text-muted-foreground">تتحوّل كل أسعار المتجر فوراً</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="العملة">
        {currencies.map((c) => {
          const active = c.code === currency.code
          return (
            <button
              key={c.code}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setCurrencyCode(c.code)}
              className={`flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-sm font-medium transition ${
                active ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted"
              }`}
            >
              {active && <Check className="h-4 w-4" aria-hidden="true" />}
              <span>{c.name}</span>
              <span className={active ? "text-xs opacity-90" : "text-xs text-muted-foreground"}>{c.symbol}</span>
            </button>
          )
        })}
      </div>
    </div>
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
