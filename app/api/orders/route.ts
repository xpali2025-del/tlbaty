import { NextResponse } from "next/server"
import { getCouponsForCustomer, getCurrencySettings, getPaymentAccountById, getShippingZones } from "@/lib/data"
import { isDbConfigured } from "@/lib/db-cache"
import { getSiteConfig } from "@/lib/site-config"
import { isProofStorageConfigured } from "@/lib/env"
import { CouponUnavailableError, findOrderByIdempotencyKey, insertOrder, loadPricingProducts, OutOfStockError, parseIdempotencyKey, ProofStorageError } from "@/lib/orders/create"
import { computeOrderPricing, priceChanged } from "@/lib/orders/pricing"
import { normalizeInternationalPhone, normalizeSenderPhone } from "@/lib/phone"
import { isValidSenderName, isValidTransferReference } from "@/lib/payment-input"
import { getCurrentCustomer } from "@/lib/otp/session"
import {
  isPaymentMethod,
  type PaymentAccountSnapshot,
  type PaymentMethod,
} from "@/lib/payment"
import {
  PaymentProofConfigError,
  PaymentProofValidationError,
  prepareEncryptedPaymentProof,
  type PaymentProofPayload,
} from "@/lib/payment-proof"
import { WalletError } from "@/lib/wallet/rules"

export const runtime = "nodejs"

const MAX_ITEMS = 100
const MAX_STR = 500
const MAX_CUSTOMER_NOTE = 1000

/**
 * ملاحظة العميل: نص عادي اختياري.
 * نحذف المسافات الزائدة، ونجرّدها من أي وسوم HTML، ونمنع تجاوز الحد الأقصى.
 */
function sanitizeCustomerNote(value: unknown): string {
  if (typeof value !== "string") return ""
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()
    .slice(0, MAX_CUSTOMER_NOTE)
}

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null
}

function str(value: unknown, max = MAX_STR): string {
  if (typeof value !== "string") return ""
  return value.trim().slice(0, max)
}

function num(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value)
  return Number.isFinite(n) ? n : 0
}

/** رقم منتهٍ صالح فقط (لا نحوّل المفقود إلى صفر افتراضي للإحداثيات). */
function finiteNum(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN
  return Number.isFinite(n) ? n : null
}

type ParsedLocation =
  | { ok: true; lat: number; lng: number; accuracy: number; capturedAt: Date }
  | { ok: false; error: "LOCATION_REQUIRED" | "INVALID_LOCATION" }

function parseLocation(body: Record<string, unknown>): ParsedLocation {
  const lat = finiteNum(body.latitude)
  const lng = finiteNum(body.longitude)
  const capturedAt = str(body.locationCapturedAt, 60)
  if (lat === null || lng === null || !capturedAt) return { ok: false, error: "LOCATION_REQUIRED" }
  const accuracy = finiteNum(body.locationAccuracy)
  const capturedTime = Date.parse(capturedAt)
  if (
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180 ||
    (lat === 0 && lng === 0) ||
    accuracy === null ||
    accuracy < 0 ||
    Number.isNaN(capturedTime)
  ) {
    return { ok: false, error: "INVALID_LOCATION" }
  }
  return { ok: true, lat, lng, accuracy, capturedAt: new Date(capturedTime) }
}

function mapsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`
}

function fail(error: string, status: number, message?: string) {
  return NextResponse.json({ ok: false, error, ...(message ? { message } : {}) }, { status })
}

export async function POST(req: Request) {
  // الطلب يتطلب تسجيل دخول؛ هوية العميل تأتي من الجلسة على الخادم وحدها.
  const sessionCustomer = await getCurrentCustomer()
  if (!sessionCustomer) {
    return fail("AUTH_REQUIRED", 401, "يجب تسجيل الدخول لإتمام الطلب.")
  }

  // ---- قراءة الجسم: JSON أو multipart (الطلب + صورة إثبات الحوالة) ----
  let body: UnknownRecord
  let proofFile: File | null = null
  const contentType = req.headers.get("content-type") ?? ""

  if (contentType.includes("multipart/form-data")) {
    try {
      const form = await req.formData()
      const raw = form.get("order")
      const parsed: unknown = typeof raw === "string" ? JSON.parse(raw) : null
      if (!isRecord(parsed)) return fail("INVALID_JSON", 400)
      body = parsed
      const file = form.get("paymentProof")
      proofFile = file instanceof File && file.size > 0 ? file : null
    } catch {
      return fail("INVALID_JSON", 400)
    }
  } else {
    try {
      const parsed: unknown = await req.json()
      if (!isRecord(parsed)) return fail("INVALID_JSON", 400)
      body = parsed
    } catch {
      return fail("INVALID_JSON", 400)
    }
  }

  // إعادة محاولة بنفس مفتاح الطلب (انقطاع اتصال، أو إعادة تسجيل دخول أثناء الدفع): نعيد الطلب المحفوظ
  // نفسه ولا ننشئ آخر ولا نخصم المخزون مرة ثانية.
  const idempotencyKey = parseIdempotencyKey(body.clientOrderKey)
  if (idempotencyKey) {
    const existing = await findOrderByIdempotencyKey(sessionCustomer.id, idempotencyKey)
    if (existing) {
      return NextResponse.json({
        ok: true,
        duplicate: true,
        id: existing.id,
        orderNumber: existing.orderNumber,
        total: existing.total,
        currencyCode: existing.currencyCode,
        priceChanged: false,
        payment: { method: existing.paymentMethod, status: existing.paymentStatus },
      })
    }
  }

  const rawItems: unknown[] = Array.isArray(body.items) ? body.items.slice(0, MAX_ITEMS) : []
  if (rawItems.length === 0) {
    return fail("EMPTY_ORDER", 400)
  }

  const customerName = str(body.customerName, 200)
  const phone = str(body.phone, 30)
  const city = str(body.city, 120)
  const address = str(body.address, MAX_STR)
  if (!customerName || !phone || !city || !address) {
    return fail("ADDRESS_REQUIRED", 400)
  }

  const phoneNormalized = normalizeInternationalPhone(phone)
  if (!phoneNormalized) {
    return fail("INVALID_PHONE", 400)
  }

  const addressSource = str(body.addressSource, 10)
  if (addressSource !== "saved" && addressSource !== "new") {
    return fail("INVALID_ADDRESS_SOURCE", 400)
  }

  // ---- الموقع الجغرافي: يُفحص هنا ويُفرض بعد التسعير، لأن «الاستلام من المتجر» معفى منه ----
  const parsedLocation = parseLocation(body)

  // ---- طريقة الدفع (افتراضياً الدفع عند الاستلام) ----
  const requestedMethod = str(body.paymentMethod, 40)
  // قيمة غير فارغة وغير معروفة تُرفض بدل أن تتحول بصمت إلى «الدفع عند الاستلام».
  if (requestedMethod && !isPaymentMethod(requestedMethod)) {
    return fail("INVALID_PAYMENT_METHOD", 400, "طريقة الدفع غير معروفة.")
  }
  const paymentMethod: PaymentMethod = isPaymentMethod(requestedMethod) ? requestedMethod : "cash_on_delivery"

  // طرق الدفع المفعّلة من لوحة الإدارة تُفرض هنا أيضاً (لا يكفي إخفاؤها في الواجهة).
  const { payments } = await getSiteConfig()
  if ((paymentMethod === "cash_on_delivery" && !payments.cashOnDelivery) || (paymentMethod === "manual_transfer" && !payments.manualTransfer) || (paymentMethod === "wallet" && !payments.wallet)) {
    return fail("PAYMENT_METHOD_DISABLED", 400, "طريقة الدفع هذه غير متاحة حالياً. اختر طريقة دفع أخرى.")
  }

  let paymentAccountSnapshot: PaymentAccountSnapshot | null = null
  let transferSenderName = ""
  let transferSenderPhone = ""
  let transferReference = ""

  if (paymentMethod === "manual_transfer") {
    const accountId = str(body.paymentAccountId, 120)
    if (!accountId) {
      return fail("PAYMENT_ACCOUNT_REQUIRED", 400, "اختر حساب دفع لإكمال التحويل.")
    }
    const account = await getPaymentAccountById(accountId)
    if (!account || !account.isActive || !account.accountNumber) {
      return fail(
        "PAYMENT_ACCOUNT_UNAVAILABLE",
        400,
        "حساب الدفع المختار غير متاح حالياً. اختر حساباً آخر أو استخدم الدفع عند الاستلام.",
      )
    }

    transferSenderName = str(body.transferSenderName, 80).replace(/\s+/g, " ")
    if (!isValidSenderName(transferSenderName)) {
      return fail("INVALID_TRANSFER_SENDER", 400, "اسم مرسل الحوالة غير صالح.")
    }
    const senderPhone = normalizeSenderPhone(body.transferSenderPhone)
    if (!senderPhone) {
      return fail("INVALID_TRANSFER_SENDER_PHONE", 400, "رقم هاتف مرسل الحوالة غير صالح.")
    }
    transferSenderPhone = senderPhone
    transferReference = str(body.transferReference, 40)
    if (!isValidTransferReference(transferReference)) {
      return fail("INVALID_TRANSFER_REFERENCE", 400, "رقم الحوالة غير صالح.")
    }
    // صورة الإثبات اختيارية؛ الإلزامي: حساب الدفع واسم المرسل ورقم هاتفه ورقم الحوالة (تُفحص أعلاه)، والإدارة تطابقها يدوياً.

    // Snapshot موثوق من الخادم: لا نقبل أي بيانات حساب من العميل.
    paymentAccountSnapshot = {
      sourceDocumentId: account.id,
      providerName: account.providerName,
      accountDisplayName: account.accountDisplayName || undefined,
      accountHolderName: account.accountHolderName,
      accountNumber: account.accountNumber,
      imageUrl: account.imageUrl || undefined,
    }
  }


  // ---- قاعدة البيانات غير مضبوطة (تطوير محلي) ----
  if (!isDbConfigured()) {
    if (paymentMethod === "manual_transfer") {
      // لا نقبل حوالة بلا قدرة على حفظ إثباتها.
      return fail(
        "ORDERS_NOT_CONFIGURED",
        503,
        "خطأ في إعداد الموقع: لا يمكن استقبال الحوالات حالياً. الرجاء استخدام الدفع عند الاستلام.",
      )
    }
    return NextResponse.json({ ok: true, skipped: true, locationLink: parsedLocation.ok ? mapsUrl(parsedLocation.lat, parsedLocation.lng) : null })
  }

  // ---- التسعير من قاعدة البيانات: لا نثق بأي سعر أو مجموع أرسله المتصفح ----
  const requestedItems = rawItems.map((raw) => {
    const i: UnknownRecord = isRecord(raw) ? raw : {}
    return {
      productId: str(i.productId, 60),
      size: str(i.size, 60),
      color: str(i.color, 60),
      quantity: Math.max(1, Math.round(num(i.quantity))),
    }
  })
  const [products, zones, coupons, currencySettings] = await Promise.all([
    loadPricingProducts([...new Set(requestedItems.map((i) => i.productId).filter(Boolean))]),
    getShippingZones(),
    getCouponsForCustomer(sessionCustomer.id),
    getCurrencySettings(),
  ])
  const pricing = computeOrderPricing({
    items: requestedItems,
    products,
    zones,
    city,
    shippingMethodName: str(body.shippingMethod, 120),
    coupons,
    couponCode: str(body.couponCode, 60),
    currencies: currencySettings.currencies,
    defaultCurrencyCode: currencySettings.defaultCode,
    currencyCode: str(body.currencyCode, 20),
  })
  if (!pricing.ok) {
    if (pricing.error === "UNKNOWN_PRODUCT") {
      return fail("PRODUCT_UNAVAILABLE", 400, "أحد المنتجات في سلتك لم يعد متوفراً. حدّث السلة وحاول مجدداً.")
    }
    if (pricing.error === "INVALID_QUANTITY") {
      return fail("INVALID_QUANTITY", 400, "كمية أحد المنتجات غير صالحة.")
    }
    return fail("INVALID_SHIPPING_METHOD", 400, "طريقة التوصيل المختارة غير متاحة لهذه المدينة. اختر طريقة أخرى.")
  }

  // الموقع إلزامي لكل طريقة توصيل ما عدا الاستلام من المتجر (يُهمل موقعه إن أُرسل ولا يُحفظ).
  if (!pricing.pickup && !parsedLocation.ok) {
    return fail(parsedLocation.error, 400)
  }
  const location = pricing.pickup || !parsedLocation.ok ? null : parsedLocation
  const locationLink = location ? mapsUrl(location.lat, location.lng) : null

  // ---- إثبات الحوالة: فحص + تشفير على الخادم ثم رفعه إلى الـ bucket الخاص ----
  let proof: PaymentProofPayload | null = null
  if (paymentMethod === "manual_transfer" && proofFile) {
    if (!isProofStorageConfigured()) {
      return fail(
        "PAYMENT_PROOF_NOT_CONFIGURED",
        503,
        "خطأ في إعداد الموقع: تخزين إثبات الحوالة غير مضبوط. لا يمكن استقبال الحوالات حالياً، ويمكنك استخدام الدفع عند الاستلام.",
      )
    }
    try {
      proof = await prepareEncryptedPaymentProof(proofFile)
    } catch (error) {
      if (error instanceof PaymentProofConfigError) {
        return fail("PAYMENT_PROOF_NOT_CONFIGURED", 503, error.message)
      }
      if (error instanceof PaymentProofValidationError) {
        return fail("INVALID_PAYMENT_PROOF", 400, error.message)
      }
      console.error("payment proof processing failed")
      return fail("PAYMENT_PROOF_FAILED", 500, "تعذّر حفظ إثبات الحوالة. الرجاء المحاولة مرة أخرى.")
    }
  }

  if (paymentMethod === "wallet" && pricing.base.total <= 0) {
    return fail("INVALID_PAYMENT_METHOD", 400, "الدفع من الرصيد غير متاح لهذا الطلب.")
  }

  const clientTotals = {
    total: num(body.total),
    subtotal: num(body.subtotal),
    shippingPrice: num(body.shippingPrice),
    discount: num(body.discount),
  }

  try {
    const created = await insertOrder({
      customer: { id: sessionCustomer.id },
      idempotencyKey,
      contact: {
        customerName,
        phone,
        phoneNormalized,
        city,
        address,
        addressSource,
        latitude: location?.lat ?? null,
        longitude: location?.lng ?? null,
        accuracy: location?.accuracy ?? null,
        capturedAt: location?.capturedAt ?? null,
        note: sanitizeCustomerNote(body.customerNote),
      },
      pricing,
      payment: {
        method: paymentMethod,
        account: paymentAccountSnapshot,
        senderName: transferSenderName,
        senderPhone: transferSenderPhone,
        reference: transferReference,
        proof,
      },
    })

    return NextResponse.json({
      ok: true,
      id: created.id,
      orderNumber: created.orderNumber,
      locationLink,
      // الإجمالي المعتمد من الخادم؛ priceChanged تعني أنه يختلف عمّا رآه العميل.
      total: pricing.total,
      currencyCode: pricing.currency.code,
      priceChanged: priceChanged(pricing, clientTotals),
      payment: {
        method: paymentMethod,
        status: created.paymentStatus,
        providerName: paymentAccountSnapshot?.providerName ?? null,
        transferSenderName: transferSenderName || null,
        transferSenderPhone: transferSenderPhone || null,
        transferReference: transferReference || null,
      },
    })
  } catch (error) {
    if (error instanceof WalletError) {
      // الرصيد/التجميد/التهدئة/السقف: رسالة واضحة، والطلب والمخزون تراجعا كاملين.
      return fail(`WALLET_${error.code}`, error.code === "INSUFFICIENT" ? 402 : 403, error.message)
    }
    if (error instanceof CouponUnavailableError) {
      return fail("COUPON_UNAVAILABLE", 409, "كود الخصم لم يعد صالحاً (استُعمل أو انتهت مدته). أزله من الطلب وحاول مجدداً.")
    }
    if (error instanceof OutOfStockError) {
      return fail("OUT_OF_STOCK", 409, `الكمية المطلوبة من "${error.productName}" غير متوفرة حالياً. عدّل الكمية أو أزل المنتج من السلة.`)
    }
    console.error("orders save failed:", error instanceof Error ? error.message : "unknown")
    if (error instanceof ProofStorageError) {
      return fail("PAYMENT_PROOF_FAILED", 500, "تعذّر حفظ إثبات الحوالة. الرجاء المحاولة مرة أخرى.")
    }
    return fail("SAVE_FAILED", 500, "تعذّر حفظ الطلب. الرجاء المحاولة مرة أخرى.")
  }
}
