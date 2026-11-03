"use client"

import { ChevronDown, DollarSign } from "lucide-react"
import { useCurrency } from "@/components/currency-provider"
import { cn } from "@/lib/utils"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

type CurrencyIconMenuProps = {
  align?: "start" | "end"
  appearance?: "icon" | "label"
}

export function CurrencyIconMenu({ align = "end", appearance = "icon" }: CurrencyIconMenuProps) {
  const { currencies, currency, setCurrencyCode } = useCurrency()

  if (currencies.length < 2) return null

  const showLabel = appearance === "label"

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "text-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
            showLabel
              ? "flex h-10 min-w-[78px] items-center justify-center gap-2 rounded-full bg-[#fff3f6] px-3 text-sm font-semibold text-black hover:bg-[#ffe7ee] hover:text-black"
              : "p-2",
          )}
          aria-label={`تغيير العملة (الحالية: ${currency.name})`}
          title="تغيير العملة"
        >
          {showLabel ? (
            <>
              <span dir="auto">{currency.symbol}</span>
              <ChevronDown className="size-4" aria-hidden="true" />
            </>
          ) : (
            <DollarSign className="size-6" aria-hidden="true" />
          )}
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
