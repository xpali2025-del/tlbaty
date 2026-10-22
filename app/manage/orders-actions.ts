"use server"

import { revalidatePath } from "next/cache"
import { and, asc, eq, inArray, isNull, notInArray, sql } from "drizzle-orm"
import { z } from "zod"
import { db } from "@/lib/db/client"
import { couriers, orderItems, orderPaymentProofs, orderPaymentStatusHistory, orderStatusHistory, orders, products } from "@/lib/db/store"
import { assertManagePermission, getManageSessionUser } from "@/lib/manage-auth"
import {
  canTransitionOrder,
  isOrderStatus,
  normalizeOrderStatus,
  ORDER_STATUS_LABELS,
  type OrderStatus,
} from "@/lib/order-status"
import { invalidateStock } from "@/lib/orders/create"
import { isOpenOrderStatus } from "@/lib/order-status"
import { planDistribution, type DistributionPlan } from "@/lib/distribution"
import { getAdminOrdersPage, type OrderFilters, type OrdersPage, ORDERS_PAGE_SIZE } from "@/lib/admin-orders"
import { canTransitionPayment, initialPaymentStatus, isPaymentStatus, type PaymentStatus } from "@/lib/payment"
import { deletePaymentProof } from "@/lib/storage/proofs"
import { refundOrder } from "@/lib/wallet/ledger"
import { releaseCoupon } from "@/lib/orders/coupons"
import { restoreVariantStock, syncProductStock } from "@/lib/orders/variants"

// ============================================
// إجراءات إدارة الطلبات على PostgreSQL. كل تغيير حالة يحدث داخل معاملة تقفل صف الطلب
// (SELECT … FOR UPDATE) فلا يتجاوز مديران متزامنان قواعد الانتقال، ويُسجَّل في السجل.
// ============================================

export type OrderActionResult = { ok: true; message: string } | { ok: false; error: string }

const idSchema = z.string().trim().uuid("معرّف الطلب غير صالح")
const idsSchema = z
  .array(idSchema)
  .min(1, "اختر طلباً واحداً على الأقل")
  .max(100, "لا يمكن تعيين أكثر من 100 طلب دفعة واحدة")
const noteSchema = z.string().trim().max(500, "الملاحظة طويلة جداً")

function firstZodError(error: z.ZodError): string {
  return error.issues[0]?.message ?? "بيانات غير صالحة"
}

async function run(fn: () => Promise<string>): Promise<OrderActionResult> {
  try {
    return { ok: true, message: await fn() }
  } catch (error) {
    if (error instanceof z.ZodError) return { ok: false, error: firstZodError(error) }
    const message = error instanceof Error ? error.message : "تعذّر تنفيذ العملية"
    console.error("order action failed:", message)
    return { ok: false, error: message }
  }
}

function revalidateOrders() {
  revalidatePath("/manage")
  revalidatePath("/manage/couriers")
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** يعيد مخزون بنود طلب (المنتجات الحيّة فقط) ويعيد slugs المتأثرة لإبطال كاشها بعد نجاح المعاملة. */
async function restoreStock(tx: Tx, orderId: string): Promise<string[]> {
  const lines = await tx
    .select({ productId: orderItems.productId, name: orderItems.name, color: orderItems.color, size: orderItems.size, quantity: orderItems.quantity })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId))
  const restore = new Map<string, number>()
  for (const l of lines) if (l.productId) restore.set(l.productId, (restore.get(l.productId) ?? 0) + l.quantity)
  const slugs: string[] = []
  for (const [productId, qty] of [...restore].sort(([a], [b]) => a.localeCompare(b))) {
    const [row] = await tx
      .update(products)
      .set({ stock: sql`${products.stock} + ${qty}` })
      .where(eq(products.id, productId))
      .returning({ slug: products.slug })
    if (row) slugs.push(row.slug)
  }
  // منتجات مخزونها لكل لون/مقاس: تعود الكمية لصف اللون/المقاس نفسه، ثم يُضبط الإجمالي على مجموع المتغيّرات.
  const tracked = await restoreVariantStock(
    tx,
    lines.flatMap((l) => (l.productId ? [{ productUuid: l.productId, name: l.name, color: l.color ?? "", size: l.size ?? "", quantity: l.quantity }] : [])),
  )
  slugs.push(...(await syncProductStock(tx, [...tracked])))
  return slugs
}

