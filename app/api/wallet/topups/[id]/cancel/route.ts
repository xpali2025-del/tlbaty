import { NextResponse } from "next/server"
import { getCurrentCustomer } from "@/lib/otp/session"
import { cancelTopup } from "@/lib/wallet/topups"
import { WalletError } from "@/lib/wallet/rules"

export const runtime = "nodejs"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const origin = req.headers.get("origin")
  if (origin) {
    try {
      if (new URL(origin).host !== (req.headers.get("host") ?? "")) return NextResponse.json({ ok: false, error: "BAD_ORIGIN" }, { status: 403 })
    } catch {
      return NextResponse.json({ ok: false, error: "BAD_ORIGIN" }, { status: 403 })
    }
  }
  const customer = await getCurrentCustomer()
  if (!customer) return NextResponse.json({ ok: false, error: "AUTH_REQUIRED" }, { status: 401 })
  const { id } = await ctx.params
  if (!UUID.test(id)) return NextResponse.json({ ok: false, error: "INVALID_ID" }, { status: 400 })
  try {
    await cancelTopup(customer.id, id)
    return NextResponse.json({ ok: true })
  } catch (e) {
    if (e instanceof WalletError) return NextResponse.json({ ok: false, error: e.code, message: e.message }, { status: 409 })
    return NextResponse.json({ ok: false, error: "FAILED" }, { status: 500 })
  }
}
