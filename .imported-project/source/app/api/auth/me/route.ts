import { NextResponse } from "next/server"
import { resolveSession, touchSession } from "@/lib/otp/session"
import { countOrdersByCustomerId } from "@/lib/otp/store"
import { maskLocalPhone } from "@/lib/phone"

export const runtime = "nodejs"

/**
 * بيانات العميل الحالي — من الجلسة على الخادم فقط.
 * لا يُقبل أي customerId من العميل إطلاقاً؛ القيمة تُشتق من الكوكي الموقّع.
 */
export async function GET() {
  const resolved = await resolveSession().catch(() => null)
  if (!resolved) {
    return NextResponse.json({ authenticated: false }, { status: 200 })
  }

  const { customer, sessionDocId } = resolved
  // تحديث آخر نشاط دون تعطيل الرد.
  void touchSession(sessionDocId)

  let ordersCount = 0
  try {
    ordersCount = await countOrdersByCustomerId(customer.customerId)
  } catch {
    ordersCount = 0
  }

  return NextResponse.json({
    authenticated: true,
    customer: {
      customerId: customer.customerId,
      phone: customer.phone ?? "",
      phoneMasked: customer.phone ? maskLocalPhone(customer.phone) : "",
      createdAt: customer.createdAt ?? null,
      lastLogin: customer.lastLogin ?? null,
      ordersCount,
    },
  })
}
