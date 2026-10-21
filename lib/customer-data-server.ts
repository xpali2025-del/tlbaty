import "server-only"

import { eq } from "drizzle-orm"
import { z } from "zod"
import { db } from "@/lib/db/client"
import { customerData } from "@/lib/db/store"
import { EMPTY_CUSTOMER_DATA, MAX_RECENT, type CustomerData } from "@/lib/customer-data"

/** أقصى حجم لبيانات عميل واحد (نص JSON). أكبر منه يُرفض بدل أن يُخزَّن. */
export const MAX_CUSTOMER_DATA_BYTES = 120_000

const s = (max: number) => z.string().max(max)
const record = z.record(z.string().max(60), z.unknown())

const cartItem = z
  .object({
    productId: s(60).min(1),
    name: s(200),
    price: z.number().min(0).max(1_000_000_000),
    image: s(500),
    size: s(60),
    color: s(60),
    quantity: z.number().int().min(1).max(999),
  })
  .passthrough()

const withId = (extra: z.ZodRawShape) => z.object({ id: s(80).min(1), ...extra }).passthrough()

const schema = z.object({
  cart: z.array(cartItem).max(60).default([]),
  wishlist: z.array(withId({ name: s(200), price: z.number(), image: s(500) })).max(200).default([]),
  addresses: z
    .array(
      withId({
        customerName: s(200),
        phone: s(40),
        city: s(120),
        address: s(1000),
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        accuracy: z.number().min(0),
        locationCapturedAt: s(40),
        createdAt: s(40),
        updatedAt: s(40),
      }),
    )
    .max(20)
    .default([]),
  recentlyViewed: z.array(withId({ slug: s(200), name: s(200), price: z.number(), image: s(500) })).max(MAX_RECENT).default([]),
})

/** يتحقق من بيانات قادمة من المتصفح (لا نثق بها): الأنواع والأحجام وعدد العناصر. يرمي عند المخالفة. */
export function parseCustomerData(input: unknown): CustomerData {
  const raw = JSON.stringify(input ?? null)
  if (raw.length > MAX_CUSTOMER_DATA_BYTES) throw new Error("TOO_LARGE")
  const parsed = schema.parse(input) // ZodError عند الخطأ
  // record للتأكد من أن كل عنصر كائن عادي
  for (const list of Object.values(parsed)) for (const item of list) record.parse(item)
  return parsed as CustomerData
}

export async function getCustomerData(customerId: string): Promise<{ data: CustomerData; updatedAt: string | null }> {
  const [row] = await db.select().from(customerData).where(eq(customerData.customerId, customerId)).limit(1)
  if (!row) return { data: EMPTY_CUSTOMER_DATA, updatedAt: null }
  // قراءة متسامحة: صف قديم/تالف يعود فارغاً بدل أن يكسر الموقع.
  let data: CustomerData
  try {
    data = parseCustomerData(row.data)
  } catch {
    data = EMPTY_CUSTOMER_DATA
  }
  return { data, updatedAt: row.updatedAt.toISOString() }
}

export async function saveCustomerData(customerId: string, data: CustomerData): Promise<string> {
  const now = new Date()
  await db
    .insert(customerData)
    .values({ customerId, data: data as unknown as Record<string, unknown>, updatedAt: now })
    .onConflictDoUpdate({ target: customerData.customerId, set: { data: data as unknown as Record<string, unknown>, updatedAt: now } })
  return now.toISOString()
}
