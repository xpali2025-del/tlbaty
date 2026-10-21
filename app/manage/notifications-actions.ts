"use server"

import { revalidatePath, revalidateTag } from "next/cache"
import { eq } from "drizzle-orm"
import { z } from "zod"
import { db } from "@/lib/db/client"
import { notifications } from "@/lib/db/store"
import { assertManageAuthenticated, getManageSessionUser } from "@/lib/manage-auth"
import { newImageKey, removeObjects, uuidParam } from "@/lib/manage-helpers"
import { sanitizeInternalLink } from "@/lib/notification-link"
import {
  NOTIFICATION_LIMITS,
  NOTIFICATION_PRIORITIES,
  NOTIFICATION_STATUSES,
  type NotificationActionResult,
} from "@/lib/notification-types"
import { NOTIFICATION_TAGS } from "@/lib/notifications"

// ============================================
// إجراءات الإشعارات في لوحة /manage
//
// قواعد أمنية ثابتة في كل إجراء:
//   1. التحقق من جلسة مدير اللوحة أولاً (assertManageAuthenticated).
//   2. التحقق من كل البيانات بـ Zod — لا نثق ببيانات الواجهة إطلاقاً.
//   3. الصورة تصل كمفتاح R2 مرفوع مسبقاً من المتصفح (يُتحقق من مجلده).
//   4. لا نطبع أي إعداد حسّاس في السجلات.
// ============================================

/** يزيل محارف التحكّم ووسوم HTML من النص — نحفظ نصاً عادياً فقط. */
function toPlainText(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/<[^>]*>/g, "")
    .trim()
}

const isoDate = z
  .string()
  .trim()
  .min(1)
  .refine((v) => !Number.isNaN(new Date(v).getTime()), "تاريخ غير صالح")

/** مخطط التحقق من نموذج الإشعار. */
const notificationSchema = z
  .object({
    title: z
      .string()
      .transform(toPlainText)
      .pipe(
        z
          .string()
          .min(NOTIFICATION_LIMITS.titleMin, "العنوان قصير جداً")
          .max(NOTIFICATION_LIMITS.titleMax, "العنوان طويل جداً"),
      ),
    body: z
      .string()
      .transform(toPlainText)
      .pipe(
        z
          .string()
          .min(NOTIFICATION_LIMITS.bodyMin, "نص الإشعار قصير جداً")
          .max(NOTIFICATION_LIMITS.bodyMax, "نص الإشعار طويل جداً"),
      ),
    link: z
      .string()
      .optional()
      .transform((v) => (v && v.trim() ? v.trim() : undefined))
      .refine((v) => v === undefined || sanitizeInternalLink(v) !== null, {
        message: "الرابط يجب أن يكون مساراً داخلياً يبدأ بـ / (الروابط الخارجية وjavascript: مرفوضة)",
      })
      .transform((v) => (v === undefined ? undefined : (sanitizeInternalLink(v) as string))),
    status: z.enum(NOTIFICATION_STATUSES),
    priority: z.enum(NOTIFICATION_PRIORITIES),
    publishedAt: isoDate,
    expiresAt: isoDate.optional(),
  })
  .refine(
    (data) =>
      !data.expiresAt || new Date(data.expiresAt).getTime() > new Date(data.publishedAt).getTime(),
    { message: "تاريخ الانتهاء يجب أن يكون بعد تاريخ النشر", path: ["expiresAt"] },
  )

/** يستخرج قيمة نصية من FormData بأمان. */
function field(form: FormData, key: string): string | undefined {
  const value = form.get(key)
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed.length ? trimmed : undefined
}

/** يحوّل خطأ Zod إلى رسالة عربية واحدة واضحة. */
function firstZodError(error: z.ZodError): string {
  return error.issues[0]?.message ?? "بيانات غير صالحة"
}

/** يغلّف كل إجراء برسالة خطأ آمنة بدل رمي استثناء غير معالج. */
async function run(fn: () => Promise<string>): Promise<NotificationActionResult> {
  try {
    const message = await fn()
    return { ok: true, message }
  } catch (error) {
    const message = error instanceof Error ? error.message : "تعذّر تنفيذ العملية"
    console.error("notification action failed:", message)
    return { ok: false, error: message }
  }
}

/**
 * إبطال الكاش فور أي تغيير:
 * شاشة العملاء + عدّاد الجرس + صفحات اللوحة.
 */
function revalidateNotifications() {
  revalidateTag(NOTIFICATION_TAGS.list, { expire: 0 })
  revalidateTag(NOTIFICATION_TAGS.summary, { expire: 0 })
  revalidatePath("/notifications")
  revalidatePath("/manage")
  revalidatePath("/manage/notifications")
}

/**
 * إنشاء إشعار جديد أو تعديل إشعار قائم.
 * لا تُعاد رسالة نجاح إلا بعد نجاح الكتابة فعلياً.
 */
