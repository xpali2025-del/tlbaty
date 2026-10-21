import type { Metadata } from "next"
import { RecentlyViewedClient } from "@/components/recently-viewed-client"

// صفحة شخصية تعتمد على localStorage الخاص بالجهاز — تُستثنى من الفهرسة
export const metadata: Metadata = {
  title: "المنتجات المعروضة مؤخرًا",
  description: "المنتجات التي شاهدت تفاصيلها مؤخرًا على هذا الجهاز.",
  robots: {
    index: false,
    follow: false,
  },
}

export default function RecentlyViewedPage() {
  return <RecentlyViewedClient />
}
