import { NextResponse, type NextRequest } from "next/server"
import { sanitizePalette } from "@/lib/palette"
import { hitRateLimit } from "@/lib/rate-limit-memory"
import { searchByPalette } from "@/lib/search"
import { parseSearchParams } from "@/lib/search-params"

// POST /api/search/image
// الصورة نفسها لا تُرفع إلى الخادم: المتصفح يصغّرها ويستخرج بصمة ألوانها (≤4 ألوان) ويرسلها فقط،
// فلا تُخزَّن صور العملاء ولا يُستهلك عرض نطاق. الخادم يتحقق من البصمة ويرتّب المنتجات بالتشابه.

export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
  if (hitRateLimit(`image-search:${ip}`, 20, 60_000)) {
    return NextResponse.json({ error: "RATE_LIMITED", message: "محاولات كثيرة، انتظر قليلاً." }, { status: 429 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 })
  }
  const record = (body && typeof body === "object" ? body : {}) as { palette?: unknown; filters?: Record<string, string | string[]> }
  const palette = sanitizePalette(record.palette)
  if (palette.length === 0) {
    return NextResponse.json({ error: "INVALID_IMAGE", message: "تعذّر قراءة ألوان الصورة." }, { status: 400 })
  }
  const filters = parseSearchParams(record.filters && typeof record.filters === "object" ? record.filters : {})
  try {
    return NextResponse.json(await searchByPalette(palette, filters))
  } catch (error) {
    console.error("image search failed:", error instanceof Error ? error.message : "unknown")
    return NextResponse.json({ error: "SEARCH_FAILED" }, { status: 500 })
  }
}
