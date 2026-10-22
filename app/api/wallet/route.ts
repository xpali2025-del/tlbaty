import { NextResponse } from "next/server"
import { getCurrentCustomer } from "@/lib/otp/session"
import { getBalance } from "@/lib/wallet/customer"
import { getSiteConfig } from "@/lib/site-config"
import { isDbConfigured } from "@/lib/db-cache"

export const runtime = "nodejs"

/** رصيد العميل الحالي من الجلسة وحدها (لا يُقبل معرّف من المتصفح). */
export async function GET() {
  const customer = await getCurrentCustomer()
  if (!customer) return NextResponse.json({ ok: false, error: "AUTH_REQUIRED" }, { status: 401 })
  if (!isDbConfigured()) return NextResponse.json({ ok: false, error: "NOT_CONFIGURED" }, { status: 503 })
  const { payments } = await getSiteConfig()
  if (!payments.wallet) return NextResponse.json({ ok: false, error: "DISABLED" }, { status: 404 })
  const { balance, frozen } = await getBalance(customer.id)
  return NextResponse.json({ ok: true, balance, frozen }, { headers: { "Cache-Control": "no-store" } })
}
