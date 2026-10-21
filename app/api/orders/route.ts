import { NextResponse } from "next/server"
import { ordersClient } from "@/sanity/orders/client"
import { isOrdersConfigured } from "@/sanity/orders/env"
import { getPaymentAccountById, getProducts } from "@/lib/data"
import { buildProductNumber } from "@/lib/product-number"
import { normalizeAndValidateLocalPhone } from "@/lib/phone"
import { getCurrentCustomer } from "@/lib/otp/session"
import { randomBytes } from "node:crypto"
import {
  initialPaymentStatus,
  isPaymentMethod,
  type PaymentAccountSnapshot,
  type PaymentMethod,
  type PaymentStatus,
} from "@/lib/payment"
import {
  PaymentProofConfigError,
  PaymentProofValidationError,
  prepareEncryptedPaymentProof,
} from "@/lib/payment-proof"

// POST Route Handler يُنفَّذ عند كل طلب بطبيعته ولا يدخل في كاش صفحات المتجر.
export const runtime = "nodejs"

// حدود بسيطة لمنع البيانات الضخمة/المشوّهة
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
    // إزالة أي وسم HTML كي تُحفظ كنص عادي فقط
    .replace(/<[^>]*>/g, " ")
    // توحيد نهايات الأسطر مع الحفاظ على فواصل الأسطر التي كتبها العميل
    .replace(/\r\n?/g, "\n")
    // منع أكثر من سطرين فارغين متتاليين
    .replace(/\n{3,}/g, "\n\n")
    // حذف محارف التحكم الخفية (ما عدا السطر الجديد والتاب)
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
  const digits = value.replace(/[^\d\u0660-\u0669\u06f0-\u06f9]/g, "")
  if (digits.length < 4) return false
  return /^[\d\u0660-\u0669\u06f0-\u06f9A-Za-z\-/ ]+$/.test(value)
}

