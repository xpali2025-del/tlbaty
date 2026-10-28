import "server-only"
import { and, count, eq, gte, sql } from "drizzle-orm"
import { db } from "@/lib/db/client"
import { orders, walletTopups, wallets } from "@/lib/db/store"
import { uniqueViolation } from "@/lib/manage-helpers"
import type { PaymentAccountSnapshot } from "@/lib/payment"
import { applyEntry, audit, auditBlocked } from "./ledger"
import {
  MAX_PENDING_TOPUPS,
  MAX_REJECTED_TOPUPS_7D,
  MAX_TOPUP_BASE,
  MAX_TOPUPS_PER_DAY,
  MIN_TOPUP_BASE,
  WalletError,
  normalizeReference,
} from "./rules"
import { normalizedReferenceSql } from "./reference-sql"

const DAY = 24 * 3_600_000

export type TopupRequest = {
  customerId: string
  /** المبلغ بعملة `currency`. */
  amount: number
  currency: { code: string; rate: number }
  account: PaymentAccountSnapshot
  senderName: string
  senderPhone: string
  reference: string
  ip?: string | null
}

/**
 * طلب شحن رصيد (حوالة بانتظار مراجعة الإدارة). لا يُضاف رصيد قبل الموافقة.
 * ضوابط: سقوف المبلغ، حد للطلبات المعلّقة واليومية، إيقاف مؤقت بعد رفضات متكررة،
 * ومنع استعمال نفس رقم الحوالة مرتين (فهرس تفرّد) مع وسم تكراره على الطلبات العادية.
 */
export async function requestTopup(input: TopupRequest): Promise<{ id: string }> {
  const rate = input.currency.rate
  const amountBase = Math.round(input.amount * rate * 100) / 100
  if (!Number.isFinite(amountBase) || amountBase < MIN_TOPUP_BASE) throw new WalletError("INVALID", "المبلغ أقل من الحد الأدنى للشحن.")
  if (amountBase > MAX_TOPUP_BASE) throw new WalletError("INVALID", "المبلغ أكبر من الحد الأقصى للشحن في العملية الواحدة.")
  const reference = normalizeReference(input.reference)
  const now = Date.now()

  try {
    return await db.transaction(async (tx) => {
      // يسلسل الطلبات المتزامنة لنفس العميل حتى لا يتجاوز الحدود بطلبات متوازية.
      await tx.insert(wallets).values({ customerId: input.customerId }).onConflictDoNothing()
      const [w] = await tx.select({ frozen: wallets.frozen, balance: wallets.balance }).from(wallets).where(eq(wallets.customerId, input.customerId)).for("update")
      if (w.frozen) throw new WalletError("FROZEN", "المحفظة مجمّدة مؤقتاً. تواصل مع خدمة العملاء.")

      const [{ pending }] = await tx
        .select({ pending: count() })
        .from(walletTopups)
        .where(and(eq(walletTopups.customerId, input.customerId), eq(walletTopups.status, "pending")))
      if (pending >= MAX_PENDING_TOPUPS) throw new WalletError("TOO_MANY_PENDING", "لديك طلبات شحن قيد المراجعة. انتظر مراجعتها قبل إرسال طلب جديد.")

      const [{ today }] = await tx
        .select({ today: count() })
        .from(walletTopups)
        .where(and(eq(walletTopups.customerId, input.customerId), gte(walletTopups.createdAt, new Date(now - DAY))))
      if (today >= MAX_TOPUPS_PER_DAY) throw new WalletError("TOO_MANY_REQUESTS", "تجاوزت عدد طلبات الشحن المسموح اليوم. حاول غداً.")

      const [{ rejected }] = await tx
        .select({ rejected: count() })
        .from(walletTopups)
        .where(and(eq(walletTopups.customerId, input.customerId), eq(walletTopups.status, "rejected"), gte(walletTopups.createdAt, new Date(now - 7 * DAY))))
      if (rejected >= MAX_REJECTED_TOPUPS_7D) {
        throw new WalletError("TOO_MANY_REJECTED", "تم إيقاف طلبات الشحن مؤقتاً بسبب طلبات مرفوضة متكررة. تواصل مع خدمة العملاء.", {
          customerId: input.customerId,
          action: "topup_blocked_rejections",
          detail: { rejected },
        })
      }

      // رقم الطلب مخزَّن كما كتبه العميل (قد يكون بأرقام عربية): يُطبَّع في SQL بنفس قواعد رقم الشحن.
      const [{ onOrder }] = await tx.select({ onOrder: count() }).from(orders).where(sql`${normalizedReferenceSql(orders.transferReference)} = ${reference}`)

      const [row] = await tx
        .insert(walletTopups)
        .values({
          customerId: input.customerId,
          amount: input.amount,
          currencyCode: input.currency.code,
          rate,
          amountBase,
          paymentAccountSnapshot: input.account,
          senderName: input.senderName,
          senderPhone: input.senderPhone,
          reference,
          referenceUsedOnOrder: onOrder > 0,
          ip: input.ip ?? null,
        })
        .returning({ id: walletTopups.id })
      return row
    })
  } catch (e) {
    await auditBlocked(e)
    if (uniqueViolation(e)?.includes("reference")) {
      throw new WalletError("DUPLICATE_REFERENCE", "رقم الحوالة هذا مستخدم من قبل. تأكد من الرقم أو تواصل مع خدمة العملاء.")
    }
    throw e
  }
}

