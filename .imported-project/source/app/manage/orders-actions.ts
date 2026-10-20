"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { ordersClient } from "@/sanity/orders/client"
import { assertManageAuthenticated, getManageSessionUser } from "@/lib/manage-auth"
import {
  canTransitionOrder,
  isOrderStatus,
  normalizeOrderStatus,
  ORDER_STATUS_LABELS,
  type OrderStatus,
} from "@/lib/order-status"
import {
  getAdminOrdersPage,
  type OrderFilters,
  type OrdersPage,
  ORDERS_PAGE_SIZE,
} from "@/lib/admin-orders"
import {
  canTransitionPayment,
  initialPaymentStatus,
  isPaymentMethod,
  isPaymentStatus,
  type PaymentStatus,
} from "@/lib/payment"

// ============================================
// إجراءات الطلبات في لوحة الإدارة (/manage)
//
// الحماية: كل إجراء يبدأ بـ assertManageAuthenticated، وتوكن الكتابة
// يبقى على الخادم داخل ordersClient ولا يصل المتصفح إطلاقاً.
//
// الفصل التام:
//   - تغيير حالة الطلب لا يمس حالة الدفع.
//   - تعيين مندوب لا يغيّر حالة الطلب.
//   - تحديث حالة الدفع لا يمس حالة الطلب.
// ============================================

export type OrderActionResult = { ok: true; message: string } | { ok: false; error: string }

const idSchema = z.string().trim().min(1, "معرّف الطلب مطلوب").max(200)
const idsSchema = z
  .array(idSchema)
  .min(1, "اختر طلباً واحداً على الأقل")
  .max(100, "لا يمكن تعيين أكثر من 100 طلب دفعة واحدة")
const noteSchema = z.string().trim().max(500, "الملاحظة طويلة جداً")

function requireOrdersClient() {
  if (!ordersClient) throw new Error("مشروع الطلبات غير مضبوط.")
  return ordersClient
}

function firstZodError(error: z.ZodError): string {
  return error.issues[0]?.message ?? "بيانات غير صالحة"
}

async function run(fn: () => Promise<string>): Promise<OrderActionResult> {
  try {
    const message = await fn()
    return { ok: true, message }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { ok: false, error: firstZodError(error) }
    }
    const message = error instanceof Error ? error.message : "تعذّر تنفيذ العملية"
    console.error("[v0] order action failed:", message)
    return { ok: false, error: message }
  }
}

function revalidateOrders() {
  revalidatePath("/manage")
  revalidatePath("/manage/couriers")
}

