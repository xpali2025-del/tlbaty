import { NextResponse } from "next/server"
import { ZodError } from "zod"
import { getCustomerData, MAX_CUSTOMER_DATA_BYTES, parseCustomerData, saveCustomerData } from "@/lib/customer-data-server"
import { resolveSession } from "@/lib/otp/session"
import { hitRateLimit } from "@/lib/rate-limit-memory"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// GET/PUT /api/account/data — سلة العميل ورغباته وعناوينه ومشاهداته لتتبعه بين الأجهزة.
// هوية العميل من الجلسة على الخادم وحدها. الكتابة مُجمَّعة من المتصفح (تأخير ثانيتين) لا عند كل نقرة.

const noStore = { "Cache-Control": "no-store" }

export async function GET() {
  const resolved = await resolveSession().catch(() => null)
  if (!resolved) return NextResponse.json({ ok: false, error: "AUTH_REQUIRED" }, { status: 401, headers: noStore })
  const { data, updatedAt } = await getCustomerData(resolved.customer.id)
  return NextResponse.json({ ok: true, customerId: resolved.customer.publicId, data, updatedAt }, { headers: noStore })
}

export async function PUT(req: Request) {
  const resolved = await resolveSession().catch(() => null)
  if (!resolved) return NextResponse.json({ ok: false, error: "AUTH_REQUIRED" }, { status: 401, headers: noStore })
  if (hitRateLimit(`account-data:${resolved.customer.id}`, 60, 60_000)) {
    return NextResponse.json({ ok: false, error: "RATE_LIMITED" }, { status: 429, headers: noStore })
  }

  const declared = Number(req.headers.get("content-length") ?? 0)
  if (declared > MAX_CUSTOMER_DATA_BYTES * 1.5) return NextResponse.json({ ok: false, error: "TOO_LARGE" }, { status: 413, headers: noStore })
  let body: unknown
  try {
    const text = await req.text()
    if (text.length > MAX_CUSTOMER_DATA_BYTES * 1.5) return NextResponse.json({ ok: false, error: "TOO_LARGE" }, { status: 413, headers: noStore })
    body = JSON.parse(text)
  } catch {
    return NextResponse.json({ ok: false, error: "INVALID_JSON" }, { status: 400, headers: noStore })
  }

  try {
    const data = parseCustomerData((body as { data?: unknown } | null)?.data)
    const updatedAt = await saveCustomerData(resolved.customer.id, data)
    return NextResponse.json({ ok: true, updatedAt }, { headers: noStore })
  } catch (error) {
    if (error instanceof ZodError || (error instanceof Error && error.message === "TOO_LARGE")) {
      return NextResponse.json({ ok: false, error: "INVALID_DATA" }, { status: 400, headers: noStore })
    }
    console.error("customer data save failed:", error instanceof Error ? error.message : "unknown")
    return NextResponse.json({ ok: false, error: "SAVE_FAILED" }, { status: 500, headers: noStore })
  }
}
