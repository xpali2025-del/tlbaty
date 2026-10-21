"use client"

import useSWR from "swr"
import { FooterView } from "./footer-view"

type FooterLink = { label: string; href: string }

const fetcher = (url: string): Promise<{ categories: FooterLink[] }> =>
  fetch(url).then((r) => r.json())

// ============================================
// الفوتر لصفحات "use client" (السلة/التواصل/الدفع)
// يجلب نفس أقسام عبر API فتبقى الأقسام موحّدة
// وتتفادى روابط 404. قبل وصول البيانات لا تظهر أقسام قديمة.
// ============================================
export function FooterClient() {
  const { data } = useSWR("/api/footer-categories", fetcher, {
    revalidateOnFocus: false,
  })
  return <FooterView categories={data?.categories ?? []} />
}
