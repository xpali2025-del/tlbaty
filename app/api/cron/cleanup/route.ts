import { timingSafeEqual } from "node:crypto"
import { NextResponse, type NextRequest } from "next/server"
import { purgeExpiredAuthData, purgeOldPaymentProofs } from "@/lib/maintenance"

// GET /api/cron/cleanup — يستدعيه جدول Vercel Cron يومياً مع Authorization: Bearer $CRON_SECRET.
// بلا CRON_SECRET يُرفض الطلب دائماً (لا نقطة نهاية مفتوحة).

export const dynamic = "force-dynamic"

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const given = Buffer.from(request.headers.get("authorization") ?? "")
  const expected = Buffer.from(`Bearer ${secret}`)
  return given.length === expected.length && timingSafeEqual(given, expected)
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
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
