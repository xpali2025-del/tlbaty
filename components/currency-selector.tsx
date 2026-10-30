"use client"

import { ChevronDown, DollarSign } from "lucide-react"
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
 * يعرض رمز العملة في مظهر الكبسولة، وأيقونة $ في المظهر الافتراضي.
 * العملة الحالية تظهر داخل القائمة وفي وصف الزر لقارئات الشاشة.
 * عملة واحدة فقط: لا خيار يُقدَّم فلا يظهر الزر.
 */
export function CurrencyIconMenu({ align = "end", variant = "icon" }: { align?: "start" | "end"; variant?: "icon" | "pill" }) {
  const { currencies, currency, setCurrencyCode } = useCurrency()

  if (currencies.length < 2) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={variant === "pill"
            ? "flex h-11 min-w-16 max-w-24 items-center justify-center gap-1 rounded-full bg-primary/5 px-3 text-sm font-semibold text-foreground transition-colors hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            : "p-2 text-foreground transition-colors hover:text-primary"}
          aria-label={`تغيير العملة (الحالية: ${currency.name})`}
          title="تغيير العملة"
        >
          {variant === "pill" ? (
            <>
              <bdi className="truncate">{currency.symbol || currency.code}</bdi>
              <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" />
            </>
          ) : <DollarSign className="h-6 w-6" aria-hidden="true" />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="min-w-52">
        <DropdownMenuLabel>اختر العملة</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={currency.code} onValueChange={setCurrencyCode}>
          {currencies.map((c) => (
            <DropdownMenuRadioItem key={c.code} value={c.code} className="min-h-11 gap-2">
              <span className="flex-1">{c.name}</span>
              <span className="text-xs text-muted-foreground">{c.symbol}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
