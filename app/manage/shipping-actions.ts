"use server"

import { eq } from "drizzle-orm"
import { z } from "zod"
import { db } from "@/lib/db/client"
import { currencies, shippingMethods, shippingZones, siteSettings } from "@/lib/db/store"
import { assertManagePermission } from "@/lib/manage-auth"
import { revalidateStore, uniqueViolation, uuidParam } from "@/lib/manage-helpers"
import { BASE_CURRENCY_CODE } from "@/lib/currency"
import { YEMEN_GOVERNORATES } from "@/lib/yemen-governorates"

// إدارة العملات وطرق الشحن حسب المحافظة.
// أسعار المنتجات مخزّنة بالعملة الأساسية YER، لذلك لا تُحذف وسعرها 1 دائماً.

const currencySchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_]{1,11}$/, "رمز العملة غير صالح (حروف إنجليزية كبيرة وأرقام)"),
  name: z.string().trim().min(1, "اسم العملة مطلوب").max(60),
  symbol: z.string().trim().min(1, "رمز العرض مطلوب").max(12),
  rate: z.number().finite().positive("سعر الصرف يجب أن يكون أكبر من صفر").max(1_000_000),
})

export async function saveCurrencies(list: unknown, defaultCode: unknown): Promise<void> {
  await assertManagePermission("currencies")
  const parsed = z.array(currencySchema).min(1, "أضف عملة واحدة على الأقل").max(20).parse(list)
  const codes = parsed.map((c) => c.code)
  if (new Set(codes).size !== codes.length) throw new Error("رمز العملة مكرر")
  const base = parsed.find((c) => c.code === BASE_CURRENCY_CODE)
  if (!base) throw new Error(`العملة الأساسية ${BASE_CURRENCY_CODE} يجب أن تبقى موجودة`)
  if (base.rate !== 1) throw new Error(`سعر صرف العملة الأساسية ${BASE_CURRENCY_CODE} يجب أن يكون 1`)
  const def = z.string().parse(defaultCode)
  if (!codes.includes(def)) throw new Error("العملة الافتراضية غير موجودة في القائمة")

  await db.transaction(async (tx) => {
    // تاريخ «آخر تحديث» يتغير فقط للعملة التي تغيّر سعرها أو اسمها أو رمزها أو أُضيفت الآن،
    // فيعرف المدير متى حُدّث كل سعر فعلاً (لا كلما ضغط حفظ).
    const existing = new Map((await tx.select().from(currencies)).map((c) => [c.code, c]))
    const now = new Date()
    await tx.delete(currencies)
    await tx.insert(currencies).values(
      parsed.map((c, sortOrder) => {
        const old = existing.get(c.code)
        const unchanged = old && old.rate === c.rate && old.name === c.name && old.symbol === c.symbol
        return { ...c, sortOrder, updatedAt: unchanged ? old.updatedAt : now }
      }),
    )
    await tx
      .insert(siteSettings)
      .values({ id: 1, defaultCurrency: def })
      .onConflictDoUpdate({ target: siteSettings.id, set: { defaultCurrency: def, updatedAt: new Date() } })
  })
  revalidateStore()
}

const zoneSchema = z.object({
  governorate: z.string().trim().max(60).nullable(),
  isDefault: z.boolean(),
  methods: z
    .array(
      z.object({
        name: z.string().trim().min(1, "اسم طريقة التوصيل مطلوب").max(80),
        description: z.string().trim().max(200).default(""),
        price: z.number().int("السعر يجب أن يكون رقماً صحيحاً").min(0, "السعر لا يكون سالباً").max(100_000_000),
        icon: z.enum(["express", "standard", "pickup"]),
      }),
    )
    .min(1, "أضف طريقة توصيل واحدة على الأقل")
    .max(10),
})

export async function saveShippingZone(id: string | null, input: unknown): Promise<void> {
  await assertManagePermission("shipping")
  const zone = zoneSchema.parse(input)
  const governorate = zone.isDefault ? null : zone.governorate
  if (!zone.isDefault) {
    if (!governorate) throw new Error("اختر المحافظة أو اجعلها المنطقة الافتراضية")
    if (!(YEMEN_GOVERNORATES as readonly string[]).includes(governorate)) throw new Error("محافظة غير معروفة")
  }
  const zoneId = id ? uuidParam(id) : null

  try {
    await db.transaction(async (tx) => {
      let rowId = zoneId
      if (rowId) {
        const updated = await tx
          .update(shippingZones)
          .set({ governorate, isDefault: zone.isDefault, updatedAt: new Date() })
          .where(eq(shippingZones.id, rowId))
          .returning({ id: shippingZones.id })
        if (updated.length === 0) throw new Error("المنطقة غير موجودة")
        await tx.delete(shippingMethods).where(eq(shippingMethods.zoneId, rowId))
      } else {
        const [row] = await tx.insert(shippingZones).values({ governorate, isDefault: zone.isDefault }).returning({ id: shippingZones.id })
        rowId = row.id
      }
      await tx.insert(shippingMethods).values(zone.methods.map((m, sortOrder) => ({ ...m, description: m.description || null, zoneId: rowId as string, sortOrder })))
    })
  } catch (e) {
    const constraint = uniqueViolation(e)
    if (constraint !== null) {
      throw new Error(zone.isDefault ? "توجد منطقة افتراضية بالفعل" : "هذه المحافظة لها منطقة شحن بالفعل")
    }
    throw e
  }
  revalidateStore()
}

export async function deleteShippingZone(id: string): Promise<void> {
  await assertManagePermission("shipping")
  await db.delete(shippingZones).where(eq(shippingZones.id, uuidParam(id)))
  revalidateStore()
}
