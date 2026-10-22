import { NextResponse } from "next/server"

import { getPersonalNotifications } from "@/lib/notifications"
import { resolveSession } from "@/lib/otp/session"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// GET /api/notifications/mine — إشعارات العميل الشخصية (تذكير السلة/الرغبات مع كود خصمه).
// هوية العميل من الجلسة وحدها، والرد خاص (no-store) فلا يُخزَّن في كاش مشترك. بلا جلسة: قائمة فارغة (ليس خطأ).

export async function GET() {
  const headers = { "Cache-Control": "private, no-store" }
  const resolved = await resolveSession().catch(() => null)
  if (!resolved) return NextResponse.json({ items: [] }, { headers })
  try {
    return NextResponse.json({ items: await getPersonalNotifications(resolved.customer.id) }, { headers })
  } catch {
    // فشل الإشعارات الشخصية لا يجوز أن يعطل الجرس.
    return NextResponse.json({ items: [] }, { headers })
  }
}
