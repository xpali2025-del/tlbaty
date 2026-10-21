"use server"

import { revalidatePath } from "next/cache"
import { and, eq, inArray } from "drizzle-orm"
import { z } from "zod"
import { db } from "@/lib/db/client"
import { couriers, orderPaymentProofs, orderPaymentStatusHistory, orderStatusHistory, orders } from "@/lib/db/store"
import { assertManageAuthenticated, getManageSessionUser } from "@/lib/manage-auth"
import {
  canTransitionOrder,
  isOrderStatus,
  normalizeOrderStatus,
  ORDER_STATUS_LABELS,
  type OrderStatus,
} from "@/lib/order-status"
import { getAdminOrdersPage, type OrderFilters, type OrdersPage, ORDERS_PAGE_SIZE } from "@/lib/admin-orders"
import { canTransitionPayment, initialPaymentStatus, isPaymentStatus, type PaymentStatus } from "@/lib/payment"
import { deletePaymentProof } from "@/lib/storage/proofs"

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

export async function updateOrderStatus(id: string, next: OrderStatus, note?: string): Promise<OrderActionResult> {
  return run(async () => {
    await assertManageAuthenticated()
    const orderId = idSchema.parse(id)
    const adminNote = noteSchema.parse(note ?? "")
    if (!isOrderStatus(next)) throw new Error("حالة طلب غير صالحة.")
    const admin = (await getManageSessionUser()) ?? "مدير"

    await db.transaction(async (tx) => {
      const [current] = await tx.select({ status: orders.status }).from(orders).where(eq(orders.id, orderId)).for("update")
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
    return `تم تحديث الحالة إلى "${ORDER_STATUS_LABELS[next]}"`
  })
}

export async function assignCourier(orderIds: string[], courierId: string): Promise<OrderActionResult> {
  return run(async () => {
    await assertManageAuthenticated()
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
        .where(inArray(orders.id, ids))
        .returning({ id: orders.id })
      if (updated.length !== new Set(ids).size) throw new Error("بعض الطلبات المحددة غير موجودة.")
    })

    revalidateOrders()
    return ids.length === 1
      ? `تم تعيين ${courier.name || "المندوب"} للطلب`
      : `تم تعيين ${courier.name || "المندوب"} لـ ${ids.length} طلب`
  })
}

export async function unassignCourier(id: string): Promise<OrderActionResult> {
  return run(async () => {
    await assertManageAuthenticated()
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
  await assertManageAuthenticated()
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
  await assertManageAuthenticated()
  const orderId = idSchema.parse(id)
  const [proof] = await db.select().from(orderPaymentProofs).where(eq(orderPaymentProofs.orderId, orderId)).limit(1)
  const deleted = await db.delete(orders).where(and(eq(orders.id, orderId))).returning({ id: orders.id })
  if (deleted.length && proof) await deletePaymentProof(proof.objectKey).catch(() => {})
  revalidateOrders()
}

export async function fetchOrdersPage(filters: OrderFilters, page: number): Promise<OrdersPage> {
  await assertManageAuthenticated()
  const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 0
  return getAdminOrdersPage(filters ?? {}, safePage, ORDERS_PAGE_SIZE)
}
