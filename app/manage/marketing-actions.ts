"use server"

import { revalidatePath } from "next/cache"
import { assertManagePermission } from "@/lib/manage-auth"
import { db } from "@/lib/db/client"
import { reminderRules } from "@/lib/db/store"
import { getAdminMarketing, type AdminMarketing } from "@/lib/admin-marketing"
import { runReminders, type ReminderRunResult } from "@/lib/marketing/reminders"
import { REMINDER_KINDS, validateRule, type ReminderRule } from "@/lib/marketing/rules"

export type MarketingResult<T = undefined> = ({ ok: true; message: string } & (T extends undefined ? object : { data: T })) | { ok: false; error: string }

/** يحفظ قاعدة تذكير. التحقق كله على الخادم (لا نثق بتحقق الواجهة). */
export async function saveReminderRule(input: ReminderRule): Promise<MarketingResult> {
  try {
    await assertManagePermission("marketing")
    if (!REMINDER_KINDS.includes(input.kind)) return { ok: false, error: "نوع التذكير غير معروف" }
    const rule: ReminderRule = {
      kind: input.kind,
      enabled: input.enabled === true,
      delayHours: Number(input.delayHours),
      cooldownDays: Number(input.cooldownDays),
      title: String(input.title ?? "").trim(),
      body: String(input.body ?? "").trim(),
      discountType: input.discountType === "fixed" ? "fixed" : "percent",
      discountValue: Number(input.discountValue),
      minOrder: Number(input.minOrder),
      couponValidDays: Number(input.couponValidDays),
    }
    const problem = validateRule(rule)
    if (problem) return { ok: false, error: problem }
    const { kind, ...values } = rule
    await db
      .insert(reminderRules)
      .values({ kind, ...values })
      .onConflictDoUpdate({ target: reminderRules.kind, set: { ...values, updatedAt: new Date() } })
    revalidatePath("/manage")
    return { ok: true, message: rule.enabled ? "تم الحفظ والتذكير مفعّل" : "تم الحفظ (التذكير غير مفعّل)" }
  } catch (error) {
    console.error("saveReminderRule failed:", error instanceof Error ? error.message : "unknown")
    return { ok: false, error: "تعذّر الحفظ" }
  }
}

/** تشغيل فوري للقواعد المفعّلة (بدل انتظار المهمة اليومية). يرسل فعلاً للعملاء المستحقين. */
export async function runRemindersNow(): Promise<MarketingResult<{ result: ReminderRunResult; marketing: AdminMarketing }>> {
  try {
    await assertManagePermission("marketing")
    const result = await runReminders()
    revalidatePath("/manage")
    const sent = result.cart.sent + result.wishlist.sent
    return { ok: true, message: sent ? `أُرسل ${sent} تذكير` : "لا يوجد عملاء مستحقون الآن", data: { result, marketing: await getAdminMarketing() } }
  } catch (error) {
    console.error("runRemindersNow failed:", error instanceof Error ? error.message : "unknown")
    return { ok: false, error: "تعذّر تشغيل التذكيرات" }
  }
}
