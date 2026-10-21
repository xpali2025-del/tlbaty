import { NextResponse } from "next/server"
import { resolveSession, touchSession } from "@/lib/otp/session"
import { countOrdersByCustomerId } from "@/lib/otp/store"
import { maskLocalPhone } from "@/lib/phone"

export const runtime = "nodejs"

/** بيانات العميل الحالي من الجلسة على الخادم فقط؛ لا يُقبل أي معرّف من العميل. */
export async function GET() {
  const resolved = await resolveSession().catch(() => null)
  if (!resolved) return NextResponse.json({ authenticated: false }, { status: 200 })

  const { customer, sessionId } = resolved
  void touchSession(sessionId)
  const ordersCount = await countOrdersByCustomerId(customer.id).catch(() => 0)

  return NextResponse.json({
    authenticated: true,
    customer: {
      customerId: customer.publicId,
      phone: customer.phone,
      phoneMasked: maskLocalPhone(customer.phone),
      createdAt: customer.createdAt,
      lastLogin: customer.lastLoginAt,
      ordersCount,
    },
  })
}
