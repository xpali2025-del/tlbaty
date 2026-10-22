"use client"

import { useState } from "react"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/hooks/use-toast"

/** موافقة العميل على استلام العروض والتذكيرات. مغلقة افتراضياً، ويغيّرها العميل وحده من حسابه. */
export function MarketingConsent({ initial }: { initial: boolean }) {
  const { toast } = useToast()
  const [optIn, setOptIn] = useState(initial)
  const [busy, setBusy] = useState(false)

  async function change(next: boolean) {
    setBusy(true)
    const previous = optIn
    setOptIn(next)
    try {
      const res = await fetch("/api/account/marketing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ optIn: next }),
      })
      if (!res.ok) throw new Error("failed")
      toast({ title: next ? "تم تفعيل استلام العروض" : "تم إيقاف استلام العروض" })
    } catch {
      setOptIn(previous)
      toast({ title: "تعذّر حفظ اختيارك", description: "تحقق من اتصالك وحاول مجدداً." })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-start justify-between gap-4 rounded-xl border border-border bg-card p-4">
      <div className="min-w-0">
        <label htmlFor="marketing-opt-in" className="block text-sm font-bold">
          أوافق على استلام العروض
        </label>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          نرسل لك تذكيراً بمنتجات سلتك ورغباتك، وأكواد خصم وعروضاً خاصة. يمكنك الإيقاف في أي وقت.
        </p>
      </div>
      <Switch id="marketing-opt-in" checked={optIn} onCheckedChange={change} disabled={busy} aria-label="أوافق على استلام العروض" />
    </div>
  )
}
