"use server"

import { revalidatePath } from "next/cache"
import { eq, sql } from "drizzle-orm"
import { z } from "zod"
import { db } from "@/lib/db/client"
import { couriers, orders } from "@/lib/db/store"
import { assertManageAuthenticated } from "@/lib/manage-auth"
import { COURIER_STATUSES } from "@/lib/courier"
import { newImageKey, removeObjects } from "@/lib/manage-helpers"

export type CourierActionResult = { ok: true; message: string } | { ok: false; error: string }

const courierSchema = z.object({
  name: z.string().trim().min(2, "اسم المندوب مطلوب").max(100, "اسم المندوب طويل جداً"),
  phone: z
    .string()
    .trim()
    .max(30, "رقم الهاتف طويل جداً")
    .refine((v) => v === "" || /^[\d٠-٩۰-۹+\-() ]{6,}$/.test(v), { message: "رقم الهاتف غير صالح" }),
  cities: z.array(z.string().trim().min(1).max(80)).max(60, "عدد المدن كبير جداً"),
  status: z.enum(COURIER_STATUSES),
  adminNote: z.string().trim().max(1000, "الملاحظات طويلة جداً"),
})

const idSchema = z.string().trim().uuid("معرّف المندوب غير صالح")

function firstZodError(error: z.ZodError): string {
  return error.issues[0]?.message ?? "بيانات غير صالحة"
}

async function run(fn: () => Promise<string>): Promise<CourierActionResult> {
  try {
    return { ok: true, message: await fn() }
  } catch (error) {
    if (error instanceof z.ZodError) return { ok: false, error: firstZodError(error) }
    const message = error instanceof Error ? error.message : "تعذّر تنفيذ العملية"
    console.error("courier action failed:", message)
    return { ok: false, error: message }
  }
}

function revalidateCouriers() {
  revalidatePath("/manage")
  revalidatePath("/manage/couriers")
}

/** "صنعاء، عدن\nتعز" ← قائمة مدن فريدة (حد أقصى 60). */
function parseCities(raw: unknown): string[] {
  if (typeof raw !== "string") return []
  const parts = raw
    .split(/[,\n،]/)
    .map((c) => c.trim())
    .filter(Boolean)
  return [...new Set(parts)].slice(0, 60)
}

function parseForm(form: FormData) {
  const parsed = courierSchema.safeParse({
    name: String(form.get("name") ?? ""),
    phone: String(form.get("phone") ?? ""),
    cities: parseCities(form.get("cities")),
    status: String(form.get("status") ?? "active"),
    adminNote: String(form.get("adminNote") ?? ""),
  })
  if (!parsed.success) throw new Error(firstZodError(parsed.error))
  return parsed.data
}

export async function createCourier(form: FormData): Promise<CourierActionResult> {
  return run(async () => {
    await assertManageAuthenticated()
    const data = parseForm(form)
    const imageKey = newImageKey(form, "imageKey")
    await db.insert(couriers).values({
      name: data.name,
      phone: data.phone || null,
      cities: data.cities,
      status: data.status,
      adminNote: data.adminNote || null,
      imageKey: imageKey ?? null,
    })
    revalidateCouriers()
    return "تمت إضافة المندوب"
  })
}

export async function updateCourier(id: string, form: FormData): Promise<CourierActionResult> {
  return run(async () => {
    await assertManageAuthenticated()
    const courierId = idSchema.parse(id)
    const data = parseForm(form)
    const imageKey = newImageKey(form, "imageKey")

    const [existing] = await db.select().from(couriers).where(eq(couriers.id, courierId)).limit(1)
    if (!existing) throw new Error("المندوب غير موجود.")
    await db
      .update(couriers)
      .set({
        name: data.name,
        phone: data.phone || null,
        cities: data.cities,
        status: data.status,
        adminNote: data.adminNote || null,
        ...(imageKey ? { imageKey } : {}),
      })
      .where(eq(couriers.id, courierId))

    revalidateCouriers()
    if (imageKey && existing.imageKey !== imageKey) await removeObjects([existing.imageKey])
    return "تم تحديث بيانات المندوب"
  })
}

export async function setCourierStatus(id: string, status: "active" | "suspended"): Promise<CourierActionResult> {
  return run(async () => {
    await assertManageAuthenticated()
    const courierId = idSchema.parse(id)
    if (!COURIER_STATUSES.includes(status)) throw new Error("حالة مندوب غير صالحة.")
    const updated = await db.update(couriers).set({ status }).where(eq(couriers.id, courierId)).returning({ id: couriers.id })
    if (!updated.length) throw new Error("المندوب غير موجود.")
    revalidateCouriers()
    return status === "active" ? "تم تفعيل المندوب" : "تم إيقاف المندوب"
  })
}

export async function deleteCourier(id: string): Promise<CourierActionResult> {
  return run(async () => {
    await assertManageAuthenticated()
    const courierId = idSchema.parse(id)

    // مرتبط بطلب إن وُجد ربط حيّ أو لقطة محفوظة باسمه.
    const [{ linked }] = await db
      .select({ linked: sql<number>`count(*)::int` })
      .from(orders)
      .where(sql`coalesce(${orders.courierSnapshot}->>'courierId', ${orders.courierId}::text) = ${courierId}`)
    if (linked > 0) {
      throw new Error(`لا يمكن حذف المندوب لأنه مرتبط بـ ${linked} طلب. أوقفه بدلاً من ذلك للحفاظ على سجل الطلبات.`)
    }

    const [existing] = await db.select().from(couriers).where(eq(couriers.id, courierId)).limit(1)
    if (!existing) throw new Error("المندوب غير موجود.")
    await db.delete(couriers).where(eq(couriers.id, courierId))
    revalidateCouriers()
    await removeObjects([existing.imageKey])
    return "تم حذف المندوب"
  })
}