function historyKey(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

/**
 * تحديث حالة الطلب مع تسجيل الحالة السابقة والجديدة في سجل الطلب.
 * لا تُمس حالة الدفع إطلاقاً — ولا حتى عند "تم التسليم".
 */
export async function updateOrderStatus(
  id: string,
  next: OrderStatus,
  note?: string,
): Promise<OrderActionResult> {
  return run(async () => {
    await assertManageAuthenticated()
    const orderId = idSchema.parse(id)
    const adminNote = noteSchema.parse(note ?? "")
    if (!isOrderStatus(next)) throw new Error("حالة طلب غير صالحة.")

    const admin = (await getManageSessionUser()) ?? "مدير"
    const client = requireOrdersClient()

    const current = await client.fetch<{ status?: string } | null>(
      `*[_type == "order" && _id == $orderId][0]{ status }`,
      { orderId },
      { cache: "no-store" },
    )
    if (!current) throw new Error("الطلب غير موجود.")

    // نوحّد الحالة القديمة أولاً حتى تعمل الطلبات المحفوظة بـ shipped/completed.
    const from = normalizeOrderStatus(current.status)
    if (from === next) throw new Error("الطلب في هذه الحالة أصلاً.")
    if (!canTransitionOrder(from, next)) {
      throw new Error(
        `لا يمكن الانتقال من "${ORDER_STATUS_LABELS[from]}" إلى "${ORDER_STATUS_LABELS[next]}".`,
      )
    }

    const nowIso = new Date().toISOString()
    const patch: Record<string, unknown> = { status: next }
    // وقت التسليم يُسجَّل مرة واحدة عند الانتقال إلى "تم التسليم".
    if (next === "delivered") patch.deliveredAt = nowIso

    await client
      .patch(orderId)
      .setIfMissing({ statusHistory: [] })
      .set(patch)
      .append("statusHistory", [
        {
          _type: "orderStatusChange",
          _key: historyKey("st"),
          from,
          to: next,
          changedAt: nowIso,
          changedBy: admin,
          note: adminNote || undefined,
        },
      ])
      .commit()

    revalidateOrders()
    return `تم تحديث الحالة إلى "${ORDER_STATUS_LABELS[next]}"`
  })
}

/**
 * تعيين مندوب لطلب واحد أو لمجموعة طلبات دفعة واحدة.
 *
 * - المناديب الموقوفون مرفوضون تماماً على الخادم.
 * - نحفظ مرجع المندوب ولقطة ثابتة من اسمه وهاتفه لحماية الطلبات القديمة.
 * - لا نغيّر حالة الطلب: تغيير الحالة إلى "تم تعيين مندوب" أو "في الطريق"
 *   يبقى إجراءً مستقلاً يقوم به المسؤول بوضوح.
 */
export async function assignCourier(
  orderIds: string[],
  courierId: string,
): Promise<OrderActionResult> {
  return run(async () => {
    await assertManageAuthenticated()
    const ids = idsSchema.parse(orderIds)
    const cid = idSchema.parse(courierId)
    const client = requireOrdersClient()

    const courier = await client.fetch<{
      _id: string
      name?: string
      phone?: string
      status?: string
    } | null>(
      `*[_type == "courier" && _id == $cid][0]{ _id, name, phone, status }`,
      { cid },
      { cache: "no-store" },
    )

    if (!courier) throw new Error("المندوب غير موجود.")
    if (courier.status === "suspended") {
      throw new Error("لا يمكن تعيين مندوب موقوف. فعّله أولاً أو اختر مندوباً آخر.")
    }

    const nowIso = new Date().toISOString()
    let transaction = client.transaction()
    for (const orderId of ids) {
      transaction = transaction.patch(
        client.patch(orderId).set({
          courier: { _type: "reference", _ref: courier._id },
          courierSnapshot: {
            courierId: courier._id,
            name: courier.name ?? "",
            phone: courier.phone ?? "",
          },
          courierAssignedAt: nowIso,
        }),
      )
    }
    await transaction.commit()

    revalidateOrders()
    return ids.length === 1
      ? `تم تعيين ${courier.name ?? "المندوب"} للطلب`
      : `تم تعيين ${courier.name ?? "المندوب"} لـ ${ids.length} طلب`
  })
}

/** إزالة المندوب من الطلب — يعيده إلى قائمة الطلبات غير الموزّعة بلا تغيير حالته. */
export async function unassignCourier(id: string): Promise<OrderActionResult> {
  return run(async () => {
    await assertManageAuthenticated()
    const orderId = idSchema.parse(id)
    const client = requireOrdersClient()

    await client
      .patch(orderId)
      .unset(["courier", "courierSnapshot", "courierAssignedAt"])
      .commit()

    revalidateOrders()
    return "تم إلغاء تعيين المندوب"
  })
}

/**
 * تحديث حالة الدفع فقط — لا تُمس حالة الطلب (status) إطلاقاً.
 * يتحقق من الانتقال المسموح حسب طريقة الدفع، ويسجّل الوقت والمدير في السجل.
 */
export async function updatePaymentStatus(
  id: string,
  next: PaymentStatus,
  options?: { reason?: string; note?: string },
) {
  await assertManageAuthenticated()
  const admin = (await getManageSessionUser()) ?? "مدير"
  const client = requireOrdersClient()
  if (!isPaymentStatus(next)) throw new Error("حالة دفع غير صالحة.")

  const current = await client.fetch<{
    paymentMethod?: string
    paymentStatus?: string
  } | null>(`*[_type == "order" && _id == $id][0]{ paymentMethod, paymentStatus }`, { id }, {
    cache: "no-store",
  })

  if (!current) throw new Error("الطلب غير موجود.")
  if (!isPaymentMethod(current.paymentMethod)) {
    throw new Error("طريقة الدفع غير مسجلة لهذا الطلب — لا يمكن تغيير حالة الدفع.")
  }

  const currentStatus: PaymentStatus = isPaymentStatus(current.paymentStatus)
    ? current.paymentStatus
    : initialPaymentStatus(current.paymentMethod)

  if (!canTransitionPayment(current.paymentMethod, currentStatus, next)) {
    throw new Error("انتقال غير مسموح لحالة الدفع.")
  }

  const reason = (options?.reason ?? "").trim().slice(0, 500)
  if (next === "rejected" && reason.length < 3) {
    throw new Error("سبب رفض إثبات الدفع مطلوب.")
  }

  const nowIso = new Date().toISOString()
  const patch: Record<string, unknown> = { paymentStatus: next }

  if (next === "verified") {
    patch.paymentVerifiedAt = nowIso
    patch.paymentRejectionReason = ""
  }
  if (next === "rejected") {
    patch.paymentRejectedAt = nowIso
    patch.paymentRejectionReason = reason
  }
  if (next === "pending_verification") {
    patch.paymentRejectionReason = ""
  }

  const note = (options?.note ?? "").trim().slice(0, 500)
  if (note) patch.paymentAdminNote = note

  // لا نحذف صورة الإثبات إطلاقاً عند الرفض — تبقى للمراجعة.
  await client
    .patch(id)
    .setIfMissing({ paymentStatusHistory: [] })
    .set(patch)
    .append("paymentStatusHistory", [
      {
        _type: "paymentStatusChange",
        _key: historyKey("chg"),
        status: next,
        changedAt: nowIso,
        changedBy: admin,
        note: next === "rejected" ? reason : note,
      },
    ])
    .commit()

  revalidateOrders()
}

/** حذف طلب نهائياً. */
export async function deleteOrder(id: string) {
  await assertManageAuthenticated()
  const client = requireOrdersClient()
  await client.delete(idSchema.parse(id))
  revalidateOrders()
}

/**
 * جلب دفعة من الطلبات حسب الفلاتر — تُستدعى من الواجهة عند التصفية
 * أو الضغط على "تحميل المزيد"، حتى لا تُحمّل كل الطلبات دفعة واحدة.
 */
export async function fetchOrdersPage(
  filters: OrderFilters,
  page: number,
): Promise<OrdersPage> {
  await assertManageAuthenticated()
  const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 0
  return getAdminOrdersPage(filters ?? {}, safePage, ORDERS_PAGE_SIZE)
}
