"use server"

import { revalidatePath, revalidateTag } from "next/cache"
import { requireWriteClient } from "@/sanity/write-client"
import { SANITY_TAGS } from "@/sanity/cache-tags"
import { assertManageAuthenticated } from "@/lib/manage-auth"

// ============================================
// إجراءات حسابات الدفع في لوحة /manage
// - كل الكتابة والرفع تتم على الخادم بتوكن مشروع المحتوى (SANITY_API_TOKEN).
// - التوكن لا يُرسل إلى المتصفح إطلاقاً.
// - كل إجراء يتحقق من جلسة مدير اللوحة أولاً (وليس على مستوى الواجهة فقط).
// ============================================

/** أنواع الصور المسموحة لشعار الحساب — لا SVG ولا ملفات تنفيذية. */
const ALLOWED_LOGO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"])
const MAX_LOGO_BYTES = 3 * 1024 * 1024

type ImageRef = { _type: "image"; asset: { _type: "reference"; _ref: string } }

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

/** يرفع شعار الحساب إلى مشروع المحتوى بعد التحقق من نوعه وحجمه. */
async function uploadLogo(form: FormData): Promise<ImageRef | undefined> {
  const file = form.get("image")
  if (!(file instanceof File) || file.size === 0) return undefined
  if (!ALLOWED_LOGO_TYPES.has(file.type)) {
    throw new Error("صيغة الصورة غير مدعومة. استخدم JPEG أو PNG أو WebP.")
  }
  if (file.size > MAX_LOGO_BYTES) {
    throw new Error("حجم الصورة كبير. اختر صورة أصغر من 3 ميجابايت.")
  }
  const client = requireWriteClient()
  const buffer = Buffer.from(await file.arrayBuffer())
  const asset = await client.assets.upload("image", buffer, { filename: file.name })
  return { _type: "image", asset: { _type: "reference", _ref: asset._id } }
}

/** إبطال كاش صفحة الدفع فوراً بعد أي تعديل على الحسابات. */
function revalidatePaymentAccounts() {
  revalidateTag(SANITY_TAGS.paymentAccounts, { expire: 0 })
  revalidatePath("/checkout")
  revalidatePath("/manage")
  revalidatePath("/manage/payment-accounts")
}

/** إضافة حساب دفع جديد أو تعديل حساب قائم. */
export async function savePaymentAccount(id: string | null, form: FormData) {
  await assertManageAuthenticated()
  const client = requireWriteClient()

  const providerName = str(form, "providerName", 80)
  const accountHolderName = str(form, "accountHolderName", 120)
  const accountNumber = str(form, "accountNumber", 60)

  if (!providerName) throw new Error("اسم مزوّد الدفع مطلوب.")
  if (!accountHolderName) throw new Error("اسم صاحب الحساب مطلوب.")
  if (!accountNumber) throw new Error("رقم الحساب مطلوب.")

  const image = await uploadLogo(form)
  const now = new Date().toISOString()

  const base = {
    providerName,
    accountDisplayName: str(form, "accountDisplayName", 120) ?? "",
    accountHolderName,
    // نص دائماً للحفاظ على الأصفار في بداية الرقم.
    accountNumber,
    instructions: str(form, "instructions", 600) ?? "",
    isActive: form.get("isActive") !== "false",
    sortOrder: intOrZero(form, "sortOrder"),
    updatedAt: now,
  }

  if (id) {
    const patch = client.patch(id).set(image ? { ...base, image } : base)
    await patch.commit()
  } else {
    await client.create({
      _type: "paymentAccount",
      ...base,
      ...(image ? { image } : {}),
      createdAt: now,
    })
  }

  revalidatePaymentAccounts()
}

/** تفعيل أو تعطيل حساب دفع. الحساب المعطّل يختفي من خيارات العملاء فقط. */
export async function togglePaymentAccount(id: string, isActive: boolean) {
  await assertManageAuthenticated()
  const client = requireWriteClient()
  if (!id) throw new Error("معرّف الحساب مطلوب.")

  await client
    .patch(id)
    .set({ isActive: Boolean(isActive), updatedAt: new Date().toISOString() })
    .commit()
  revalidatePaymentAccounts()
}

/** تغيير ترتيب ظهور حساب دفع. */
export async function updatePaymentAccountOrder(id: string, sortOrder: number) {
  await assertManageAuthenticated()
  const client = requireWriteClient()
  if (!id) throw new Error("معرّف الحساب مطلوب.")

  const value = Number.isFinite(sortOrder) ? Math.min(9999, Math.max(0, Math.round(sortOrder))) : 0
  await client.patch(id).set({ sortOrder: value, updatedAt: new Date().toISOString() }).commit()
  revalidatePaymentAccounts()
}

/**
 * حذف حساب دفع نهائياً.
 * لا يؤثر على الطلبات السابقة لأنها تحفظ Snapshot ثابتاً من بيانات الحساب.
 */
export async function deletePaymentAccount(id: string) {
  await assertManageAuthenticated()
  const client = requireWriteClient()
  if (!id) throw new Error("معرّف الحساب مطلوب.")

  await client.delete(id)
  revalidatePaymentAccounts()
}

/** إزالة صورة الحساب دون حذف الحساب. */
export async function removePaymentAccountImage(id: string) {
  await assertManageAuthenticated()
  const client = requireWriteClient()
  if (!id) throw new Error("معرّف الحساب مطلوب.")

  await client.patch(id).unset(["image"]).set({ updatedAt: new Date().toISOString() }).commit()
  revalidatePaymentAccounts()
}
