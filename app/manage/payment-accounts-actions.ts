"use server"

import { revalidatePath, revalidateTag } from "next/cache"
import { eq } from "drizzle-orm"
import { CACHE_TAGS } from "@/lib/cache-tags"
import { db } from "@/lib/db/client"
import { paymentAccounts } from "@/lib/db/store"
import { assertManagePermission } from "@/lib/manage-auth"
import { newImageKey, removeObjects, uuidParam } from "@/lib/manage-helpers"

function str(form: FormData, key: string, max = 300): string | undefined {
  const value = form.get(key)
  if (typeof value !== "string") return undefined
  const trimmed = value.trim().slice(0, max)
  return trimmed.length ? trimmed : undefined
}

function intOrZero(form: FormData, key: string): number {
  const raw = str(form, key, 10)
  if (!raw) return 0
  const n = Number(raw)
  if (!Number.isFinite(n)) return 0
  return Math.min(9999, Math.max(0, Math.round(n)))
}

function revalidatePaymentAccounts() {
  revalidateTag(CACHE_TAGS.paymentAccounts, { expire: 0 })
  revalidatePath("/checkout")
  revalidatePath("/manage")
  revalidatePath("/manage/payment-accounts")
}

export async function savePaymentAccount(id: string | null, form: FormData) {
  await assertManagePermission("payment-accounts")

  const providerName = str(form, "providerName", 80)
  const accountHolderName = str(form, "accountHolderName", 120)
  const accountNumber = str(form, "accountNumber", 60)
  if (!providerName) throw new Error("اسم مزوّد الدفع مطلوب.")
  if (!accountHolderName) throw new Error("اسم صاحب الحساب مطلوب.")
  if (!accountNumber) throw new Error("رقم الحساب مطلوب.")

  const imageKey = newImageKey(form, "imageKey")
  const accountId = id ? uuidParam(id, "معرّف الحساب غير صالح.") : null

  const values = {
    providerName,
    accountDisplayName: str(form, "accountDisplayName", 120) ?? null,
    accountHolderName,
    accountNumber,
    instructions: str(form, "instructions", 600) ?? null,
    isActive: form.get("isActive") !== "false",
    sortOrder: intOrZero(form, "sortOrder"),
    updatedAt: new Date(),
  }

  let oldImage: string | null = null
  if (accountId) {
    const [existing] = await db.select().from(paymentAccounts).where(eq(paymentAccounts.id, accountId)).limit(1)
    if (!existing) throw new Error("الحساب غير موجود.")
    await db.update(paymentAccounts).set({ ...values, ...(imageKey ? { imageKey } : {}) }).where(eq(paymentAccounts.id, accountId))
    if (imageKey && existing.imageKey !== imageKey) oldImage = existing.imageKey
  } else {
    await db.insert(paymentAccounts).values({ ...values, imageKey: imageKey ?? null })
  }

  revalidatePaymentAccounts()
  await removeObjects([oldImage])
}

export async function togglePaymentAccount(id: string, isActive: boolean) {
  await assertManagePermission("payment-accounts")
  const accountId = uuidParam(id, "معرّف الحساب مطلوب.")
  await db.update(paymentAccounts).set({ isActive: Boolean(isActive), updatedAt: new Date() }).where(eq(paymentAccounts.id, accountId))
  revalidatePaymentAccounts()
}

export async function updatePaymentAccountOrder(id: string, sortOrder: number) {
  await assertManagePermission("payment-accounts")
  const accountId = uuidParam(id, "معرّف الحساب مطلوب.")
  const value = Number.isFinite(sortOrder) ? Math.min(9999, Math.max(0, Math.round(sortOrder))) : 0
  await db.update(paymentAccounts).set({ sortOrder: value, updatedAt: new Date() }).where(eq(paymentAccounts.id, accountId))
  revalidatePaymentAccounts()
}

export async function deletePaymentAccount(id: string) {
  await assertManagePermission("payment-accounts")
  const accountId = uuidParam(id, "معرّف الحساب مطلوب.")
  const [existing] = await db.select().from(paymentAccounts).where(eq(paymentAccounts.id, accountId)).limit(1)
  if (!existing) return
  await db.delete(paymentAccounts).where(eq(paymentAccounts.id, accountId))
  revalidatePaymentAccounts()
  await removeObjects([existing.imageKey])
}

export async function removePaymentAccountImage(id: string) {
  await assertManagePermission("payment-accounts")
  const accountId = uuidParam(id, "معرّف الحساب مطلوب.")
  const [existing] = await db.select().from(paymentAccounts).where(eq(paymentAccounts.id, accountId)).limit(1)
  if (!existing) return
  await db.update(paymentAccounts).set({ imageKey: null, updatedAt: new Date() }).where(eq(paymentAccounts.id, accountId))
  revalidatePaymentAccounts()
  await removeObjects([existing.imageKey])
}