export async function updateOrderStatus(id: string, next: OrderStatus, note?: string): Promise<OrderActionResult> {
  return run(async () => {
    await assertManagePermission("orders")
    const orderId = idSchema.parse(id)
    const adminNote = noteSchema.parse(note ?? "")
    if (!isOrderStatus(next)) throw new Error("حالة طلب غير صالحة.")
    const admin = (await getManageSessionUser()) ?? "مدير"

    const restoredSlugs: string[] = []
    await db.transaction(async (tx) => {
      const [current] = await tx
        .select({ status: orders.status, orderNumber: orders.orderNumber, paymentMethod: orders.paymentMethod, paymentStatus: orders.paymentStatus, couponCode: orders.couponCode })
        .from(orders)
        .where(eq(orders.id, orderId))
        .for("update")
      if (!current) throw new Error("الطلب غير موجود.")
      const from = normalizeOrderStatus(current.status)
      if (from === next) throw new Error("الطلب في هذه الحالة أصلاً.")
      if (!canTransitionOrder(from, next)) {
        throw new Error(`لا يمكن الانتقال من "${ORDER_STATUS_LABELS[from]}" إلى "${ORDER_STATUS_LABELS[next]}".`)
      }
      const now = new Date()
      await tx
        .update(orders)
        .set({ status: next, updatedAt: now, ...(next === "delivered" ? { deliveredAt: now } : {}) })
        .where(eq(orders.id, orderId))
      // إلغاء الطلب أو إرجاعه يعيد المخزون (الحالتان نهائيتان فلا يتكرر الإرجاع).
      if (next === "cancelled" || next === "returned") {
        restoredSlugs.push(...(await restoreStock(tx, orderId)))
        await releaseCoupon(tx, current.couponCode)
        // ما دُفع من الرصيد يعود للمحفظة تلقائياً (مرة واحدة) ويُسجَّل في سجل الدفع.
        if (current.paymentMethod === "wallet") {
          const refunded = await refundOrder(tx, {
            orderId,
            orderNumber: current.orderNumber,
            actor: admin,
            reason: next === "cancelled" ? "إلغاء الطلب" : "إرجاع الطلب",
          })
          if (refunded !== null) {
            await tx.update(orders).set({ paymentStatus: "refunded" }).where(eq(orders.id, orderId))
            await tx.insert(orderPaymentStatusHistory).values({
              orderId,
              status: "refunded",
              changedAt: now,
              changedBy: admin,
              note: "أُعيد المبلغ إلى رصيد العميل",
            })
          }
        }
      }
      await tx.insert(orderStatusHistory).values({
        orderId,
        fromStatus: from,
        toStatus: next,
        changedAt: now,
        changedBy: admin,
        note: adminNote || null,
      })
    })

    revalidateOrders()
    if (restoredSlugs.length) invalidateStock(restoredSlugs) // صفحات المنتج تعرض «نفد المخزون» من الكاش
    return `تم تحديث الحالة إلى "${ORDER_STATUS_LABELS[next]}"`
  })
}

export async function assignCourier(orderIds: string[], courierId: string): Promise<OrderActionResult> {
  return run(async () => {
    await assertManagePermission("orders")
    const ids = idsSchema.parse(orderIds)
    const cid = z.string().trim().uuid("معرّف المندوب غير صالح").parse(courierId)

    const [courier] = await db.select().from(couriers).where(eq(couriers.id, cid)).limit(1)
    if (!courier) throw new Error("المندوب غير موجود.")
    if (courier.status === "suspended") {
      throw new Error("لا يمكن تعيين مندوب موقوف. فعّله أولاً أو اختر مندوباً آخر.")
    }

    // معاملة واحدة: إن كان أي طلب غير موجود يُتراجع عن التعيين كله ولا يبقى تعيين جزئي.
    const now = new Date()
    await db.transaction(async (tx) => {
      const updated = await tx
        .update(orders)
        .set({
          courierId: courier.id,
          courierSnapshot: { courierId: courier.id, name: courier.name, phone: courier.phone ?? "" },
          courierAssignedAt: now,
          updatedAt: now,
        })
        .where(and(inArray(orders.id, ids), notInArray(orders.status, ["delivered", "cancelled", "returned"])))
        .returning({ id: orders.id })
      if (updated.length !== new Set(ids).size) throw new Error("بعض الطلبات المحددة غير موجودة أو مغلقة (مسلَّمة/ملغاة/مُرجَعة).")
    })

    revalidateOrders()
    return ids.length === 1
      ? `تم تعيين ${courier.name || "المندوب"} للطلب`
      : `تم تعيين ${courier.name || "المندوب"} لـ ${ids.length} طلب`
  })
}

