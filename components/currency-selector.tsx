"use client"

import { useState } from "react"
import { Check, ChevronDown, Coins } from "lucide-react"
import { useCurrency } from "@/components/currency-provider"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

/**
 * زر مضغوط لاختيار العملة — يظهر في شريط الهيدر العلوي.
 */
export function CurrencySelectorMenu() {
  const { currencies, currency, setCurrencyCode } = useCurrency()

  // عملة واحدة فقط: لا داعي لعرض أي أداة اختيار
  if (currencies.length < 2) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:border-primary hover:text-primary"
          aria-label="اختيار العملة"
        >
          <Coins className="h-4 w-4" aria-hidden="true" />
          <span>{currency.symbol}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        <DropdownMenuLabel>اختر العملة</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={currency.code} onValueChange={setCurrencyCode}>
          {currencies.map((c) => (
            <DropdownMenuRadioItem key={c.code} value={c.code} className="gap-2">
              <span className="flex-1">{c.name}</span>
              <span className="text-xs text-muted-foreground">{c.symbol}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * خيار "تغيير العملة" قابل للطي — تُستخدم داخل القائمة الجانبية للموبايل.
 * يظهر كصف واحد، وعند الضغط عليه تُعرض قائمة العملات.
 */
export function CurrencySelectorList({ onSelect }: { onSelect?: () => void }) {
  const { currencies, currency, setCurrencyCode } = useCurrency()
  const [expanded, setExpanded] = useState(false)

  if (currencies.length < 2) return null

  return (
    <div className="px-4 py-3">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-2 rounded-xl px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-primary"
      >
        <span className="flex items-center gap-2">
          <Coins className="h-4 w-4 text-primary" aria-hidden="true" />
          تغيير العملة
        </span>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {currency.name}
          <ChevronDown
            className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
        </span>
      </button>

      {expanded && (
        <div className="mt-2 flex flex-col gap-1.5" role="radiogroup" aria-label="اختيار العملة">
          {currencies.map((c) => {
            const active = c.code === currency.code
            return (
              <button
                key={c.code}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => {
                  setCurrencyCode(c.code)
                  setExpanded(false)
                  onSelect?.()
                }}
                className={`flex items-center justify-between gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors ${
                  active
                    ? "border-primary bg-primary/5 text-primary"
                    : "border-border text-foreground hover:border-primary/50"
                }`}
              >
                <span className="flex items-center gap-2">
                  {active && <Check className="h-4 w-4" aria-hidden="true" />}
                  {c.name}
                </span>
                <span className="text-xs text-muted-foreground">{c.symbol}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
