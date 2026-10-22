import { NextResponse, type NextRequest } from "next/server"
import { isCronAuthorized } from "@/lib/cron-auth"
import { runReminders } from "@/lib/marketing/reminders"

// GET /api/cron/reminders — يستدعيه Vercel Cron يومياً مع Authorization: Bearer $CRON_SECRET.
// يشغّل قواعد التذكير المفعّلة من لوحة الإدارة (سلة متروكة / رغبات). آمن للتكرار.

export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  try {
    return NextResponse.json({ ok: true, result: await runReminders() })
  } catch (error) {
    console.error("reminders failed:", error instanceof Error ? error.message : error)
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