export type DistributionResult =
  | {
      ok: true
      message: string
      assigned: number
      skipped: number
      perCourier: { courierId: string; name: string; count: number }[]
    }
  | { ok: false; error: string }

/** أقصى عدد طلبات تُوزَّع في عملية واحدة (حماية للخادم والمعاملة). */
const MAX_DISTRIBUTION = 300

/**
 * توزيع تلقائي عادل: يعيّن الطلبات المفتوحة التي بلا مندوب على المناديب النشطين بحسب المدينة
 * والحمل الحالي (انظر lib/distribution.ts). إن مُرّرت معرّفات يوزّع المحدد منها فقط.
 * الطلبات المعيّنة مسبقاً أو المنتهية لا تُمسّ، وما لا يجد مندوباً يُعاد عدّه كـ«متروك».
 */
export async function autoDistributeOrders(orderIds?: string[]): Promise<DistributionResult> {
  try {
    await assertManagePermission("couriers")
    const ids = orderIds?.length ? idsSchema.parse(orderIds) : null

    const result = await db.transaction(async (tx) => {
      const candidates = await tx
        .select({ id: orders.id, city: orders.city, createdAt: orders.createdAt })
        .from(orders)
        .where(
          and(
            isNull(orders.courierId),
            notInArray(orders.status, ["delivered", "cancelled", "returned", "failed"]),
            ids ? inArray(orders.id, ids) : undefined,
          ),
        )
        .orderBy(asc(orders.createdAt))
        .limit(MAX_DISTRIBUTION)
        .for("update")
      if (candidates.length === 0) return { plan: null as DistributionPlan | null, couriersById: new Map<string, { name: string; phone: string }>() }

      const active = await tx.select().from(couriers).where(eq(couriers.status, "active"))
      const loads = await tx
        .select({ courierId: orders.courierId, n: sql<number>`count(*)::int` })
        .from(orders)
        .where(and(sql`${orders.courierId} is not null`, notInArray(orders.status, ["delivered", "cancelled", "returned", "failed"])))
        .groupBy(orders.courierId)
      const loadById = new Map(loads.map((l) => [l.courierId as string, l.n]))

      const plan = planDistribution(
        candidates.map((o) => ({ id: o.id, city: o.city ?? "", createdAt: o.createdAt })),
        active.map((c) => ({ id: c.id, name: c.name, cities: c.cities, load: loadById.get(c.id) ?? 0 })),
      )
      const couriersById = new Map(active.map((c) => [c.id, { name: c.name, phone: c.phone ?? "" }]))
      const now = new Date()
      for (const a of plan.assignments) {
        const c = couriersById.get(a.courierId)!
        await tx
          .update(orders)
          .set({
            courierId: a.courierId,
            courierSnapshot: { courierId: a.courierId, name: c.name, phone: c.phone },
            courierAssignedAt: now,
            updatedAt: now,
          })
          .where(eq(orders.id, a.orderId))
      }
      return { plan, couriersById }
    })

    const plan = result.plan
    if (!plan) return { ok: true, message: "لا توجد طلبات مفتوحة بلا مندوب للتوزيع.", assigned: 0, skipped: 0, perCourier: [] }

    const counts = new Map<string, number>()
    for (const a of plan.assignments) counts.set(a.courierId, (counts.get(a.courierId) ?? 0) + 1)
    const perCourier = [...counts].map(([courierId, count]) => ({ courierId, name: result.couriersById.get(courierId)!.name, count }))
    revalidateOrders()
    const skipped = plan.skipped.length
    return {
      ok: true,
      assigned: plan.assignments.length,
      skipped,
      perCourier,
      message:
        plan.assignments.length === 0
          ? "لم يُوزَّع أي طلب: لا يوجد مندوب نشط يغطي مدن هذه الطلبات."
          : `تم توزيع ${plan.assignments.length} طلب على ${perCourier.length} مندوب` + (skipped ? ` وتُرك ${skipped} بلا مندوب لعدم وجود مندوب يغطي مدينتها` : ""),
    }
  } catch (error) {
    if (error instanceof z.ZodError) return { ok: false, error: firstZodError(error) }
    return { ok: false, error: error instanceof Error ? error.message : "تعذّر توزيع الطلبات" }
  }
}

export async function unassignCourier(id: string): Promise<OrderActionResult> {
  return run(async () => {
    await assertManagePermission("orders")
    const orderId = idSchema.parse(id)
    await db
      .update(orders)
      .set({ courierId: null, courierSnapshot: null, courierAssignedAt: null, updatedAt: new Date() })
      .where(eq(orders.id, orderId))
    revalidateOrders()
    return "تم إلغاء تعيين المندوب"
  })
}

