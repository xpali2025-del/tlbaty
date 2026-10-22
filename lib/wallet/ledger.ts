import "server-only"
import { and, eq, gte, sql } from "drizzle-orm"
import { db } from "@/lib/db/client"
import { customerPhoneHistory, walletAuditLog, walletTransactions, wallets } from "@/lib/db/store"
import {
  DAILY_SPEND_LIMIT_BASE,
  MAX_BALANCE_BASE,
  PHONE_CHANGE_COOLDOWN_MS,
  WalletError,
  type WalletKind,
} from "./rules"

// ============================================
// دفتر حركات الرصيد — المكان الوحيد الذي يغيّر الرصيد.
//
//  * كل تغيير داخل معاملة قاعدة بيانات يستدعيها المستدعي (الطلب/الموافقة…) فيتراجع الرصيد مع الحدث إن فشل.
//  * التعديل UPDATE مشروط يقفل صف المحفظة: لا رصيد سالب ولا سحب مزدوج مع التزامن.
//  * الحركات لا تُعدَّل ولا تُحذف (Trigger)، وكل حركة تحمل الرصيد بعدها فيمكن تدقيق السلسلة.
//  * مفتاح idempotency وفهارس تفرّد (دفع واحد وإرجاع واحد لكل طلب) يمنعان التكرار.
// ============================================

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

