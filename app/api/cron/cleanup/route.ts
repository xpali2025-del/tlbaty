import { revalidatePath, revalidateTag } from "next/cache"
import { NextResponse, type NextRequest } from "next/server"
import { CACHE_TAGS } from "@/lib/cache-tags"
import { isCronAuthorized } from "@/lib/cron-auth"
import { isDbConfigured } from "@/lib/db-cache"
import { isImageSearchEnabled } from "@/lib/site-config"
import { runAfterResponse } from "@/lib/manage-helpers"
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
    // Resume a bounded backfill after responding, without delaying the cleanup job.
    if (isDbConfigured() && await isImageSearchEnabled()) {
      await runAfterResponse(async () => {
        const { processPaletteBackfill } = await import("@/lib/product-palette")
        await processPaletteBackfill()
      })
    }
    // الإعلانات المؤرّخة تبدأ/تنتهي باليوم: نُبطل كاشها يومياً كي لا تنتظر تعديلاً من اللوحة.
    try {
      revalidateTag(CACHE_TAGS.ads, { expire: 0 })
      revalidatePath("/", "layout")
    } catch (error) {
      console.error("ads revalidate failed:", error instanceof Error ? error.message : error)
    }
    return NextResponse.json({ ok: true, deleted, proofs })
  } catch (error) {
    console.error("cleanup failed:", error instanceof Error ? error.message : error)
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
