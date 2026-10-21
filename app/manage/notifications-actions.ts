"use server"

import { revalidatePath, revalidateTag } from "next/cache"
import { z } from "zod"
import { assertManageAuthenticated, getManageSessionUser } from "@/lib/manage-auth"
import { NOTIFICATION_TAGS } from "@/sanity/notifications/cache-tags"
import { sanitizeInternalLink } from "@/sanity/notifications/internal-link"
import { IMAGE_ASSET_USAGE_COUNT } from "@/sanity/notifications/queries"
import {
  NOTIFICATION_LIMITS,
  NOTIFICATION_PRIORITIES,
  NOTIFICATION_STATUSES,
  type NotificationActionResult,
} from "@/sanity/notifications/types"
import { requireNotificationsWriteClient } from "@/sanity/notifications/write-client"

// ============================================
// إجراءات الإشعارات في لوحة /manage
//
// قواعد أمنية ثابتة في كل إجراء:
//   1. التحقق من جلسة مدير اللوحة أولاً (assertManageAuthenticated).
//   2. التحقق من كل البيانات بـ Zod — لا نثق ببيانات الواجهة إطلاقاً.
//   3. projectId/dataset/token تُقرأ من متغيرات الخادم فقط،
//      ولا تُقبل من العميل بأي شكل.
//   4. الكتابة كلها هنا على الخادم؛ التوكن لا يُرسل للمتصفح أبداً.
//   5. لا نطبع التوكن ولا أي إعداد حسّاس في السجلات.
// ============================================

/** أنواع الصور المسموحة — لا SVG (يمكن أن يحمل سكربت) ولا ملفات تنفيذية. */
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"])
const MAX_IMAGE_BYTES = 4 * 1024 * 1024

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

const idSchema = z.string().trim().min(1, "معرّف الإشعار مطلوب").max(200)

type ImageRef = { _type: "image"; asset: { _type: "reference"; _ref: string } }

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
    console.error("[v0] notification action failed:", message)
    return { ok: false, error: message }
  }
}

/** يرفع صورة الإشعار إلى أصول مشروع الإشعارات وحده. */
async function uploadNotificationImage(form: FormData): Promise<ImageRef | undefined> {
  const file = form.get("image")
  if (!(file instanceof File) || file.size === 0) return undefined

  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    throw new Error("صيغة الصورة غير مدعومة. استخدم JPEG أو PNG أو WebP أو AVIF.")
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error("حجم الصورة كبير. اختر صورة أصغر من 4 ميجابايت.")
  }

  const client = requireNotificationsWriteClient()
  const buffer = Buffer.from(await file.arrayBuffer())
  const asset = await client.assets.upload("image", buffer, {
    filename: file.name || "notification-image",
  })
  return { _type: "image", asset: { _type: "reference", _ref: asset._id } }
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
 * لا تُعاد رسالة نجاح إلا بعد نجاح الكتابة فعلياً في مشروع الإشعارات.
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

    const client = requireNotificationsWriteClient()
    const image = await uploadNotificationImage(form)
    const now = new Date().toISOString()
    const currentUser = await getManageSessionUser()

    const base = {
      title: data.title,
      body: data.body,
      status: data.status,
      priority: data.priority,
      publishedAt: new Date(data.publishedAt).toISOString(),
      updatedAt: now,
    }

    if (id) {
      const validId = idSchema.parse(id)
      const patch = client.patch(validId).set({
        ...base,
        ...(image ? { image } : {}),
        ...(data.link ? { link: data.link } : {}),
        ...(data.expiresAt ? { expiresAt: new Date(data.expiresAt).toISOString() } : {}),
      })
      // إزالة الحقول الاختيارية التي أفرغها المدير.
      const unset: string[] = []
      if (!data.link) unset.push("link")
      if (!data.expiresAt) unset.push("expiresAt")
      await (unset.length ? patch.unset(unset) : patch).commit()
    } else {
      await client.create({
        _type: "notification",
        ...base,
        ...(image ? { image } : {}),
        ...(data.link ? { link: data.link } : {}),
        ...(data.expiresAt ? { expiresAt: new Date(data.expiresAt).toISOString() } : {}),
        createdBy: currentUser ?? "",
        createdAt: now,
      })
    }

    revalidateNotifications()

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
    const validId = idSchema.parse(id)
    const client = requireNotificationsWriteClient()
    const now = new Date().toISOString()

    const current = await client.fetch<{ publishedAt?: string | null; expiresAt?: string | null } | null>(
      /* groq */ `*[_type == "notification" && _id == $id][0]{ publishedAt, expiresAt }`,
      { id: validId },
    )
    if (!current) throw new Error("الإشعار غير موجود.")

    // إن كان النشر مجدولاً للمستقبل نُقدّمه للآن ليظهر مباشرة.
    const keepScheduled =
      current.publishedAt && new Date(current.publishedAt).getTime() <= Date.now()
    const publishedAt = keepScheduled ? (current.publishedAt as string) : now

    if (current.expiresAt && new Date(current.expiresAt).getTime() <= new Date(publishedAt).getTime()) {
      throw new Error("تاريخ الانتهاء أصبح قبل وقت النشر. عدّل تاريخ الانتهاء أولاً.")
    }

    await client.patch(validId).set({ status: "published", publishedAt, updatedAt: now }).commit()
    revalidateNotifications()
    return "تم نشر الإشعار وهو ظاهر للعملاء الآن"
  })
}