export async function POST(req: Request) {
  // المصادقة إلزامية: لا يُنشأ أي طلب دون جلسة تسجيل دخول صالحة.
  // معرّف العميل يُقرأ من الجلسة على الخادم وحده، ولا يُقبل إطلاقاً من الواجهة.
  const sessionCustomer = await getCurrentCustomer()
  if (!sessionCustomer) {
    return fail("AUTH_REQUIRED", 401, "يجب تسجيل الدخول لإتمام الطلب.")
  }

  // يدعم multipart/form-data (بيانات + صورة) وJSON للتوافق مع أي استدعاء قديم.
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

  // تحقق أساسي: يجب وجود منتجات
  const rawItems: unknown[] = Array.isArray(body.items) ? body.items.slice(0, MAX_ITEMS) : []
  if (rawItems.length === 0) {
    return fail("EMPTY_ORDER", 400)
  }

  // العنوان اليدوي مطلوب (الاسم/الهاتف/المدينة/العنوان التفصيلي)
  const customerName = str(body.customerName, 200)
  const phone = str(body.phone, 30)
  const city = str(body.city, 120)
  const address = str(body.address, MAX_STR)
  if (!customerName || !phone || !city || !address) {
    return fail("ADDRESS_REQUIRED", 400)
  }

  // توحيد هاتف العميل إلى الصيغة المحلية (9 أرقام بلا كود دولة) والتحقق منه.
  // الخادم وحده يُنشئ هذه القيم — لا نثق بأي customerId أو رقم موحّد من الواجهة.
  const localPhone = normalizeAndValidateLocalPhone(phone)
  if (!localPhone) {
    return fail("INVALID_PHONE", 400)
  }

  // معرّف العميل الثابت (CUS_XXXX) يأتي من جلسة الخادم وحدها.
  // لا يعتمد على رقم الهاتف، فيبقى ثابتاً حتى بعد تغيير الرقم، وتُربط به كل الطلبات.
  const customerId = sessionCustomer.publicId

  // نوع مصدر العنوان: saved أو new فقط
  const addressSource = str(body.addressSource, 10)
  if (addressSource !== "saved" && addressSource !== "new") {
    return fail("INVALID_ADDRESS_SOURCE", 400)
  }

  // الإحداثيات مطلوبة — لا نحوّل المفقود إلى 0,0
  const lat = finiteNum(body.latitude)
  const lng = finiteNum(body.longitude)
  const capturedAt = str(body.locationCapturedAt, 60)
  if (lat === null || lng === null || !capturedAt) {
    return fail("LOCATION_REQUIRED", 400)
  }

  // صحة الإحداثيات ضمن النطاق الجغرافي
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

  // ============================================
  // الدفع — الخادم وحده يحدّد paymentStatus ويبني Snapshot الحساب.
  // كل ما يرسله العميل: طريقة الدفع، معرّف الحساب، اسم المرسل، رقم الحوالة، الصورة.
  // أي حالة دفع أو رقم حساب أو اسم مزوّد مرسل من العميل يُتجاهل تماماً.
  // ============================================
  const requestedMethod = str(body.paymentMethod, 40)
  // الطلبات القديمة/الاستدعاءات بلا طريقة دفع تُعالج كدفع عند الاستلام.
  const paymentMethod: PaymentMethod = isPaymentMethod(requestedMethod)
    ? requestedMethod
    : "cash_on_delivery"

  let paymentAccountSnapshot: PaymentAccountSnapshot | null = null
  let transferSenderName = ""
  let transferReference = ""

  if (paymentMethod === "manual_transfer") {
    const accountId = str(body.paymentAccountId, 120)
    if (!accountId) {
      return fail("PAYMENT_ACCOUNT_REQUIRED", 400, "اختر حساب دفع لإكمال التحويل.")
    }

    // نعيد جلب الحساب من مشروع المحتوى — لا نثق باسم الحساب أو رقمه المرسل من العميل.
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

    paymentAccountSnapshot = {
      sourceDocumentId: account.id,
      providerName: account.providerName,
      accountDisplayName: account.accountDisplayName || undefined,
      accountHolderName: account.accountHolderName,
      accountNumber: account.accountNumber,
      imageUrl: account.imageUrl || undefined,
    }
  }

  // رابط الخريطة يُبنى في الخادم — لا نثق برابط مرسل من الواجهة
  const locationLink = mapsUrl(lat, lng)

  // إن لم يُضبط مشروع الطلبات بعد: نسمح فقط بالدفع عند الاستلام دون حفظ،
  // ولا نسمح إطلاقاً بإرسال حوالة دون حفظ إثباتها مشفّرة.
  if (!isOrdersConfigured || !ordersClient) {
    if (paymentMethod === "manual_transfer") {
      return fail(
        "ORDERS_NOT_CONFIGURED",
        503,
        "خطأ في إعداد الموقع: لا يمكن استقبال الحوالات حالياً. الرجاء استخدام الدفع عند الاستلام.",
      )
    }
    return NextResponse.json({ ok: true, skipped: true, locationLink })
  }

  const client = ordersClient

  // تشفير إثبات الحوالة ورفعه كملف مبهم قبل إنشاء الطلب.
  let proofAssetId: string | null = null
  let paymentProofField: UnknownRecord | null = null

  if (paymentMethod === "manual_transfer" && proofFile) {
    try {
      const prepared = await prepareEncryptedPaymentProof(proofFile)
      const asset = await client.assets.upload("file", prepared.ciphertext, {
        filename: `payment-proof-${Date.now()}.enc`,
        contentType: "application/octet-stream",
      })
      proofAssetId = asset._id
      paymentProofField = {
        asset: { _type: "file", asset: { _type: "reference", _ref: asset._id } },
        iv: prepared.iv,
        authTag: prepared.authTag,
        keyVersion: prepared.keyVersion,
        originalMimeType: prepared.originalMimeType,
        processedMimeType: prepared.processedMimeType,
        byteSize: prepared.byteSize,
        uploadedAt: new Date().toISOString(),
      }
    } catch (error) {
      if (error instanceof PaymentProofConfigError) {
        // لا نطبع المفتاح ولا محتوى الصورة — فقط رسالة إعداد.
        return fail("PAYMENT_PROOF_NOT_CONFIGURED", 503, error.message)
      }
      if (error instanceof PaymentProofValidationError) {
        return fail("INVALID_PAYMENT_PROOF", 400, error.message)
      }
      console.error("[v0] payment proof processing failed")
      return fail(
        "PAYMENT_PROOF_FAILED",
        500,
        "تعذّر حفظ إثبات الحوالة. الرجاء المحاولة مرة أخرى.",
      )
    }
  }

  // فحص تكرار رقم الحوالة — تنبيه للإدارة وليس إثباتاً للدفع.
  let duplicateTransferReference = false
  if (paymentMethod === "manual_transfer" && transferReference) {
    try {
      const existing = await client.fetch<number>(
        `count(*[_type == "order" && transferReference == $ref])`,
        { ref: transferReference },
      )
      duplicateTransferReference = typeof existing === "number" && existing > 0
    } catch {
      // فشل الفحص لا يمنع الطلب — التحقق النهائي يدوي من الإدارة.
      duplicateTransferReference = false
    }
  }

  // لقطة بيانات المنتجات: استعلام واحد مُخزَّن مؤقتاً لكل المنتجات،
  // ثم بحث في الذاكرة — بلا استعلام منفصل لكل عنصر في السلة.
  // نستخدمه لحفظ رقم SKU وصورة المنتج داخل الطلب. لا نلمس الأسعار إطلاقاً.
  const productSnapshots = new Map<string, { sku?: string; image?: string }>()
  try {
    const products = await getProducts()
    for (const product of products) {
      productSnapshots.set(product.id, { sku: product.sku, image: product.image })
    }
  } catch {
    // فشل جلب المنتجات لا يمنع الطلب — يُحفظ العنصر بلقطة رقم المنتج فقط.
  }

  const items = rawItems.map((raw) => {
    const i: UnknownRecord = isRecord(raw) ? raw : {}
    const quantity = Math.max(1, Math.round(num(i.quantity)))
    const price = num(i.price)
    const productId = str(i.productId, 60)
    const snapshot = productSnapshots.get(productId)
    return {
      _type: "orderItem",
      _key: `${productId || "item"}-${str(i.size, 30)}-${str(i.color, 30)}-${Math.random()
        .toString(36)
        .slice(2, 8)}`,
      productId,
      // رقم المنتج يُشتق على الخادم ويُحفظ كلقطة ثابتة داخل الطلب،
      // فلا يتغير إذا عُدّل المنتج أو حُذف لاحقاً.
      productNumber: buildProductNumber(productId),
      sku: snapshot?.sku ?? "",
      image: snapshot?.image ?? "",
      name: str(i.name, 200),
      size: str(i.size, 60),
      color: str(i.color, 60),
      quantity,
      price,
      lineTotal: price * quantity,
    }
  })

  const now = new Date()
  // رقم الطلب مستقل تماماً عن رقم الهاتف: التاريخ + لاحقة عشوائية مشفّرة.
  // لا يحتوي أي جزء من الهاتف ولا من customerId.
  const orderNumber = `ORD-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(
    now.getDate(),
  ).padStart(2, "0")}-${randomBytes(4).toString("hex").toUpperCase()}`

  // الحالة الابتدائية يحدّدها الخادم وحده حسب طريقة الدفع.
  const paymentStatus: PaymentStatus = initialPaymentStatus(paymentMethod)

  const doc: { _type: "order" } & UnknownRecord = {
    _type: "order",
    orderNumber,
    // حالة الطلب مستقلة تماماً عن حالة الدفع.
    status: "new",
    customerName,
    phone,
    // حقول التتبع — كلها من إنشاء الخادم:
    // customerId يربط طلبات الهاتف نفسه، والرقم الموحّد يُستخدم في المطابقة.
    customerId,
    customerPhoneNormalized: localPhone,
    city,
    address,
    customerLocation: { _type: "geopoint", lat, lng },
    locationAccuracy: accuracy,
    locationCapturedAt: new Date(capturedTime).toISOString(),
    addressSource: addressSource === "saved" ? "عنوان محفوظ" : "عنوان جديد",
    items,
    shippingMethod: str(body.shippingMethod, 120),
    shippingPrice: num(body.shippingPrice),
    couponCode: str(body.couponCode, 60),
    discount: num(body.discount),
    subtotal: num(body.subtotal),
    total: num(body.total),
    currency: str(body.currency, 20),
    currencyCode: str(body.currencyCode, 20),
    createdAt: now.toISOString(),
    paymentMethod,
    paymentStatus,
    paymentStatusHistory: [
      {
        _type: "paymentStatusChange",
        _key: `init-${Math.random().toString(36).slice(2, 8)}`,
        status: paymentStatus,
        changedAt: now.toISOString(),
        changedBy: "النظام",
        note: "الحالة الابتدائية عند إنشاء الطلب",
      },
    ],
  }

  // ملاحظة العميل اختيارية — لا نضيف الحقل إطلاقاً عند غيابها.
  const customerNote = sanitizeCustomerNote(body.customerNote)
  if (customerNote) doc.customerNote = customerNote

  if (paymentMethod === "manual_transfer") {
    doc.paymentAccountSnapshot = paymentAccountSnapshot
    doc.transferSenderName = transferSenderName
    doc.transferReference = transferReference
    doc.transferSubmittedAt = now.toISOString()
    doc.duplicateTransferReference = duplicateTransferReference
    if (paymentProofField) doc.paymentProof = paymentProofField
  }

  try {
    const created = await client.create(doc)
    return NextResponse.json({
      ok: true,
      id: created._id,
      orderNumber,
      locationLink,
      // نرجع الدفع كنص للعرض فقط — بلا أي رابط أو بيانات فك تشفير.
      payment: {
        method: paymentMethod,
        status: paymentStatus,
        providerName: paymentAccountSnapshot?.providerName ?? null,
        transferSenderName: transferSenderName || null,
        transferReference: transferReference || null,
      },
    })
  } catch (error) {
    console.error("[v0] orders save failed:", error)
    // تنظيف الملف المشفّر غير المرتبط بأي طلب قدر الإمكان.
    if (proofAssetId) {
      try {
        await client.delete(proofAssetId)
      } catch {
        // نتجاهل فشل التنظيف — لا نكشف تفاصيل في السجلات.
      }
    }
    return fail("SAVE_FAILED", 500, "تعذّر حفظ الطلب. الرجاء المحاولة مرة أخرى.")
  }
}
