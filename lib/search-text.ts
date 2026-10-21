// تطبيع نصوص البحث العربي/الإنجليزي — منطق خالص يُستخدم عند بناء فهرس البحث (الكتابة)
// وعند البحث (القراءة) بنفس القواعد، فيتطابق ما يُخزَّن مع ما يُكتب.

import { toLatinDigits } from "./product-code"

/**
 * يوحّد: الأرقام العربية→لاتينية، التشكيل والتطويل يُحذفان، الألف بأشكالها (أإآٱ→ا)،
 * ى→ي، ة→ه، ؤ→و، ئ→ي، الحروف اللاتينية صغيرة، وعلامات الترقيم تصير مسافة.
 * فيجد «فستان» و«فُستان»، و«أحمر» و«احمر»، و«مدرسة» و«مدرسه».
 */
export function normalizeSearchText(input: string): string {
  return toLatinDigits(input)
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ")
}

/** كلمات البحث: بلا تكرار، حتى 8 كلمات، وكل كلمة حرفان على الأقل (أو رقم). */
export function searchTokens(query: string): string[] {
  const tokens = normalizeSearchText(query)
    .split(" ")
    .filter((t) => t.length >= 2 || /^\d$/.test(t))
  return [...new Set(tokens)].slice(0, 8)
}

export type SearchableProduct = {
  name: string
  description?: string | null
  code: string
  sku?: string | null
  category?: string | null
  subcategory?: string | null
  brand?: string | null
  colors?: string[]
  sizes?: string[]
  tags?: string[]
  keywords?: string[]
}

/** النص المفهرس للمنتج (يُخزَّن في products.search_text). الوصف يُقتطع حتى لا يطغى على الاسم. */
export function buildSearchText(p: SearchableProduct): string {
  const parts = [
    p.name,
    p.code,
    p.sku,
    p.category,
    p.subcategory,
    p.brand,
    ...(p.colors ?? []),
    ...(p.sizes ?? []),
    ...(p.tags ?? []),
    ...(p.keywords ?? []),
    (p.description ?? "").slice(0, 400),
  ]
  return normalizeSearchText(parts.filter(Boolean).join(" "))
}
