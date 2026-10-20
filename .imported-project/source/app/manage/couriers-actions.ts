"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { ordersClient } from "@/sanity/orders/client"
import { assertManageAuthenticated } from "@/lib/manage-auth"
import { COURIER_STATUSES } from "@/lib/courier"

// ============================================
// إجراءات المناديب — تُنفّذ على الخادم وحده.
//
// الحماية: كل إجراء يبدأ بـ assertManageAuthenticated (نفس حماية اللوحة)،
// وتوكن الكتابة يبقى في ordersClient على الخادم ولا يصل المتصفح إطلاقاً.
//
// لا يوجد إجراء حذف نهائي: المندوب المرتبط بطلبات يُوقف فقط
// حتى تبقى سجلات الطلبات القديمة سليمة.
// ============================================

export type CourierActionResult = { ok: true; message: string } | { ok: false; error: string }

const MAX_IMAGE_BYTES = 4 * 1024 * 1024
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"])

const courierSchema = z.object({
  name: z.string().trim().min(2, "اسم المندوب مطلوب").max(100, "اسم المندوب طويل جداً"),
  phone: z
    .string()
    .trim()
    .max(30, "رقم الهاتف طويل جداً")
    .refine((v) => v === "" || /^[\d\u0660-\u0669\u06f0-\u06f9+\-() ]{6,}$/.test(v), {
      message: "رقم الهاتف غير صالح",
    }),
  cities: z.array(z.string().trim().min(1).max(80)).max(60, "عدد المدن كبير جداً"),
  status: z.enum(COURIER_STATUSES),
  adminNote: z.string().trim().max(1000, "الملاحظات طويلة جداً"),
})

const idSchema = z.string().trim().min(1, "معرّف المندوب مطلوب").max(200)

function firstZodError(error: z.ZodError): string {
  return error.issues[0]?.message ?? "بيانات غير صالحة"
}

function requireOrdersClient() {
  if (!ordersClient) throw new Error("مشروع الطلبات غير مضبوط.")
  return ordersClient
}

async function run(fn: () => Promise<string>): Promise<CourierActionResult> {
  try {
    const message = await fn()
    return { ok: true, message }
  } catch (error) {
    const message = error instanceof Error ? error.message : "تعذّر تنفيذ العملية"
    console.error("[v0] courier action failed:", message)
    return { ok: false, error: message }
  }
}

function revalidateCouriers() {
  revalidatePath("/manage")
  revalidatePath("/manage/couriers")
}

/** يقرأ المدن من الحقل النصي: مفصولة بفاصلة أو سطر جديد، بلا تكرار. */
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

/** يرفع صورة المندوب إلى أصول مشروع الطلبات وحده. */
async function uploadCourierImage(form: FormData) {
  const file = form.get("image")
  if (!(file instanceof File) || file.size === 0) return undefined

  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    throw new Error("صيغة الصورة غير مدعومة. استخدم JPEG أو PNG أو WebP أو AVIF.")
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error("حجم الصورة كبير. اختر صورة أصغر من 4 ميجابايت.")
  }

  const client = requireOrdersClient()
  const buffer = Buffer.from(await file.arrayBuffer())
  const asset = await client.assets.upload("image", buffer, {
    filename: file.name || "courier-image",
  })
  return { _type: "image" as const, asset: { _type: "reference" as const, _ref: asset._id } }
}

/** إضافة مندوب جديد. */
export async function createCourier(form: FormData): Promise<CourierActionResult> {
  return run(async () => {
    await assertManageAuthenticated()
    const data = parseForm(form)
    const client = requireOrdersClient()
    const image = await uploadCourierImage(form)

    await client.create({
      _type: "courier",
      name: data.name,
      phone: data.phone || undefined,
      cities: data.cities,
      status: data.status,
      adminNote: data.adminNote || undefined,
      createdAt: new Date().toISOString(),
      ...(image ? { image } : {}),
    })

    revalidateCouriers()
    return "تمت إضافة المندوب"
  })
}

/** تعديل بيانات مندوب. الصورة تُستبدل فقط عند رفع صورة جديدة. */
export async function updateCourier(id: string, form: FormData): Promise<CourierActionResult> {
  return run(async () => {
    await assertManageAuthenticated()
    const courierId = idSchema.parse(id)
    const data = parseForm(form)
    const client = requireOrdersClient()
    const image = await uploadCourierImage(form)

    await client
      .patch(courierId)
      .set({
        name: data.name,
        phone: data.phone || undefined,
        cities: data.cities,
        status: data.status,
        adminNote: data.adminNote || undefined,
        ...(image ? { image } : {}),
      })
      .commit()

    revalidateCouriers()
    return "تم تحديث بيانات المندوب"
  })
}

/**
 * تفعيل المندوب أو إيقافه.
 * الإيقاف يمنع ظهوره عند تعيين طلبات جديدة، ويحفظ كل طلباته السابقة كما هي.
 */
export async function setCourierStatus(
  id: string,
  status: "active" | "suspended",
): Promise<CourierActionResult> {
  return run(async () => {
    await assertManageAuthenticated()
    const courierId = idSchema.parse(id)
    if (!COURIER_STATUSES.includes(status)) throw new Error("حالة مندوب غير صالحة.")

    const client = requireOrdersClient()
    await client.patch(courierId).set({ status }).commit()

    revalidateCouriers()
    return status === "active" ? "تم تفعيل المندوب" : "تم إيقاف المندوب"
  })
}

/**
 * حذف مندوب — مسموح فقط إذا لم يكن مرتبطاً بأي طلب.
 * إذا كان مرتبطاً بطلبات، نرفض الحذف ونطلب إيقافه بدلاً من ذلك.
 */
export async function deleteCourier(id: string): Promise<CourierActionResult> {
  return run(async () => {
    await assertManageAuthenticated()
    const courierId = idSchema.parse(id)
    const client = requireOrdersClient()

    const linked = await client.fetch<number>(
      `count(*[_type == "order" && coalesce(courierSnapshot.courierId, courier._ref) == $courierId])`,
      { courierId },
      { cache: "no-store" },
    )

    if (typeof linked === "number" && linked > 0) {
      throw new Error(
        `لا يمكن حذف المندوب لأنه مرتبط بـ ${linked} طلب. أوقفه بدلاً من ذلك للحفاظ على سجل الطلبات.`,
      )
    }

    await client.delete(courierId)
    revalidateCouriers()
    return "تم حذف المندوب"
  })
}
