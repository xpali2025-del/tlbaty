import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { CheckoutClient } from "@/components/checkout-client"
import { getCouponsForCustomer, getShippingZones, getPaymentAccounts } from "@/lib/data"
import { isPaymentProofEncryptionReady } from "@/lib/payment-proof"
import { getCurrentCustomer } from "@/lib/otp/session"

export const metadata: Metadata = {
  title: "إتمام الطلب",
  description: "أكمل طلبك من متجر تاج لاين بسهولة وأمان.",
  robots: { index: false, follow: true },
}

// إتمام الطلب محمي: لا يُسمح بالوصول إلا لعميل مسجّل الدخول عبر OTP.
// الجلسة تُقرأ من الخادم فقط، ويُعاد غير المصادق إلى /login مع مسار العودة.
export const dynamic = "force-dynamic"

// On-Demand Revalidation: أكواد الخصم وحسابات الدفع تُحدَّث فوراً
// عبر إجراءات لوحة الإدارة (revalidateStore في lib/manage-helpers.ts)

export default async function CheckoutPage() {
  const customer = await getCurrentCustomer()
  if (!customer) {
    redirect("/login?next=/checkout")
  }

  const [coupons, shippingZones, paymentAccounts] = await Promise.all([
    getCouponsForCustomer(customer.id),
    getShippingZones(),
    getPaymentAccounts(),
  ])

  return (
    <CheckoutClient
      coupons={coupons}
      shippingZones={shippingZones}
      paymentAccounts={paymentAccounts}
      // مجرد إشارة boolean — المفتاح نفسه لا يصل إلى المتصفح إطلاقاً.
      paymentProofReady={isPaymentProofEncryptionReady()}
    />
  )
}
