import "server-only"
import { randomInt } from "node:crypto"
import { and, eq, gte, inArray, lte, sql } from "drizzle-orm"
import { db } from "@/lib/db/client"
import { coupons, customerData, customers, notifications, orders, products, reminderLog, reminderRules } from "@/lib/db/store"
import {
  DEFAULT_REMINDER_RULES,
  REMINDER_KINDS,
  describeDiscount,
  renderReminderText,
  type ReminderKind,
  type ReminderRule,
} from "./rules"

// ============================================
// التذكيرات التلقائية داخل الموقع (سلة متروكة / رغبات).
//
// يستهدف فقط عميلاً: وافق على العروض، حسابه نشط، سلته/رغباته لم تُلمس منذ مدة القاعدة (ولا أقدم من 30 يوماً)،
// لم يصله تذكير من النوع نفسه خلال فترة الانتظار، ولم يطلب بعد آخر تعديل (للسلة)، وفيها منتج متوفر.
// الناتج إشعار شخصي (يراه صاحبه فقط) وكود خصم فريد أحادي الاستعمال إن ضُبط خصم.
// ============================================

const DAY = 86_400_000
/** سلة/رغبات أقدم من هذا تُعتبر مهجورة تماماً ولا نزعج صاحبها بها. */
const MAX_AGE_DAYS = 30
export const REMINDERS_PER_RUN = 200
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789"

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

export async function getReminderRules(): Promise<Record<ReminderKind, ReminderRule>> {
  const rows = await db.select().from(reminderRules)
  const rules = { cart: { ...DEFAULT_REMINDER_RULES.cart }, wishlist: { ...DEFAULT_REMINDER_RULES.wishlist } }
  for (const r of rows) {
    if (r.kind === "cart" || r.kind === "wishlist") {
      rules[r.kind] = {
        kind: r.kind,
        enabled: r.enabled,
        delayHours: r.delayHours,
        cooldownDays: r.cooldownDays,
        title: r.title,
        body: r.body,
        discountType: r.discountType,
        discountValue: r.discountValue,
        minOrder: r.minOrder,
        couponValidDays: r.couponValidDays,
      }
    }
  }
  return rules
}

function randomCode(): string {
  let out = "TJ"
  for (let i = 0; i < 8; i++) out += CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)]
  return out
}

type Candidate = { customerId: string; items: unknown[] }

async function findCandidates(rule: ReminderRule, now: Date): Promise<Candidate[]> {
  const key = sql.raw(`'${rule.kind}'`) // ثابت من قائمتنا لا من مدخل خارجي
  const cutoff = new Date(now.getTime() - rule.delayHours * 3_600_000)
  const oldest = new Date(now.getTime() - MAX_AGE_DAYS * DAY)
  const cooldownStart = new Date(now.getTime() - rule.cooldownDays * DAY)
  const rows = await db
    .select({ customerId: customers.id, data: customerData.data })
    .from(customerData)
    .innerJoin(customers, eq(customers.id, customerData.customerId))
    .where(
      and(
        eq(customers.marketingOptIn, true),
        eq(customers.status, "active"),
        sql`jsonb_typeof(${customerData.data} -> ${key}) = 'array'`,
        sql`jsonb_array_length(${customerData.data} -> ${key}) > 0`,
        lte(customerData.updatedAt, cutoff),
        gte(customerData.updatedAt, oldest),
        sql`not exists (select 1 from ${reminderLog} l where l.customer_id = ${customers.id} and l.kind = ${rule.kind} and l.sent_at > ${cooldownStart.toISOString()}::timestamptz)`,
        // السلة: من طلب بعد آخر تعديل لسلته فلا معنى لتذكيره.
        rule.kind === "cart"
          ? sql`not exists (select 1 from ${orders} o where o.customer_id = ${customers.id} and o.created_at > ${customerData.updatedAt})`
          : sql`true`,
      ),
    )
    .orderBy(customerData.updatedAt)
    .limit(REMINDERS_PER_RUN)
  return rows.map((r) => ({ customerId: r.customerId, items: ((r.data as Record<string, unknown>)[rule.kind] as unknown[]) ?? [] }))
}

