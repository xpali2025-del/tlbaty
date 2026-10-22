import "server-only"
import { and, count, eq, gt, gte, isNotNull, sql } from "drizzle-orm"
import { db } from "@/lib/db/client"
import { isDbConfigured } from "@/lib/db-cache"
import { coupons, customers, reminderLog } from "@/lib/db/store"
import { getReminderRules } from "@/lib/marketing/reminders"
import { DEFAULT_REMINDER_RULES, type ReminderKind, type ReminderRule } from "@/lib/marketing/rules"

export type AdminMarketing = {
  rules: Record<ReminderKind, ReminderRule>
  stats: {
    /** عملاء وافقوا على العروض (الوحيدون الذين تصلهم التذكيرات). */
    optedIn: number
    sentLast7Days: Record<ReminderKind, number>
    /** أكواد التذكير الصادرة وما استُعمل منها. */
    couponsIssued: number
    couponsUsed: number
  }
}

export const EMPTY_ADMIN_MARKETING: AdminMarketing = {
  rules: DEFAULT_REMINDER_RULES,
  stats: { optedIn: 0, sentLast7Days: { cart: 0, wishlist: 0 }, couponsIssued: 0, couponsUsed: 0 },
}

export async function getAdminMarketing(): Promise<AdminMarketing> {
  if (!isDbConfigured()) return EMPTY_ADMIN_MARKETING
  const week = new Date(Date.now() - 7 * 86_400_000)
  const [rules, [opt], sent, [issued]] = await Promise.all([
    getReminderRules(),
    db.select({ n: count() }).from(customers).where(and(eq(customers.marketingOptIn, true), eq(customers.status, "active"))),
    db.select({ kind: reminderLog.kind, n: count() }).from(reminderLog).where(gte(reminderLog.sentAt, week)).groupBy(reminderLog.kind),
    db
      .select({ issued: count(), used: sql<number>`count(*) filter (where ${coupons.usedCount} > 0)::int` })
      .from(coupons)
      .where(and(isNotNull(coupons.customerId), gt(coupons.maxUses, 0), sql`${coupons.description} like '%تذكير%'`)),
  ])
  const sentBy = new Map(sent.map((r) => [r.kind, r.n]))
  return {
    rules,
    stats: {
      optedIn: opt.n,
      sentLast7Days: { cart: sentBy.get("cart") ?? 0, wishlist: sentBy.get("wishlist") ?? 0 },
      couponsIssued: issued.issued,
      couponsUsed: issued.used,
    },
  }
}
