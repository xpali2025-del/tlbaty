import "server-only"
import { and, count, desc, eq, gte, inArray, ilike, or, sql } from "drizzle-orm"
import { db } from "@/lib/db/client"
import { isDbConfigured } from "@/lib/db-cache"
import { customerPhoneHistory, customers, walletAuditLog, walletTopups, walletTransactions, wallets } from "@/lib/db/store"
import { DAILY_SPEND_LIMIT_BASE, LARGE_TOPUP_BASE } from "@/lib/wallet/rules"

// ============================================
// قراءة المحافظ للوحة الإدارة: ملخص، طلبات الشحن المعلّقة، وتنبيهات المراقبة ومطابقة الدفتر.
// ============================================

export type WalletAlert = {
  kind: "ledger_mismatch" | "ledger_chain" | "rejections" | "phone_change_balance" | "high_spend" | "frozen" | "referenced_on_order" | "large_topup"
  severity: "high" | "medium" | "info"
  customerId: string
  phone: string
  text: string
}

export type AdminTopup = {
  id: string
  customerId: string
  phone: string
  status: string
  amount: number
  currencyCode: string
  amountBase: number
  creditedAmountBase: number | null
  providerName: string | null
  accountNumber: string | null
  senderName: string
  senderPhone: string
  reference: string
  referenceUsedOnOrder: boolean
  large: boolean
  rejectionReason: string | null
  reviewedBy: string | null
  reviewedAt: string | null
  createdAt: string
}

export type AdminWalletOverview = {
  totals: { wallets: number; liability: number; frozen: number; pendingCount: number; pendingSum: number }
  pending: AdminTopup[]
  recent: AdminTopup[]
  alerts: WalletAlert[]
}

export type AdminWalletDetail = {
  customerId: string
  publicId: string
  phone: string
  customerStatus: string
  balance: number
  frozen: boolean
  frozenReason: string | null
  ledgerSum: number
  consistent: boolean
  transactions: { id: string; kind: string; amount: number; balanceAfter: number; note: string | null; reason: string | null; actor: string; orderId: string | null; createdAt: string }[]
  topups: AdminTopup[]
  audit: { id: string; action: string; actor: string; detail: Record<string, unknown> | null; createdAt: string }[]
}

export const EMPTY_ADMIN_WALLETS: AdminWalletOverview = { totals: { wallets: 0, liability: 0, frozen: 0, pendingCount: 0, pendingSum: 0 }, pending: [], recent: [], alerts: [] }

async function phonesFor(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map()
  const rows = await db.select({ id: customers.id, phone: customers.phone }).from(customers).where(inArray(customers.id, [...new Set(ids)]))
  return new Map(rows.map((r) => [r.id, r.phone]))
}

function toTopup(t: typeof walletTopups.$inferSelect, phone: string): AdminTopup {
  return {
    id: t.id,
    customerId: t.customerId,
    phone,
    status: t.status,
    amount: t.amount,
    currencyCode: t.currencyCode,
    amountBase: t.amountBase,
    creditedAmountBase: t.creditedAmountBase,
    providerName: t.paymentAccountSnapshot?.providerName ?? null,
    accountNumber: t.paymentAccountSnapshot?.accountNumber ?? null,
    senderName: t.senderName,
    senderPhone: t.senderPhone,
    reference: t.reference,
    referenceUsedOnOrder: t.referenceUsedOnOrder,
    large: t.amountBase >= LARGE_TOPUP_BASE,
    rejectionReason: t.rejectionReason,
    reviewedBy: t.reviewedBy,
    reviewedAt: t.reviewedAt?.toISOString() ?? null,
    createdAt: t.createdAt.toISOString(),
  }
}

