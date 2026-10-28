import "server-only"
import { randomBytes, randomUUID } from "node:crypto"
import { revalidateTag } from "next/cache"
import { and, count, eq, gte, inArray, sql } from "drizzle-orm"
import { db } from "@/lib/db/client"
import { orderItems, orderPaymentProofs, orderPaymentStatusHistory, orders, products } from "@/lib/db/store"
import { resolveImageUrl } from "@/lib/images"
import { buildProductNumber } from "@/lib/product-number"
import { initialPaymentStatus, type PaymentAccountSnapshot, type PaymentMethod, type PaymentStatus } from "@/lib/payment"
import type { PaymentProofPayload } from "@/lib/payment-proof"
import { deletePaymentProof, newProofKey, putPaymentProof } from "@/lib/storage/proofs"
import { CACHE_TAGS, productTag } from "@/lib/cache-tags"
import { uniqueViolation } from "@/lib/manage-helpers"
import { auditBlocked, chargeOrder } from "@/lib/wallet/ledger"
import { redeemCoupon } from "./coupons"
import { deductVariantStock, OutOfStockError, syncProductStock } from "./variants"
import type { PricingProduct, PricingResult } from "./pricing"

export class ProofStorageError extends Error {}

export { OutOfStockError }
export { CouponUnavailableError } from "./coupons"

/** المنتجات بالسعر الحالي من قاعدة البيانات مباشرة (بلا كاش) — مصدر السعر الوحيد للطلب. */
export async function loadPricingProducts(productNumbers: string[]): Promise<Map<string, PricingProduct>> {
  if (productNumbers.length === 0) return new Map()
  const rows = await db
    .select({
      id: products.productNumber,
      name: products.name,
      price: products.price,
      sku: products.sku,
      mainImageKey: products.mainImageKey,
    })
    .from(products)
    .where(inArray(products.productNumber, productNumbers))
  return new Map(
    rows.map((r) => [
      r.id,
      { id: r.id, name: r.name, price: r.price, sku: r.sku ?? undefined, image: r.mainImageKey ? resolveImageUrl(r.mainImageKey) : "" },
    ]),
  )
}

export type NewOrder = {
  customer: { id: string }
  /** مفتاح محاولة الدفع من المتصفح؛ نفس المفتاح = نفس الطلب (لا يتكرر عند إعادة المحاولة). */
  idempotencyKey?: string | null
  contact: {
    customerName: string
    /** كما كتبه العميل. */
    phone: string
    /** الصيغة الدولية الموحّدة. */
    phoneNormalized: string
    city: string
    address: string
    addressSource: "saved" | "new"
    /** الموقع الجغرافي؛ null للاستلام من المتجر فقط. */
    latitude: number | null
    longitude: number | null
    accuracy: number | null
    capturedAt: Date | null
    note: string
  }
  pricing: Extract<PricingResult, { ok: true }>
  payment: {
    method: PaymentMethod
    account: PaymentAccountSnapshot | null
    senderName: string
    senderPhone: string
    reference: string
    proof: PaymentProofPayload | null
  }
}

export type CreatedOrder = { id: string; orderNumber: string; paymentStatus: PaymentStatus; duplicate?: boolean }

/** مفتاح صالح: 16–64 حرفاً من [A-Za-z0-9_-] (UUID مثلاً). غيره يُهمل. */
export function parseIdempotencyKey(value: unknown): string | null {
  return typeof value === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(value) ? value : null
}

/** الطلب الذي حُفظ سابقاً بنفس المفتاح لنفس العميل (إن وُجد). */
export async function findOrderByIdempotencyKey(customerId: string, key: string) {
  const [row] = await db
    .select({ id: orders.id, orderNumber: orders.orderNumber, paymentStatus: orders.paymentStatus, total: orders.total, currencyCode: orders.currencyCode, paymentMethod: orders.paymentMethod })
    .from(orders)
    .where(and(eq(orders.customerId, customerId), eq(orders.idempotencyKey, key)))
    .limit(1)
  return row ?? null
}

function makeOrderNumber(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `ORD-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${randomBytes(4).toString("hex").toUpperCase()}`
}

/**
 * يحفظ الطلب وبنوده وإثباته وسجل حالة الدفع الابتدائي في معاملة واحدة.
 * ملف الإثبات المشفَّر يُرفع أولاً إلى الـ bucket الخاص؛ إن فشل الحفظ بعده يُحذف الملف.
 */