/**
 * تغيير حالة الدفع. تتحقق من الانتقال المسموح لطريقة الدفع، وتشترط سبباً عند الرفض،
 * وتسجّل التغيير. تُرمى الأخطاء (يعرضها المكوّن).
 */
export async function updatePaymentStatus(
  id: string,
  next: PaymentStatus,
  options?: { reason?: string; note?: string },
) {
  await assertManagePermission("orders")
  const orderId = idSchema.parse(id)
  const admin = (await getManageSessionUser()) ?? "مدير"
  if (!isPaymentStatus(next)) throw new Error("حالة دفع غير صالحة.")

  const reason = (options?.reason ?? "").trim().slice(0, 500)
  const note = (options?.note ?? "").trim().slice(0, 500)

  await db.transaction(async (tx) => {
    const [current] = await tx
      .select({ method: orders.paymentMethod, status: orders.paymentStatus })
      .from(orders)
      .where(eq(orders.id, orderId))
      .for("update")
    if (!current) throw new Error("الطلب غير موجود.")
    const currentStatus: PaymentStatus = isPaymentStatus(current.status) ? current.status : initialPaymentStatus(current.method)
    if (!canTransitionPayment(current.method, currentStatus, next)) {
      throw new Error("انتقال غير مسموح لحالة الدفع.")
    }
    if (next === "rejected" && reason.length < 3) throw new Error("سبب رفض إثبات الدفع مطلوب.")

    const now = new Date()
    await tx
      .update(orders)
      .set({
        paymentStatus: next,
        updatedAt: now,
        ...(next === "verified" ? { paymentVerifiedAt: now, paymentRejectionReason: "" } : {}),
        ...(next === "rejected" ? { paymentRejectedAt: now, paymentRejectionReason: reason } : {}),
        ...(next === "pending_verification" ? { paymentRejectionReason: "" } : {}),
        ...(note ? { paymentAdminNote: note } : {}),
      })
      .where(eq(orders.id, orderId))
    await tx.insert(orderPaymentStatusHistory).values({
      orderId,
      status: next,
      changedAt: now,
      changedBy: admin,
      note: (next === "rejected" ? reason : note) || null,
    })
  })

  revalidateOrders()
}

/** يحذف الطلب مع بنوده وسجلاته، ويحذف ملف إثبات الدفع المشفَّر من التخزين الخاص أيضاً. */
export async function deleteOrder(id: string) {
  await assertManagePermission("orders")
  const orderId = idSchema.parse(id)
  const [proof] = await db.select().from(orderPaymentProofs).where(eq(orderPaymentProofs.orderId, orderId)).limit(1)
  let slugs: string[] = []
  const deleted = await db.transaction(async (tx) => {
    const [current] = await tx
      .select({ status: orders.status, orderNumber: orders.orderNumber, paymentMethod: orders.paymentMethod, couponCode: orders.couponCode })
      .from(orders)
      .where(eq(orders.id, orderId))
      .for("update")
    if (!current) return false
    // طلب مدفوع من الرصيد ما زال مفتوحاً: يُعاد المبلغ لصاحبه قبل الحذف (لا يضيع رصيد العميل).
    if (current.paymentMethod === "wallet" && isOpenOrderStatus(normalizeOrderStatus(current.status))) {
      await refundOrder(tx, { orderId, orderNumber: current.orderNumber, actor: (await getManageSessionUser()) ?? "مدير", reason: "حذف الطلب" })
    }
    // حذف طلب مفتوح (لم يُسلَّم ولم يُلغَ) يعيد وحداته للمخزون؛ المسلَّم والملغي/المُرجَع لا يُعاد لهما شيء هنا.
    if (isOpenOrderStatus(normalizeOrderStatus(current.status))) {
      slugs = await restoreStock(tx, orderId)
      await releaseCoupon(tx, current.couponCode)
    }
    await tx.delete(orders).where(eq(orders.id, orderId))
    return true
  })
  if (deleted && proof) await deletePaymentProof(proof.objectKey).catch(() => {})
  if (slugs.length) invalidateStock(slugs)
  revalidateOrders()
}

export async function fetchOrdersPage(filters: OrderFilters, page: number): Promise<OrdersPage> {
  await assertManagePermission("orders")
  const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 0
  return getAdminOrdersPage(filters ?? {}, safePage, ORDERS_PAGE_SIZE)
}
