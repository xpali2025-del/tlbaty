"use client"

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import {
  convertPrice as convert,
  formatPrice as format,
  normalizeCurrencies,
  type Currency,
} from "@/lib/currency"

interface CurrencyContextType {
  /** كل العملات المتاحة (من إعدادات المتجر) */
  currencies: Currency[]
  /** العملة المختارة حالياً */
  currency: Currency
  /** تغيير العملة المختارة عبر رمزها المختصر */
  setCurrencyCode: (code: string) => void
  /** تنسيق سعر أساسي (بالريال اليمني القديم) للعرض بالعملة المختارة */
  format: (basePrice: number) => string
  /** تحويل سعر أساسي إلى رقم بالعملة المختارة */
  convert: (basePrice: number) => number
}

const CurrencyContext = createContext<CurrencyContextType | undefined>(undefined)

const STORAGE_KEY = "taraf_currency"

export function CurrencyProvider({
  currencies,
  defaultCode,
  children,
}: {
  currencies: Currency[]
  defaultCode: string
  children: ReactNode
}) {
  const list = useMemo(() => normalizeCurrencies(currencies), [currencies])
  const fallbackCode = list.some((c) => c.code === defaultCode) ? defaultCode : list[0].code

  const [code, setCode] = useState(fallbackCode)

  // استرجاع اختيار العميل السابق من هذا الجهاز بعد الترطيب
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored && list.some((c) => c.code === stored)) setCode(stored)
    } catch {}
  }, [list])

  const setCurrencyCode = (next: string) => {
    if (!list.some((c) => c.code === next)) return
    setCode(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {}
  }

  const currency = useMemo(
    () => list.find((c) => c.code === code) ?? list.find((c) => c.code === fallbackCode) ?? list[0],
    [list, code, fallbackCode],
  )

  const value = useMemo<CurrencyContextType>(
    () => ({
      currencies: list,
      currency,
      setCurrencyCode,
      format: (basePrice: number) => format(basePrice, currency),
      convert: (basePrice: number) => convert(basePrice, currency),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [list, currency],
  )

  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>
}

export function useCurrency() {
  const ctx = useContext(CurrencyContext)
  if (!ctx) throw new Error("useCurrency must be used within CurrencyProvider")
  return ctx
}
