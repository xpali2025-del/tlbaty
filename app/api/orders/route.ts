import { NextResponse } from "next/server"
import { getCoupons, getCurrencySettings, getPaymentAccountById, getShippingZones } from "@/lib/data"
import { isDbConfigured } from "@/lib/db-cache"
import { getSiteConfig } from "@/lib/site-config"
import { isProofStorageConfigured } from "@/lib/env"
import { insertOrder, loadPricingProducts, OutOfStockError, ProofStorageError } from "@/lib/orders/create"
import { computeOrderPricing, priceChanged } from "@/lib/orders/pricing"
import { normalizeInternationalPhone } from "@/lib/phone"
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

function mapsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`
}

function fail(error: string, status: number, message?: string) {
  return NextResponse.json({ ok: false, error, ...(message ? { message } : {}) }, { status })
}

/** تحقّق اسم مرسل الحوالة على الخادم (لا نثق بتحقق الواجهة). */
function isValidSenderName(value: string): boolean {
  const trimmed = value.replace(/\s+/g, " ").trim()
  if (trimmed.length < 5 || trimmed.length > 80) return false
  if (trimmed.split(" ").filter((w) => w.length >= 2).length < 2) return false
  return /^[\p{L}\s'.\-]+$/u.test(trimmed)
}

/** تحقّق رقم الحوالة — يبقى نصاً ولا يُحوَّل إلى Number. */
function isValidTransferReference(value: string): boolean {
  if (value.length < 4 || value.length > 40) return false
  const digits = value.replace(/[^\d٠-٩۰-۹]/g, "")
  if (digits.length < 4) return false
  return /^[\d٠-٩۰-۹A-Za-z\-/ ]+$/.test(value)
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

  // ---- الموقع الجغرافي إلزامي وصالح ----
  const lat = finiteNum(body.latitude)
  const lng = finiteNum(body.longitude)
  const capturedAt = str(body.locationCapturedAt, 60)
  if (lat === null || lng === null || !capturedAt) {
    return fail("LOCATION_REQUIRED", 400)
  }
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
    return fail("INVALID_LOCATION", 400)
  }

  // ---- طريقة الدفع (افتراضياً الدفع عند الاستلام) ----
  const requestedMethod = str(body.paymentMethod, 40)
  // قيمة غير فارغة وغير معروفة تُرفض بدل أن تتحول بصمت إلى «الدفع عند الاستلام».
  if (requestedMethod && !isPaymentMethod(requestedMethod)) {
    return fail("INVALID_PAYMENT_METHOD", 400, "طريقة الدفع غير معروفة.")
  }
  const paymentMethod: PaymentMethod = isPaymentMethod(requestedMethod) ? requestedMethod : "cash_on_delivery"

  // طرق الدفع المفعّلة من لوحة الإدارة تُفرض هنا أيضاً (لا يكفي إخفاؤها في الواجهة).
  const { payments } = await getSiteConfig()
  if ((paymentMethod === "cash_on_delivery" && !payments.cashOnDelivery) || (paymentMethod === "manual_transfer" && !payments.manualTransfer)) {
    return fail("PAYMENT_METHOD_DISABLED", 400, "طريقة الدفع هذه غير متاحة حالياً. اختر طريقة دفع أخرى.")
  }

  let paymentAccountSnapshot: PaymentAccountSnapshot | null = null
  let transferSenderName = ""
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
    transferReference = str(body.transferReference, 40)
    if (!isValidTransferReference(transferReference)) {
      return fail("INVALID_TRANSFER_REFERENCE", 400, "رقم الحوالة غير صالح.")
    }
    if (!proofFile) {
      return fail("PAYMENT_PROOF_REQUIRED", 400, "صورة إثبات الحوالة مطلوبة.")
    }

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

  const locationLink = mapsUrl(lat, lng)

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
    return NextResponse.json({ ok: true, skipped: true, locationLink })
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
    getCoupons(),
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

  const clientTotals = {
    total: num(body.total),
    subtotal: num(body.subtotal),
    shippingPrice: num(body.shippingPrice),
    discount: num(body.discount),
  }

  try {
    const created = await insertOrder({
      customer: { id: sessionCustomer.id },
      contact: {
        customerName,
        phone,
        phoneNormalized,
        city,
        address,
        addressSource,
        latitude: lat,
        longitude: lng,
        accuracy,
        capturedAt: new Date(capturedTime),
        note: sanitizeCustomerNote(body.customerNote),
      },
      pricing,
      payment: {
        method: paymentMethod,
        account: paymentAccountSnapshot,
        senderName: transferSenderName,
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
        transferReference: transferReference || null,
      },
    })
  } catch (error) {
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
