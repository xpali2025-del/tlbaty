import { NextResponse, type NextRequest } from "next/server"
import { isCronAuthorized } from "@/lib/cron-auth"
import { purgeExpiredAuthData, purgeOldPaymentProofs } from "@/lib/maintenance"

// GET /api/cron/cleanup — يستدعيه جدول Vercel Cron يومياً مع Authorization: Bearer $CRON_SECRET.
// بلا CRON_SECRET يُرفض الطلب دائماً (لا نقطة نهاية مفتوحة).

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  try {
    const deleted = await purgeExpiredAuthData()
    // فشل حذف الإثباتات لا يمنع نتيجة التنظيف الأساسي؛ يُعاد المحاولة غداً.
    const proofs = await purgeOldPaymentProofs().catch((error) => {
      console.error("proof purge failed:", error instanceof Error ? error.message : error)
      return null
    })
    return NextResponse.json({ ok: true, deleted, proofs })
  } catch (error) {
    console.error("cleanup failed:", error instanceof Error ? error.message : error)
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