export async function insertOrder(input: NewOrder): Promise<CreatedOrder> {
  const { contact, pricing, payment } = input
  const now = new Date()
  const orderId = randomUUID()
  const paymentStatus = initialPaymentStatus(payment.method)
  const isTransfer = payment.method === "manual_transfer"

  let proofKey: string | null = null
  if (isTransfer && payment.proof) {
    proofKey = newProofKey(orderId)
    try {
      await putPaymentProof(proofKey, payment.proof.ciphertext)
    } catch {
      throw new ProofStorageError("proof upload failed")
    }
  }

  const soldSlugs: string[] = []
  let couponExhausted = false
  try {
    const created = await db.transaction(async (tx) => {
      let duplicateTransferReference = false
      if (isTransfer && payment.reference) {
        const [{ n }] = await tx.select({ n: count() }).from(orders).where(eq(orders.transferReference, payment.reference))
        duplicateTransferReference = n > 0
      }

      // رقم الطلب عشوائي؛ نعيد المحاولة في الحالة النادرة لتصادمه (داخل SAVEPOINT).
      let orderNumber = ""
      for (let attempt = 0; attempt < 5 && !orderNumber; attempt++) {
        const candidate = makeOrderNumber(now)
        try {
          await tx.transaction(async (inner) => {
            await inner.insert(orders).values({
              id: orderId,
              orderNumber: candidate,
              status: "new",
              customerId: input.customer.id,
              idempotencyKey: input.idempotencyKey ?? null,
              customerPhoneNormalized: contact.phoneNormalized,
              customerName: contact.customerName,
              phone: contact.phone,
              city: contact.city,
              address: contact.address,
              latitude: contact.latitude,
              longitude: contact.longitude,
              locationAccuracy: contact.accuracy,
              locationCapturedAt: contact.capturedAt,
              addressSource: contact.addressSource === "saved" ? "عنوان محفوظ" : "عنوان جديد",
              customerNote: contact.note || null,
              shippingMethod: pricing.shippingMethod,
              shippingPrice: pricing.shippingPrice,
              couponCode: pricing.couponCode || null,
              discount: pricing.discount,
              subtotal: pricing.subtotal,
              total: pricing.total,
              currencySymbol: pricing.currency.symbol,
              currencyCode: pricing.currency.code,
              paymentMethod: payment.method,
              paymentStatus,
              paymentAccountSnapshot: isTransfer ? payment.account : null,
              transferSenderName: isTransfer ? payment.senderName : null,
              transferSenderPhone: isTransfer ? payment.senderPhone || null : null,
              transferReference: isTransfer ? payment.reference : null,
              transferSubmittedAt: isTransfer ? now : null,
              duplicateTransferReference: isTransfer ? duplicateTransferReference : false,
              createdAt: now,
              updatedAt: now,
            })
          })
          orderNumber = candidate
        } catch (e) {
          if (!uniqueViolation(e)?.includes("order_number")) throw e
        }
      }
      if (!orderNumber) throw new Error("تعذّر توليد رقم طلب فريد")

      // الكود المستعمل يُستهلك ذرياً هنا (أحادي الاستعمال/مقيّد بعميل)؛ إن لم يعد صالحاً يتراجع الطلب كله.
      couponExhausted = pricing.couponCode ? (await redeemCoupon(tx, pricing.couponCode, input.customer.id)).exhausted : false

      // البنود لقطة ثابتة (الاسم والسعر)، وتُربط بالمنتج الحي إن وُجد حتى لو حُذف لاحقاً.
      const numbers = pricing.lines.map((l) => l.productId)
      const live = await tx
        .select({ id: products.id, number: products.productNumber })
        .from(products)
        .where(inArray(products.productNumber, numbers))
      const uuidByNumber = new Map(live.map((p) => [p.number, p.id]))
      // خصم المخزون ذرياً: UPDATE مشروط يقفل الصف، فلا يبيع طلبان متزامنان آخر قطعة.
      // الترتيب الثابت بالرقم يمنع deadlock بين طلبين يشتركان في منتجات.
      soldSlugs.length = 0
      const wanted = new Map<string, { qty: number; name: string }>()
      for (const l of pricing.lines) {
        const prev = wanted.get(l.productId)
        wanted.set(l.productId, { qty: (prev?.qty ?? 0) + l.quantity, name: l.name })
      }
      // منتجات مخزونها لكل لون/مقاس: يُخصم من صف المتغيّر المطلوب، ثم يُضبط المخزون الإجمالي على مجموع المتغيّرات.
      const variantLines = pricing.lines.flatMap((l) => {
        const productUuid = uuidByNumber.get(l.productId)
        return productUuid ? [{ productUuid, name: l.name, color: l.color, size: l.size, quantity: l.quantity }] : []
      })
      const tracked = await deductVariantStock(tx, variantLines)
      soldSlugs.push(...(await syncProductStock(tx, [...tracked])))
      // بترتيب معرّف المنتج (كما في إعادة المخزون عند الإلغاء) كي لا تتعاكس الأقفال بين العمليتين.
      const byUuid = (n: string) => uuidByNumber.get(n) ?? n
      for (const [number, { qty, name }] of [...wanted].sort(([a], [b]) => byUuid(a).localeCompare(byUuid(b)))) {
        if (tracked.has(uuidByNumber.get(number) ?? "")) continue
        const updated = await tx
          .update(products)
          .set({ stock: sql`${products.stock} - ${qty}` })
          .where(and(eq(products.productNumber, number), gte(products.stock, qty)))
          .returning({ id: products.id, slug: products.slug })
        if (updated.length === 0) throw new OutOfStockError(name)
        soldSlugs.push(updated[0].slug)
      }

      await tx.insert(orderItems).values(
        pricing.lines.map((l, position) => ({
          orderId,
          position,
          productId: uuidByNumber.get(l.productId) ?? null,
          productNumber: buildProductNumber(l.productId) || null,
          productRef: l.productId,
          sku: l.sku || null,
          imageUrl: l.image || null,
          name: l.name,
          size: l.size || null,
          color: l.color || null,
          quantity: l.quantity,
          price: l.price,
        })),
      )

      // الدفع من الرصيد: خصم ذري داخل نفس المعاملة — إن فشل أي شيء بعده يتراجع الخصم مع الطلب والمخزون.
      if (payment.method === "wallet") {
        await chargeOrder(tx, { customerId: input.customer.id, orderId, orderNumber, amountBase: pricing.base.total })
      }

      await tx.insert(orderPaymentStatusHistory).values({
        orderId,
        status: paymentStatus,
        changedAt: now,
        changedBy: "النظام",
        note: payment.method === "wallet" ? "دُفع من رصيد المحفظة عند إنشاء الطلب" : "الحالة الابتدائية عند إنشاء الطلب",
      })

      if (proofKey && payment.proof) {
        await tx.insert(orderPaymentProofs).values({
          orderId,
          objectKey: proofKey,
          iv: payment.proof.iv,
          authTag: payment.proof.authTag,
          keyVersion: payment.proof.keyVersion,
          originalMimeType: payment.proof.originalMimeType,
          processedMimeType: payment.proof.processedMimeType,
          byteSize: payment.proof.byteSize,
        })
      }

      return { id: orderId, orderNumber, paymentStatus }
    })
    invalidateStock(soldSlugs)
    if (couponExhausted) invalidateCoupons()
    return created
  } catch (error) {
    if (proofKey) await deletePaymentProof(proofKey).catch(() => {})
    await auditBlocked(error)
    // طلبان متزامنان بنفس المفتاح: الثاني يفشل بتفرّد المفتاح (والمعاملة تراجعت بما فيها المخزون)،
    // فنعيد الطلب الذي نجح بدل خطأ.
    if (input.idempotencyKey && uniqueViolation(error)?.includes("idempotency")) {
      const existing = await findOrderByIdempotencyKey(input.customer.id, input.idempotencyKey)
      if (existing) return { id: existing.id, orderNumber: existing.orderNumber, paymentStatus: existing.paymentStatus as PaymentStatus, duplicate: true }
    }
    throw error
  }
}

/** صفحات المنتجات تعرض المخزون؛ نبطل كاش المنتجات المباعة فقط (لا كاش المتجر كله). */
/** قائمة الأكواد العامة مخزّنة في الكاش؛ تُبطل عند استهلاك آخر استعمال لكود. */
export function invalidateCoupons() {
  try {
    revalidateTag(CACHE_TAGS.coupons, { expire: 0 })
  } catch {
    // خارج سياق طلب Next (اختبارات/سكربتات): لا كاش لإبطاله.
  }
}

export function invalidateStock(slugs: string[]) {
  try {
    revalidateTag(CACHE_TAGS.products, { expire: 0 })
    for (const slug of new Set(slugs)) revalidateTag(productTag(slug), { expire: 0 })
  } catch {
    // خارج سياق طلب Next (اختبارات/سكربتات): لا كاش لإبطاله.
  }
}
