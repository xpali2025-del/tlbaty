import { redirect } from "next/navigation"

// ============================================
// /studio/orders → إعادة توجيه إلى استوديو الطلبات /studio-orders
// (استوديو الطلبات مشروع Sanity مستقل يعمل على مسار خاص به)
// ============================================

export default function StudioOrdersRedirect() {
  redirect("/studio-orders")
}