/** تنبيهات المراقبة: كل ما يستدعي نظرة بشرية. */
export async function computeAlerts(): Promise<WalletAlert[]> {
  const day = new Date(Date.now() - 24 * 3_600_000)
  const week = new Date(Date.now() - 7 * 24 * 3_600_000)

  const mismatch = await db
    .select({ customerId: wallets.customerId, balance: wallets.balance, ledger: sql<number>`coalesce(sum(${walletTransactions.amount}), 0)::float8` })
    .from(wallets)
    .leftJoin(walletTransactions, eq(walletTransactions.customerId, wallets.customerId))
    .groupBy(wallets.customerId, wallets.balance)
    .having(sql`abs(${wallets.balance} - coalesce(sum(${walletTransactions.amount}), 0)) > 0.005`)

  const run = db
    .select({
      customerId: walletTransactions.customerId,
      balanceAfter: walletTransactions.balanceAfter,
      running: sql<number>`sum(${walletTransactions.amount}) over (partition by ${walletTransactions.customerId} order by ${walletTransactions.createdAt}, ${walletTransactions.id})::float8`.as("running"),
    })
    .from(walletTransactions)
    .as("r")
  const chain = await db
    .select({ customerId: run.customerId, n: count() })
    .from(run)
    .where(sql`abs(${run.balanceAfter} - ${run.running}) > 0.005`)
    .groupBy(run.customerId)

  const rejections = await db
    .select({ customerId: walletTopups.customerId, n: count() })
    .from(walletTopups)
    .where(and(eq(walletTopups.status, "rejected"), gte(walletTopups.createdAt, week)))
    .groupBy(walletTopups.customerId)
    .having(sql`count(*) >= 2`)

  const phoneChange = await db
    .select({ customerId: wallets.customerId, balance: wallets.balance })
    .from(wallets)
    .innerJoin(customerPhoneHistory, and(eq(customerPhoneHistory.customerId, wallets.customerId), gte(customerPhoneHistory.changedAt, day)))
    .where(sql`${wallets.balance} > 0`)

  const spend = await db
    .select({ customerId: walletTransactions.customerId, spent: sql<number>`(-sum(${walletTransactions.amount}))::float8` })
    .from(walletTransactions)
    .where(and(eq(walletTransactions.kind, "order_payment"), gte(walletTransactions.createdAt, day)))
    .groupBy(walletTransactions.customerId)
    .having(sql`-sum(${walletTransactions.amount}) >= ${DAILY_SPEND_LIMIT_BASE * 0.5}`)

  const frozen = await db.select({ customerId: wallets.customerId, reason: wallets.frozenReason }).from(wallets).where(eq(wallets.frozen, true))

  const flaggedTopups = await db
    .select({ customerId: walletTopups.customerId, ref: walletTopups.referenceUsedOnOrder, amountBase: walletTopups.amountBase })
    .from(walletTopups)
    .where(and(eq(walletTopups.status, "pending"), or(eq(walletTopups.referenceUsedOnOrder, true), gte(walletTopups.amountBase, LARGE_TOPUP_BASE))))

  const ids = [
    ...mismatch.map((m) => m.customerId),
    ...chain.map((m) => m.customerId),
    ...rejections.map((m) => m.customerId),
    ...phoneChange.map((m) => m.customerId),
    ...spend.map((m) => m.customerId),
    ...frozen.map((m) => m.customerId),
    ...flaggedTopups.map((m) => m.customerId),
  ]
  const phones = await phonesFor(ids)
  const ph = (id: string) => phones.get(id) ?? "—"
  const out: WalletAlert[] = []
  for (const m of mismatch) out.push({ kind: "ledger_mismatch", severity: "high", customerId: m.customerId, phone: ph(m.customerId), text: `الرصيد (${m.balance}) لا يطابق مجموع الدفتر (${m.ledger}) — جمّد المحفظة وراجعها فوراً.` })
  for (const c of chain) out.push({ kind: "ledger_chain", severity: "high", customerId: c.customerId, phone: ph(c.customerId), text: `${c.n} حركة في الدفتر لا تتسلسل أرصدتها — احتمال تلاعب أو خلل.` })
  for (const r of rejections) out.push({ kind: "rejections", severity: "medium", customerId: r.customerId, phone: ph(r.customerId), text: `${r.n} طلبات شحن مرفوضة خلال 7 أيام — محاولات حوالات غير صحيحة.` })
  for (const p of phoneChange) out.push({ kind: "phone_change_balance", severity: "medium", customerId: p.customerId, phone: ph(p.customerId), text: "غيّر رقمه خلال 24 ساعة وفي محفظته رصيد (الصرف موقوف مؤقتاً) — تأكد أنه صاحب الحساب." })
  for (const s of spend) out.push({ kind: "high_spend", severity: "medium", customerId: s.customerId, phone: ph(s.customerId), text: `صرف ${Math.round(s.spent).toLocaleString("en-US")} خلال 24 ساعة (≥ نصف الحد اليومي).` })
  for (const t of flaggedTopups) {
    if (t.ref) out.push({ kind: "referenced_on_order", severity: "high", customerId: t.customerId, phone: ph(t.customerId), text: "طلب شحن معلّق برقم حوالة مستخدم في طلب شراء — راجعه بعناية." })
    if (t.amountBase >= LARGE_TOPUP_BASE) out.push({ kind: "large_topup", severity: "info", customerId: t.customerId, phone: ph(t.customerId), text: `طلب شحن كبير (${Math.round(t.amountBase).toLocaleString("en-US")}).` })
  }
  for (const f of frozen) out.push({ kind: "frozen", severity: "info", customerId: f.customerId, phone: ph(f.customerId), text: `محفظة مجمّدة${f.reason ? `: ${f.reason}` : ""}` })
  const rank = { high: 0, medium: 1, info: 2 } as const
  return out.sort((a, b) => rank[a.severity] - rank[b.severity])
}