/** العميل يلغي طلب شحن ما زال معلّقاً. */
export async function cancelTopup(customerId: string, topupId: string): Promise<void> {
  const [row] = await db
    .update(walletTopups)
    .set({ status: "cancelled", reviewedAt: new Date(), reviewedBy: "customer" })
    .where(and(eq(walletTopups.id, topupId), eq(walletTopups.customerId, customerId), eq(walletTopups.status, "pending")))
    .returning({ id: walletTopups.id })
  if (!row) throw new WalletError("NOT_PENDING", "لا يمكن إلغاء هذا الطلب.")
}

/**
 * موافقة الإدارة: تضيف الرصيد مرة واحدة (قفل الصف + شرط الحالة + مفتاح idempotency).
 * `confirmedAmount` اختياري بعملة الطلب وبحد أقصى المبلغ المطلوب (إن وصلت حوالة أقل).
 */
export async function approveTopup(topupId: string, admin: string, confirmedAmount?: number): Promise<{ credited: number }> {
  return db.transaction(async (tx) => {
    const [t] = await tx.select().from(walletTopups).where(eq(walletTopups.id, topupId)).for("update")
    if (!t) throw new WalletError("NOT_FOUND", "طلب الشحن غير موجود.")
    if (t.status !== "pending") throw new WalletError("NOT_PENDING", "هذا الطلب تمت مراجعته من قبل.")
    let credited = t.amountBase
    if (confirmedAmount !== undefined) {
      if (!Number.isFinite(confirmedAmount) || confirmedAmount <= 0 || confirmedAmount > t.amount) {
        throw new WalletError("INVALID", "المبلغ المؤكَّد يجب أن يكون موجباً ولا يزيد على المبلغ المطلوب.")
      }
      credited = Math.round(confirmedAmount * t.rate * 100) / 100
    }
    await applyEntry(tx, {
      customerId: t.customerId,
      kind: "topup",
      amount: credited,
      actor: admin,
      topupId: t.id,
      note: `حوالة ${t.reference}`,
      idempotencyKey: `topup:${t.id}`,
    })
    await tx.update(walletTopups).set({ status: "approved", creditedAmountBase: credited, reviewedBy: admin, reviewedAt: new Date() }).where(eq(walletTopups.id, t.id))
    await audit(tx, t.customerId, "topup_approved", admin, { topupId: t.id, credited })
    return { credited }
  })
}

export async function rejectTopup(topupId: string, admin: string, reason: string): Promise<void> {
  const why = reason.trim()
  if (why.length < 3) throw new WalletError("INVALID", "سبب الرفض مطلوب.")
  await db.transaction(async (tx) => {
    const [t] = await tx.select().from(walletTopups).where(eq(walletTopups.id, topupId)).for("update")
    if (!t) throw new WalletError("NOT_FOUND", "طلب الشحن غير موجود.")
    if (t.status !== "pending") throw new WalletError("NOT_PENDING", "هذا الطلب تمت مراجعته من قبل.")
    await tx.update(walletTopups).set({ status: "rejected", rejectionReason: why.slice(0, 500), reviewedBy: admin, reviewedAt: new Date() }).where(eq(walletTopups.id, t.id))
    await audit(tx, t.customerId, "topup_rejected", admin, { topupId: t.id, reason: why.slice(0, 500) })
  })
}