/** رقم المنتج واسمه من عنصر سلة (productId) أو رغبة (id). */
function itemRef(item: unknown): { number: string; name: string } | null {
  if (typeof item !== "object" || item === null) return null
  const o = item as Record<string, unknown>
  const number = typeof o.productId === "string" ? o.productId : typeof o.id === "string" ? o.id : ""
  const name = typeof o.name === "string" ? o.name : ""
  return number ? { number, name } : null
}

async function sendOne(tx: Tx, rule: ReminderRule, customerId: string, productName: string, now: Date): Promise<boolean> {
  // سجل واحد لكل (عميل، نوع، يوم): تشغيل المهمة مرتين لا يرسل مرتين.
  const [log] = await tx.insert(reminderLog).values({ customerId, kind: rule.kind }).onConflictDoNothing().returning({ id: reminderLog.id })
  if (!log) return false

  const expiresAt = new Date(now.getTime() + rule.couponValidDays * DAY)
  let code = ""
  let couponId: string | null = null
  if (rule.discountValue > 0) {
    for (let attempt = 0; attempt < 5 && !couponId; attempt++) {
      const candidate = randomCode()
      const [row] = await tx
        .insert(coupons)
        .values({
          code: candidate,
          discount: rule.discountValue,
          type: rule.discountType,
          minOrder: rule.minOrder,
          description: rule.kind === "cart" ? "كود تذكير السلة (شخصي)" : "كود تذكير الرغبات (شخصي)",
          customerId,
          expiresAt,
          maxUses: 1,
        })
        .onConflictDoNothing()
        .returning({ id: coupons.id })
      if (row) {
        couponId = row.id
        code = candidate
      }
    }
    if (!couponId) throw new Error("تعذّر توليد كود فريد")
    await tx.update(reminderLog).set({ couponId }).where(eq(reminderLog.id, log.id))
  }

  const vars = { product: productName, code, discount: describeDiscount(rule), days: rule.couponValidDays }
  await tx.insert(notifications).values({
    title: renderReminderText(rule.title, vars),
    body: renderReminderText(rule.body, vars),
    link: rule.kind === "cart" ? "/cart" : "/wishlist",
    status: "published",
    priority: "normal",
    publishedAt: now,
    // الإشعار يبقى ما بقي الكود صالحاً (أو أسبوعين إن لم يكن هناك كود).
    expiresAt: rule.discountValue > 0 ? expiresAt : new Date(now.getTime() + 14 * DAY),
    createdBy: "النظام",
    customerId,
    kind: `${rule.kind}_reminder`,
  })
  return true
}

export type ReminderRunResult = Record<ReminderKind, { enabled: boolean; sent: number; skipped: number }>

/** يشغّل القواعد المفعّلة. آمن للتكرار (سجل يومي فريد). */
export async function runReminders(now = new Date()): Promise<ReminderRunResult> {
  const rules = await getReminderRules()
  const result = {} as ReminderRunResult
  for (const kind of REMINDER_KINDS) {
    const rule = rules[kind]
    result[kind] = { enabled: rule.enabled, sent: 0, skipped: 0 }
    if (!rule.enabled) continue

    const candidates = await findCandidates(rule, now)
    // منتجات متوفرة فقط: لا نذكّر بما نفد (استعلام واحد لكل الدفعة).
    const numbers = [...new Set(candidates.flatMap((c) => c.items.map(itemRef).flatMap((r) => (r ? [r.number] : []))))]
    const inStock = new Set(
      numbers.length ? (await db.select({ n: products.productNumber }).from(products).where(and(inArray(products.productNumber, numbers), sql`${products.stock} > 0`))).map((r) => r.n) : [],
    )

    for (const c of candidates) {
      const available = c.items.map(itemRef).find((r): r is { number: string; name: string } => !!r && inStock.has(r.number))
      if (!available) {
        result[kind].skipped++
        continue
      }
      try {
        const sent = await db.transaction((tx) => sendOne(tx, rule, c.customerId, available.name, now))
        if (sent) result[kind].sent++
        else result[kind].skipped++
      } catch (error) {
        console.error("reminder failed:", error instanceof Error ? error.message : "unknown")
        result[kind].skipped++
      }
    }
  }
  return result
}
