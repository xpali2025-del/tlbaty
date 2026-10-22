import "server-only"
import { desc, eq } from "drizzle-orm"
import { db } from "@/lib/db/client"
import { walletTopups, walletTransactions, wallets } from "@/lib/db/store"

export type WalletSummary = {
  balance: number
  frozen: boolean
  transactions: { id: string; kind: string; amount: number; balanceAfter: number; note: string | null; createdAt: string }[]
  topups: {
    id: string
    status: string
    amount: number
    currencyCode: string
    amountBase: number
    providerName: string | null
    reference: string
    rejectionReason: string | null
    createdAt: string
  }[]
}

export async function getBalance(customerId: string): Promise<{ balance: number; frozen: boolean }> {
  const [w] = await db.select({ balance: wallets.balance, frozen: wallets.frozen }).from(wallets).where(eq(wallets.customerId, customerId))
  return w ?? { balance: 0, frozen: false }
}

export async function getWalletSummary(customerId: string): Promise<WalletSummary> {
  const [bal, txns, topups] = await Promise.all([
    getBalance(customerId),
    db
      .select()
      .from(walletTransactions)
      .where(eq(walletTransactions.customerId, customerId))
      .orderBy(desc(walletTransactions.createdAt), desc(walletTransactions.id))
      .limit(50),
    db.select().from(walletTopups).where(eq(walletTopups.customerId, customerId)).orderBy(desc(walletTopups.createdAt)).limit(20),
  ])
  return {
    ...bal,
    transactions: txns.map((t) => ({
      id: t.id,
      kind: t.kind,
      amount: t.amount,
      balanceAfter: t.balanceAfter,
      // ملاحظة الحركة فقط؛ سبب الإدارة الداخلي لا يُعرض للعميل.
      note: t.note,
      createdAt: t.createdAt.toISOString(),
    })),
    topups: topups.map((t) => ({
      id: t.id,
      status: t.status,
      amount: t.amount,
      currencyCode: t.currencyCode,
      amountBase: t.amountBase,
      providerName: t.paymentAccountSnapshot?.providerName ?? null,
      reference: t.reference,
      rejectionReason: t.rejectionReason,
      createdAt: t.createdAt.toISOString(),
    })),
  }
}
