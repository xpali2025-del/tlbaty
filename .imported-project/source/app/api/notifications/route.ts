import { NextResponse, type NextRequest } from "next/server"

import { getPublicNotifications } from "@/lib/notifications"

// ============================================
// GET /api/notifications?page=N
//
// يُستخدم لزر «عرض المزيد» في شاشة الإشعارات فقط.
// يعيد الإشعارات المنشورة الصالحة (الفلترة كلها في GROQ على الخادم).
// ============================================

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("page")
  const parsed = Number(raw)
  // نتحقق من الصفحة على الخادم ولا نثق بقيمة الواجهة.
  const page = Number.isFinite(parsed) && parsed > 0 ? Math.min(Math.floor(parsed), 500) : 0

  try {
    const result = await getPublicNotifications(page)
    return NextResponse.json({ items: result.items, hasMore: result.hasMore })
  } catch {
    return NextResponse.json({ error: "تعذّر تحميل الإشعارات" }, { status: 503 })
  }
}
