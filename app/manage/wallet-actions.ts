"use server"

import { revalidatePath } from "next/cache"
import { eq } from "drizzle-orm"
import { z } from "zod"
import { db } from "@/lib/db/client"
import { wallets } from "@/lib/db/store"
import { assertManagePermission, getManageSessionUser } from "@/lib/manage-auth"
import { findWalletDetail, getAdminWalletOverview, type AdminWalletDetail, type AdminWalletOverview } from "@/lib/admin-wallet"
import { applyEntry, audit } from "@/lib/wallet/ledger"
import { approveTopup, rejectTopup } from "@/lib/wallet/topups"
import { MAX_ADMIN_ADJUST_BASE, WalletError } from "@/lib/wallet/rules"

export type WalletActionResult<T = undefined> = ({ ok: true; message: string } & (T extends undefined ? object : { data: T })) | { ok: false; error: string }

const uuid = z.string().trim().uuid("معرّف غير صالح")

async function run<T = undefined>(fn: () => Promise<{ message: string; data?: T }>): Promise<WalletActionResult<T>> {
  try {
    const r = await fn()
    revalidatePath("/manage")
    return { ok: true, message: r.message, ...(r.data !== undefined ? { data: r.data } : {}) } as WalletActionResult<T>
  } catch (error) {
    if (error instanceof z.ZodError) return { ok: false, error: error.issues[0]?.message ?? "بيانات غير صالحة" }
    if (error instanceof WalletError) return { ok: false, error: error.message }
    console.error("wallet action failed:", error instanceof Error ? error.message : "unknown")
    return { ok: false, error: "تعذّر تنفيذ العملية" }
  }
}

const admin = async () => (await getManageSessionUser()) ?? "مدير"

export async function approveWalletTopup(topupId: string, confirmedAmount?: number) {
  return run(async () => {
    await assertManagePermission("wallets")
    const { credited } = await approveTopup(uuid.parse(topupId), await admin(), confirmedAmount)
    return { message: `تمت الموافقة وأُضيف ${Math.round(credited).toLocaleString("en-US")} إلى الرصيد` }
  })
}

export async function rejectWalletTopup(topupId: string, reason: string) {
  return run(async () => {
    await assertManagePermission("wallets")
    await rejectTopup(uuid.parse(topupId), await admin(), z.string().max(500).parse(reason))
    return { message: "تم رفض الطلب" }
  })
}

/** تعديل يدوي: سبب إلزامي، سقف للعملية، وكل شيء في الدفتر باسم المدير. */
export async function adjustWallet(customerId: string, direction: "credit" | "debit", amountBase: number, reason: string) {
  return run(async () => {
    await assertManagePermission("wallets")
    const id = uuid.parse(customerId)
    const amount = z.number().positive("المبلغ يجب أن يكون موجباً").max(MAX_ADMIN_ADJUST_BASE, `أقصى تعديل في العملية الواحدة ${MAX_ADMIN_ADJUST_BASE.toLocaleString("en-US")}`).parse(amountBase)
    const why = z.string().trim().min(5, "اكتب سبب التعديل (5 أحرف على الأقل)").max(500).parse(reason)
    const by = await admin()
    await db.transaction(async (tx) => {
      const { balance } = await applyEntry(tx, {
        customerId: id,
        kind: direction === "credit" ? "admin_credit" : "admin_debit",
        amount: direction === "credit" ? amount : -amount,
        actor: by,
        reason: why,
        note: direction === "credit" ? "إضافة من الإدارة" : "خصم من الإدارة",
      })
      await audit(tx, id, direction === "credit" ? "admin_credit" : "admin_debit", by, { amount, reason: why, balance })
    })
    return { message: direction === "credit" ? "تمت إضافة الرصيد" : "تم خصم الرصيد" }
  })
}

export async function setWalletFrozen(customerId: string, frozen: boolean, reason: string) {
  return run(async () => {
    await assertManagePermission("wallets")
    const id = uuid.parse(customerId)
    const why = z.string().trim().max(500).parse(reason)
    if (frozen && why.length < 3) throw new WalletError("INVALID", "اكتب سبب التجميد.")
    const by = await admin()
    await db.transaction(async (tx) => {
      await tx.insert(wallets).values({ customerId: id }).onConflictDoNothing()
      await tx.update(wallets).set({ frozen, frozenReason: frozen ? why : null, updatedAt: new Date() }).where(eq(wallets.customerId, id))
      await audit(tx, id, frozen ? "frozen" : "unfrozen", by, { reason: why })
    })
    return { message: frozen ? "تم تجميد المحفظة" : "تم فك التجميد" }
  })
}

export async function lookupWallet(query: string): Promise<WalletActionResult<AdminWalletDetail | null>> {
  return run(async () => {
    await assertManagePermission("wallets")
    const detail = await findWalletDetail(z.string().max(100).parse(query))
    return { message: detail ? "تم" : "لا يوجد عميل مطابق", data: detail }
  })
}

export async function refreshWalletOverview(): Promise<WalletActionResult<AdminWalletOverview>> {
  return run(async () => {
    await assertManagePermission("wallets")
    return { message: "تم التحديث", data: await getAdminWalletOverview() }
  })
}
