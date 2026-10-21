// أنواع نتائج البحث التي يستهلكها العميل — بلا server-only حتى تُستورد في مكوّنات العميل.
import type { Product } from "@/lib/types"

export type SearchResult = {
  items: Product[]
  total: number
  limit: number
  matchedCode?: string
}

export type SearchFacets = {
  categories: { slug: string; name: string; count: number; subcategories: { slug: string; name: string; count: number }[] }[]
  brands: { slug: string; name: string; count: number }[]
  colors: { key: string; label: string; hex: string; count: number }[]
  sizes: { size: string; count: number }[]
  price: { min: number; max: number }
}