export async function saveNotification(
  id: string | null,
  form: FormData,
): Promise<NotificationActionResult> {
  return run(async () => {
    await assertManageAuthenticated()

    const parsed = notificationSchema.safeParse({
      title: form.get("title") ?? "",
      body: form.get("body") ?? "",
      link: field(form, "link"),
      status: field(form, "status") ?? "draft",
      priority: field(form, "priority") ?? "normal",
      publishedAt: field(form, "publishedAt") ?? new Date().toISOString(),
      expiresAt: field(form, "expiresAt"),
    })
    if (!parsed.success) throw new Error(firstZodError(parsed.error))
    const data = parsed.data

    const imageKey = newImageKey(form, "imageKey")
    const values = {
      title: data.title,
      body: data.body,
      link: data.link ?? null,
      status: data.status,
      priority: data.priority,
      publishedAt: new Date(data.publishedAt),
      expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
      updatedAt: new Date(),
    }

    let oldImage: string | null = null
    if (id) {
      const notificationId = uuidParam(id, "معرّف الإشعار غير صالح")
      const [existing] = await db.select().from(notifications).where(eq(notifications.id, notificationId)).limit(1)
      if (!existing) throw new Error("الإشعار غير موجود.")
      await db
        .update(notifications)
        .set({ ...values, ...(imageKey ? { imageKey } : {}) })
        .where(eq(notifications.id, notificationId))
      if (imageKey && existing.imageKey !== imageKey) oldImage = existing.imageKey
    } else {
      const currentUser = await getManageSessionUser()
      await db.insert(notifications).values({ ...values, imageKey: imageKey ?? null, createdBy: currentUser ?? null })
    }

    revalidateNotifications()
    await removeObjects([oldImage])

    if (data.status === "published") {
      return id ? "تم تحديث الإشعار ونشره للعملاء" : "تم نشر الإشعار وهو ظاهر للعملاء الآن"
    }
    return id ? "تم تحديث الإشعار" : "تم حفظ الإشعار كمسودة"
  })
}

/** نشر إشعار موجود الآن (يجعله ظاهراً للعملاء فوراً). */
export async function publishNotification(id: string): Promise<NotificationActionResult> {
  return run(async () => {
    await assertManageAuthenticated()
    const notificationId = uuidParam(id, "معرّف الإشعار غير صالح")
    const now = new Date()

    const [current] = await db.select().from(notifications).where(eq(notifications.id, notificationId)).limit(1)
    if (!current) throw new Error("الإشعار غير موجود.")

    // إن كان النشر مجدولاً للمستقبل نُقدّمه للآن ليظهر مباشرة.
    const keepScheduled = current.publishedAt && current.publishedAt.getTime() <= now.getTime()
    const publishedAt = keepScheduled ? (current.publishedAt as Date) : now

    if (current.expiresAt && current.expiresAt.getTime() <= publishedAt.getTime()) {
      throw new Error("تاريخ الانتهاء أصبح قبل وقت النشر. عدّل تاريخ الانتهاء أولاً.")
    }

    await db
      .update(notifications)
      .set({ status: "published", publishedAt, updatedAt: now })
      .where(eq(notifications.id, notificationId))
    revalidateNotifications()
    return "تم نشر الإشعار وهو ظاهر للعملاء الآن"
  })
}

async function setStatus(id: string, status: "draft" | "archived", message: string): Promise<NotificationActionResult> {
  return run(async () => {
    await assertManageAuthenticated()
    const notificationId = uuidParam(id, "معرّف الإشعار غير صالح")
    const updated = await db
      .update(notifications)
      .set({ status, updatedAt: new Date() })
      .where(eq(notifications.id, notificationId))
      .returning({ id: notifications.id })
    if (updated.length === 0) throw new Error("الإشعار غير موجود.")
    revalidateNotifications()
    return message
  })
}

/** إلغاء النشر وإعادة الإشعار إلى مسودة (يختفي عن العملاء). */
export async function unpublishNotification(id: string): Promise<NotificationActionResult> {
  return setStatus(id, "draft", "تم إلغاء النشر وإعادة الإشعار إلى مسودة")
}

/** أرشفة الإشعار — يختفي عن العملاء ويبقى في اللوحة. */
export async function archiveNotification(id: string): Promise<NotificationActionResult> {
  return setStatus(id, "archived", "تم أرشفة الإشعار وأصبح مخفياً عن العملاء")
}

/** حذف الإشعار وصورته من R2 (نفس المفتاح لا يُشارَك بين إشعارين لأن كل رفع بمفتاح جديد). */
export async function deleteNotification(id: string): Promise<NotificationActionResult> {
  return run(async () => {
    await assertManageAuthenticated()
    const notificationId = uuidParam(id, "معرّف الإشعار غير صالح")
    const [existing] = await db.select().from(notifications).where(eq(notifications.id, notificationId)).limit(1)
    if (!existing) throw new Error("الإشعار غير موجود.")
    await db.delete(notifications).where(eq(notifications.id, notificationId))
    revalidateNotifications()
    await removeObjects([existing.imageKey])
    return "تم حذف الإشعار"
  })
}