export type LedgerEntry = {
  customerId: string
  kind: WalletKind
  /** موجب للإضافة وسالب للخصم؛ بالعملة الأساسية. */
  amount: number
  actor: string
  orderId?: string
  topupId?: string
  note?: string
  reason?: string
  idempotencyKey?: string
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** يطبّق حركة واحدة على المحفظة ويكتبها في الدفتر. يرمي WalletError عند أي مخالفة. */
export async function applyEntry(tx: Tx, entry: LedgerEntry): Promise<{ id: string; balance: number }> {
  const amount = round2(entry.amount)
  if (!Number.isFinite(amount) || amount === 0) throw new WalletError("INVALID", "مبلغ غير صالح.")
  const credit = amount > 0
  const refund = entry.kind === "order_refund"
  // الإرجاع يعود لصاحبه حتى لو كانت المحفظة مجمّدة ولا يخضع لسقف الرصيد؛ خصم الإدارة مسموح دائماً.
  const respectFreeze = entry.kind !== "order_refund" && entry.kind !== "admin_debit"

  if (credit) await tx.insert(wallets).values({ customerId: entry.customerId }).onConflictDoNothing()

  const conditions = [eq(wallets.customerId, entry.customerId)]
  if (respectFreeze) conditions.push(eq(wallets.frozen, false))
  if (credit && !refund) conditions.push(sql`${wallets.balance} + ${amount} <= ${MAX_BALANCE_BASE}`)
  if (!credit) conditions.push(gte(wallets.balance, -amount))

  const [row] = await tx
    .update(wallets)
    .set({ balance: sql`${wallets.balance} + ${amount}`, updatedAt: sql`clock_timestamp()` })
    .where(and(...conditions))
    .returning({ balance: wallets.balance })

  if (!row) {
    const [w] = await tx.select({ frozen: wallets.frozen, balance: wallets.balance }).from(wallets).where(eq(wallets.customerId, entry.customerId))
    if (respectFreeze && w?.frozen) throw new WalletError("FROZEN", "المحفظة مجمّدة مؤقتاً. تواصل مع خدمة العملاء.")
    if (!credit) throw new WalletError("INSUFFICIENT", "الرصيد غير كافٍ.")
    throw new WalletError("LIMIT", "هذه العملية تتجاوز الحد الأقصى المسموح لرصيد المحفظة.")
  }

  const [txn] = await tx
    .insert(walletTransactions)
    .values({
      customerId: entry.customerId,
      kind: entry.kind,
      amount,
      balanceAfter: row.balance,
      orderId: entry.orderId ?? null,
      topupId: entry.topupId ?? null,
      note: entry.note ?? null,
      reason: entry.reason ?? null,
      actor: entry.actor,
      idempotencyKey: entry.idempotencyKey ?? null,
      // بعد قفل صف المحفظة: الوقت يزداد مع ترتيب الحركات فيصح تدقيق السلسلة.
      createdAt: sql`clock_timestamp()`,
    })
    .returning({ id: walletTransactions.id })
  return { id: txn.id, balance: row.balance }
}

export async function audit(tx: Tx | typeof db, customerId: string, action: string, actor: string, detail?: Record<string, unknown>) {
  await tx.insert(walletAuditLog).values({ customerId, action, actor, detail: detail ?? null })
}

/** يسجّل الحدث الأمني المرفق بخطأ محفظة (بعد تراجع المعاملة). لا يرمي أبداً. */
export async function auditBlocked(error: unknown): Promise<void> {
  if (!(error instanceof WalletError) || !error.auditEvent) return
  await audit(db, error.auditEvent.customerId, error.auditEvent.action, "system", error.auditEvent.detail).catch(() => {})
}

/** هل غيّر العميل رقمه مؤخراً؟ (فترة تهدئة للصرف من الرصيد). */
export async function inPhoneChangeCooldown(tx: Tx, customerId: string): Promise<boolean> {
  const [row] = await tx
    .select({ at: customerPhoneHistory.changedAt })
    .from(customerPhoneHistory)
    .where(and(eq(customerPhoneHistory.customerId, customerId), gte(customerPhoneHistory.changedAt, new Date(Date.now() - PHONE_CHANGE_COOLDOWN_MS))))
    .limit(1)
  return !!row
}

/**
 * خصم قيمة طلب من رصيد العميل (داخل معاملة إنشاء الطلب). الضوابط: تهدئة بعد تغيير الهاتف،
 * سقف صرف يومي، ثم الخصم الذري المشروط بالرصيد وعدم التجميد.
 */
export async function chargeOrder(tx: Tx, input: { customerId: string; orderId: string; orderNumber: string; amountBase: number }) {
  // قفل صف المحفظة أولاً حتى تتسلسل الطلبات المتزامنة لنفس العميل قبل فحص السقف اليومي.
  await tx.select({ id: wallets.customerId }).from(wallets).where(eq(wallets.customerId, input.customerId)).for("update")
  if (await inPhoneChangeCooldown(tx, input.customerId)) {
    throw new WalletError("COOLDOWN", "لأمان حسابك، لا يمكن الدفع من الرصيد خلال 24 ساعة من تغيير رقم الهاتف.", {
      customerId: input.customerId,
      action: "spend_blocked_cooldown",
      detail: { orderId: input.orderId },
    })
  }
  const [{ spent }] = await tx
    .select({ spent: sql<number>`coalesce(-sum(${walletTransactions.amount}), 0)::float8` })
    .from(walletTransactions)
    .where(
      and(
        eq(walletTransactions.customerId, input.customerId),
        eq(walletTransactions.kind, "order_payment"),
        gte(walletTransactions.createdAt, new Date(Date.now() - 24 * 3_600_000)),
      ),
    )
  if (spent + input.amountBase > DAILY_SPEND_LIMIT_BASE) {
    throw new WalletError("DAILY_LIMIT", "تجاوزت حد الصرف اليومي من الرصيد. اختر طريقة دفع أخرى أو حاول لاحقاً.", {
      customerId: input.customerId,
      action: "spend_blocked_daily_limit",
      detail: { orderId: input.orderId, spent },
    })
  }
  return applyEntry(tx, {
    customerId: input.customerId,
    kind: "order_payment",
    amount: -input.amountBase,
    actor: "customer",
    orderId: input.orderId,
    note: input.orderNumber,
    idempotencyKey: `order:${input.orderId}`,
  })
}

/** يعيد لمحفظة العميل ما دفعه من الرصيد لهذا الطلب (مرة واحدة فقط). يعيد المبلغ أو null إن لم يُدفع من الرصيد. */
export async function refundOrder(tx: Tx, input: { orderId: string; orderNumber: string; actor: string; reason: string }): Promise<number | null> {
  const [paid] = await tx
    .select({ customerId: walletTransactions.customerId, amount: walletTransactions.amount })
    .from(walletTransactions)
    .where(and(eq(walletTransactions.orderId, input.orderId), eq(walletTransactions.kind, "order_payment")))
    .limit(1)
  if (!paid) return null
  const [done] = await tx
    .select({ id: walletTransactions.id })
    .from(walletTransactions)
    .where(and(eq(walletTransactions.orderId, input.orderId), eq(walletTransactions.kind, "order_refund")))
    .limit(1)
  if (done) return null
  const amount = -paid.amount
  await applyEntry(tx, {
    customerId: paid.customerId,
    kind: "order_refund",
    amount,
    actor: input.actor,
    orderId: input.orderId,
    note: input.orderNumber,
    reason: input.reason,
    idempotencyKey: `refund:${input.orderId}`,
  })
  return amount
}
