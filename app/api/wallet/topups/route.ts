import { NextResponse } from "next/server"
import { getCurrencySettings, getPaymentAccountById } from "@/lib/data"
import { isDbConfigured } from "@/lib/db-cache"
import { getClientContext } from "@/lib/otp/request-context"
import { getCurrentCustomer } from "@/lib/otp/session"
import { isValidSenderName, isValidTransferReference } from "@/lib/payment-input"
import { normalizeSenderPhone } from "@/lib/phone"
import { getSiteConfig } from "@/lib/site-config"
import { requestTopup } from "@/lib/wallet/topups"
import { WalletError, parseAmount } from "@/lib/wallet/rules"

export const runtime = "nodejs"

const fail = (error: string, status: number, message?: string) => NextResponse.json({ ok: false, error, ...(message ? { message } : {}) }, { status })
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "")

/** طلب شحن رصيد: حوالة بانتظار مراجعة الإدارة. الهوية من الجلسة والمبالغ والحساب تُتحقق على الخادم. */
export async function POST(req: Request) {
  // حماية CSRF إضافية فوق SameSite: إن وُجد Origin فيجب أن يطابق المضيف.
  const origin = req.headers.get("origin")
  if (origin) {
    try {
      if (new URL(origin).host !== (req.headers.get("host") ?? "")) return fail("BAD_ORIGIN", 403)
    } catch {
      return fail("BAD_ORIGIN", 403)
    }
  }
  const customer = await getCurrentCustomer()
  if (!customer) return fail("AUTH_REQUIRED", 401, "يجب تسجيل الدخول.")
  if (!isDbConfigured()) return fail("NOT_CONFIGURED", 503)
  const { payments } = await getSiteConfig()
  if (!payments.wallet) return fail("DISABLED", 403, "خدمة الرصيد غير متاحة حالياً.")

  let body: Record<string, unknown>
  try {
    const parsed: unknown = await req.json()
    if (typeof parsed !== "object" || parsed === null) return fail("INVALID_JSON", 400)
    body = parsed as Record<string, unknown>
  } catch {
    return fail("INVALID_JSON", 400)
  }

  const amount = parseAmount(body.amount)
  if (amount === null) return fail("INVALID_AMOUNT", 400, "أدخل مبلغاً صحيحاً.")
  const { currencies } = await getCurrencySettings()
  const currency = currencies.find((c) => c.code === text(body.currencyCode, 20))
  if (!currency) return fail("INVALID_CURRENCY", 400, "العملة غير معروفة.")

  const accountId = text(body.paymentAccountId, 120)
  const account = accountId ? await getPaymentAccountById(accountId) : null
  if (!account || !account.isActive || !account.accountNumber) return fail("PAYMENT_ACCOUNT_UNAVAILABLE", 400, "حساب الدفع المختار غير متاح. اختر حساباً آخر.")

  const senderName = text(body.senderName, 80).replace(/\s+/g, " ")
  if (!isValidSenderName(senderName)) return fail("INVALID_TRANSFER_SENDER", 400, "اسم مرسل الحوالة غير صالح.")
  const senderPhone = normalizeSenderPhone(body.senderPhone)
  if (!senderPhone) return fail("INVALID_TRANSFER_SENDER_PHONE", 400, "رقم هاتف مرسل الحوالة غير صالح.")
  const reference = text(body.reference, 40)
  if (!isValidTransferReference(reference)) return fail("INVALID_TRANSFER_REFERENCE", 400, "رقم الحوالة غير صالح.")

  try {
    const { id } = await requestTopup({
      customerId: customer.id,
      amount,
      currency: { code: currency.code, rate: currency.rate },
      account: {
        sourceDocumentId: account.id,
        providerName: account.providerName,
        accountDisplayName: account.accountDisplayName || undefined,
        accountHolderName: account.accountHolderName,
        accountNumber: account.accountNumber,
      },
      senderName,
      senderPhone,
      reference,
      ip: getClientContext(req).ip,
    })
    return NextResponse.json({ ok: true, id })
  } catch (e) {
    if (e instanceof WalletError) return fail(`WALLET_${e.code}`, e.code === "INVALID" ? 400 : 409, e.message)
    console.error("wallet topup failed:", e instanceof Error ? e.message : "unknown")
    return fail("SAVE_FAILED", 500, "تعذّر إرسال الطلب. حاول مجدداً.")
  }
}
