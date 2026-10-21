import type { Metadata } from "next"
import { WishlistClient } from "@/components/wishlist-client"

// صفحة شخصية تعتمد على localStorage الخاص بالجهاز — تُستثنى من الفهرسة
export const metadata: Metadata = {
  title: "قائمة الرغبات",
  description: "المنتجات التي حفظتها في قائمة رغباتك.",
  robots: {
    index: false,
    follow: false,
  },
}

export default function WishlistPage() {
  return <WishlistClient />
}