/** إلغاء النشر وإعادة الإشعار إلى مسودة (يختفي عن العملاء). */
export async function unpublishNotification(id: string): Promise<NotificationActionResult> {
  return run(async () => {
    await assertManageAuthenticated()
    const validId = idSchema.parse(id)
    const client = requireNotificationsWriteClient()

    await client
      .patch(validId)
      .set({ status: "draft", updatedAt: new Date().toISOString() })
      .commit()
    revalidateNotifications()
    return "تم إلغاء النشر وإعادة الإشعار إلى مسودة"
  })
}

/** أرشفة الإشعار — يختفي عن العملاء ويبقى في اللوحة. */
export async function archiveNotification(id: string): Promise<NotificationActionResult> {
  return run(async () => {
    await assertManageAuthenticated()
    const validId = idSchema.parse(id)
    const client = requireNotificationsWriteClient()

    await client
      .patch(validId)
      .set({ status: "archived", updatedAt: new Date().toISOString() })
      .commit()
    revalidateNotifications()
    return "تم أرشفة الإشعار وأصبح مخفياً عن العملاء"
  })
}

/**
 * حذف مستند الإشعار فقط.
 * - لا حذف جماعي للأصول.
 * - لا نحذف صورة مشتركة مع مستند إشعار آخر؛ ونتجاهل فشل حذف الأصل
 *   حتى لا يفشل حذف الإشعار نفسه.
 */
export async function deleteNotification(id: string): Promise<NotificationActionResult> {
  return run(async () => {
    await assertManageAuthenticated()
    const validId = idSchema.parse(id)
    const client = requireNotificationsWriteClient()

    const current = await client.fetch<{ assetRef?: string | null } | null>(
      /* groq */ `*[_type == "notification" && _id == $id][0]{ "assetRef": image.asset._ref }`,
      { id: validId },
    )

    await client.delete(validId)

    const assetRef = current?.assetRef
    if (assetRef) {
      try {
        const stillUsed = await client.fetch<number>(IMAGE_ASSET_USAGE_COUNT, {
          id: validId,
          assetRef,
        })
        if (stillUsed === 0) await client.delete(assetRef)
      } catch {
        // الأصل غير المستخدم يبقى في المشروع — لا يؤثر على العملاء.
      }
    }

    revalidateNotifications()
    return "تم حذف الإشعار"
  })
}
