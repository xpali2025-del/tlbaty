import { NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { db } from "@/lib/db/client"
import { customers } from "@/lib/db/store"
import { resolveSession } from "@/lib/otp/session"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const noStore = { "Cache-Control": "no-store" }

/**
 * POST /api/account/marketing { optIn: boolean } — موافقة العميل على استلام العروض والتذكيرات (مغلقة افتراضياً).
 * الهوية من الجلسة وحدها، والتغيير لا يصدر إلا من العميل نفسه (لا مسار إداري يفعّلها نيابةً عنه).
 */
export async function POST(req: Request) {
  // حماية CSRF إضافية فوق SameSite: إن وُجد Origin فيجب أن يطابق المضيف.
  const origin = req.headers.get("origin")
  if (origin) {
    try {
      if (new URL(origin).host !== (req.headers.get("host") ?? "")) return NextResponse.json({ ok: false, error: "BAD_ORIGIN" }, { status: 403, headers: noStore })
    } catch {
      return NextResponse.json({ ok: false, error: "BAD_ORIGIN" }, { status: 403, headers: noStore })
    }
  }
  const resolved = await resolveSession().catch(() => null)
  if (!resolved) return NextResponse.json({ ok: false, error: "AUTH_REQUIRED" }, { status: 401, headers: noStore })

  let optIn: unknown
  try {
    optIn = ((await req.json()) as { optIn?: unknown }).optIn
  } catch {
    return NextResponse.json({ ok: false, error: "INVALID_JSON" }, { status: 400, headers: noStore })
  }
  if (typeof optIn !== "boolean") return NextResponse.json({ ok: false, error: "INVALID_VALUE" }, { status: 400, headers: noStore })

  await db.update(customers).set({ marketingOptIn: optIn, marketingOptInUpdatedAt: new Date() }).where(eq(customers.id, resolved.customer.id))
  return NextResponse.json({ ok: true, optIn }, { headers: noStore })
}
