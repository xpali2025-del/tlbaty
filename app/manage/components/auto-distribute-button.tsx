"use client"

import { useTransition } from "react"
import { Shuffle } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { autoDistributeOrders } from "../orders-actions"

/**
 * زر التوزيع التلقائي العادل. بلا معرّفات يوزّع كل الطلبات المفتوحة التي بلا مندوب،
 * ومع معرّفات يوزّع المحددة فقط. النتيجة الحقيقية (من الخادم) هي التي تُعرض.
 */
export function AutoDistributeButton({
  orderIds,
  label,
  variant = "default",
  onDone,
}: {
  orderIds?: string[]
  label: string
  variant?: "default" | "outline"
  onDone?: () => void
}) {
  const [pending, startTransition] = useTransition()

  function run() {
    startTransition(async () => {
      const result = await autoDistributeOrders(orderIds)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      if (result.assigned === 0) toast.info(result.message)
      else toast.success(`${result.message} (${result.perCourier.map((c) => `${c.name}: ${c.count}`).join("، ")})`)
      onDone?.()
    })
  }

  return (
    <Button size="sm" variant={variant} className="gap-1.5" disabled={pending} onClick={run}>
      <Shuffle className="h-3.5 w-3.5" aria-hidden="true" />
      {pending ? "جارٍ التوزيع..." : label}
    </Button>
  )
}
