"use client"

import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import type { Product, WishlistItem } from "@/lib/types"

interface WishlistContextType {
  items: WishlistItem[]
  /** إضافة منتج (يُتجاهل إن كان موجوداً بالفعل) */
  addItem: (product: Product) => void
  /** حذف منتج بالاعتماد على المعرّف */
  removeItem: (id: string) => void
  /** إضافة أو حذف المنتج — تُعيد true إذا تمت الإضافة و false إذا تم الحذف */
  toggleItem: (product: Product) => boolean
  /** التحقق هل المنتج موجود في الرغبات */
  isInWishlist: (id: string) => boolean
  /** تفريغ الرغبات */
  clearWishlist: () => void
  /** عدد المنتجات المحفوظة */
  totalItems: number
}

const WishlistContext = createContext<WishlistContextType | undefined>(undefined)

const STORAGE_KEY = "taraf_wishlist"

/** يحوّل المنتج إلى عنصر رغبات بالحقول اللازمة فقط */
function toWishlistItem(product: Product): WishlistItem {
  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    price: product.price,
    oldPrice: product.oldPrice,
    image: product.images?.[0] || product.image,
    colors: Array.isArray(product.colors) ? product.colors : [],
    sizes: Array.isArray(product.sizes) ? product.sizes : [],
  }
}

/** يتحقق أن العنصر المخزَّن صالح ويملك الحد الأدنى من الحقول */
function isValidItem(value: unknown): value is WishlistItem {
  if (typeof value !== "object" || value === null) return false
  const item = value as Record<string, unknown>
  return (
    typeof item.id === "string" &&
    typeof item.name === "string" &&
    typeof item.price === "number" &&
    typeof item.image === "string"
  )
}

/** يقرأ ويُنظّف بيانات localStorage غير الصحيحة دون انهيار */
function parseStored(raw: string | null): WishlistItem[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(isValidItem)
      .map((item) => ({
        ...item,
        colors: Array.isArray(item.colors) ? item.colors : [],
        sizes: Array.isArray(item.sizes) ? item.sizes : [],
      }))
  } catch {
    return []
  }
}

export function WishlistProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<WishlistItem[]>([])
  const [hydrated, setHydrated] = useState(false)

  // قراءة البيانات المحفوظة مرة واحدة بعد التحميل
  useEffect(() => {
    setItems(parseStored(localStorage.getItem(STORAGE_KEY)))
    setHydrated(true)
  }, [])

  // الحفظ فقط بعد اكتمال الـ Hydration حتى لا نستبدل البيانات المحفوظة بقائمة فارغة
  useEffect(() => {
    if (hydrated) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
    }
  }, [items, hydrated])

  const isInWishlist = (id: string) => items.some((i) => i.id === id)

  const addItem = (product: Product) => {
    setItems((prev) => {
      if (prev.some((i) => i.id === product.id)) return prev
      return [...prev, toWishlistItem(product)]
    })
  }

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id))
  }

  const toggleItem = (product: Product) => {
    const exists = items.some((i) => i.id === product.id)
    if (exists) {
      removeItem(product.id)
      return false
    }
    addItem(product)
    return true
  }

  const clearWishlist = () => setItems([])

  const totalItems = items.length

  return (
    <WishlistContext.Provider
      value={{ items, addItem, removeItem, toggleItem, isInWishlist, clearWishlist, totalItems }}
    >
      {children}
    </WishlistContext.Provider>
  )
}

export function useWishlist() {
  const ctx = useContext(WishlistContext)
  if (!ctx) throw new Error("useWishlist must be used within WishlistProvider")
  return ctx
}
