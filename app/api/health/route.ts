import { NextResponse } from "next/server"
import { isCronAuthorized } from "@/lib/cron-auth"
import { getHealthReport } from "@/lib/health"

// GET /api/health — للمراقبة (UptimeRobot وغيره). بلا مصادقة: {status} فقط، و503 إن تعطلت القاعدة.
// مع Authorization: Bearer $CRON_SECRET: تفاصيل القاعدة والبوت والتخزين (قيم منطقية فقط، لا أسرار).

export const dynamic = "force-dynamic"

const NO_STORE = { "Cache-Control": "no-store" }

export async function GET(request: Request) {
  try {
    const report = await getHealthReport()
    const httpStatus = report.status === "down" ? 503 : 200
    const body = isCronAuthorized(request) ? report : { status: report.status }
    return NextResponse.json(body, { status: httpStatus, headers: NO_STORE })
  } catch {
    return NextResponse.json({ status: "down" }, { status: 503, headers: NO_STORE })
  }
}
