import { NextResponse } from "next/server"
import { resolveSession, touchSession } from "@/lib/otp/session"
import { countOrdersForCustomer } from "@/lib/otp/customer-orders"
import { maskPhone } from "@/lib/phone"

export const runtime = "nodejs"

/** بيانات العميل الحالي من الجلسة على الخادم فقط؛ لا يُقبل أي معرّف من العميل. */
export async function GET() {
  const resolved = await resolveSession().catch(() => null)
  if (!resolved) return NextResponse.json({ authenticated: false }, { status: 200 })

  const { customer, sessionId } = resolved
  void touchSession(sessionId)
  const ordersCount = await countOrdersForCustomer(customer).catch(() => 0)

  return NextResponse.json({
    authenticated: true,
    customer: {
      customerId: customer.publicId,
      phone: customer.phone,
      phoneMasked: maskPhone(customer.phone),
      createdAt: customer.createdAt,
      lastLogin: customer.lastLoginAt,
      ordersCount,
    },
  })
}