export async function getAdminWalletOverview(): Promise<AdminWalletOverview> {
  if (!isDbConfigured()) return EMPTY_ADMIN_WALLETS
  const [[tot], [pend], pendingRows, recentRows, alerts] = await Promise.all([
    db
      .select({
        wallets: count(),
        liability: sql<number>`coalesce(sum(${wallets.balance}), 0)::float8`,
        frozen: sql<number>`count(*) filter (where ${wallets.frozen})::int`,
      })
      .from(wallets),
    db
      .select({ n: count(), sum: sql<number>`coalesce(sum(${walletTopups.amountBase}), 0)::float8` })
      .from(walletTopups)
      .where(eq(walletTopups.status, "pending")),
    db.select().from(walletTopups).where(eq(walletTopups.status, "pending")).orderBy(walletTopups.createdAt).limit(100),
    db.select().from(walletTopups).where(inArray(walletTopups.status, ["approved", "rejected"])).orderBy(desc(walletTopups.reviewedAt)).limit(30),
    computeAlerts(),
  ])
  const phones = await phonesFor([...pendingRows, ...recentRows].map((t) => t.customerId))
  return {
    totals: { wallets: tot.wallets, liability: tot.liability, frozen: tot.frozen, pendingCount: pend.n, pendingSum: pend.sum },
    pending: pendingRows.map((t) => toTopup(t, phones.get(t.customerId) ?? "—")),
    recent: recentRows.map((t) => toTopup(t, phones.get(t.customerId) ?? "—")),
    alerts,
  }
}

/** بحث عن عميل برقم هاتفه (أي جزء) أو معرّفه العام، مع محفظته وسجله الكامل. */
export async function findWalletDetail(query: string): Promise<AdminWalletDetail | null> {
  const q = query.trim()
  if (q.length < 3) return null
  const digits = q.replace(/\D/g, "")
  const [customer] = await db
    .select()
    .from(customers)
    .where(or(eq(customers.publicId, q), digits.length >= 3 ? ilike(customers.phone, `%${digits}%`) : undefined))
    .orderBy(customers.createdAt)
    .limit(1)
  if (!customer) return null
  const [wallet] = await db.select().from(wallets).where(eq(wallets.customerId, customer.id))
  const [txns, topups, audit, [sum]] = await Promise.all([
    db.select().from(walletTransactions).where(eq(walletTransactions.customerId, customer.id)).orderBy(desc(walletTransactions.createdAt), desc(walletTransactions.id)).limit(100),
    db.select().from(walletTopups).where(eq(walletTopups.customerId, customer.id)).orderBy(desc(walletTopups.createdAt)).limit(30),
    db.select().from(walletAuditLog).where(eq(walletAuditLog.customerId, customer.id)).orderBy(desc(walletAuditLog.createdAt)).limit(50),
    db.select({ s: sql<number>`coalesce(sum(${walletTransactions.amount}), 0)::float8` }).from(walletTransactions).where(eq(walletTransactions.customerId, customer.id)),
  ])
  const balance = wallet?.balance ?? 0
  return {
    customerId: customer.id,
    publicId: customer.publicId,
    phone: customer.phone,
    customerStatus: customer.status,
    balance,
    frozen: wallet?.frozen ?? false,
    frozenReason: wallet?.frozenReason ?? null,
    ledgerSum: sum.s,
    consistent: Math.abs(balance - sum.s) < 0.005,
    transactions: txns.map((t) => ({ id: t.id, kind: t.kind, amount: t.amount, balanceAfter: t.balanceAfter, note: t.note, reason: t.reason, actor: t.actor, orderId: t.orderId, createdAt: t.createdAt.toISOString() })),
    topups: topups.map((t) => toTopup(t, customer.phone)),
    audit: audit.map((a) => ({ id: a.id, action: a.action, actor: a.actor, detail: a.detail, createdAt: a.createdAt.toISOString() })),
  }
}
