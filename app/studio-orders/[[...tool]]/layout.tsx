import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "استوديو الطلبات",
  robots: { index: false, follow: false },
}

export default function OrdersStudioLayout({ children }: { children: React.ReactNode }) {
  return children
}
