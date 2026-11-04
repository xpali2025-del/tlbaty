import "server-only"
import { and, eq, inArray, lt } from "drizzle-orm"
import type { PgColumn, PgTable } from "drizzle-orm/pg-core"
import { db } from "@/lib/db/client"
import {
  ads,
  brands,
  categories,
  couriers,
  notifications,
  paymentAccounts,
  pendingUploads,
  productImages,
  products,
  reviews,
  siteSettings,
  slides,
} from "@/lib/db/store"
import { deleteImageObject } from "@/lib/storage/r2"

// الرفع المباشر إلى R2 يبدأ حين يختار المدير الصورة، قبل أن يضغط «حفظ». فقد يُرفع كائن ثم يُلغى النموذج
// أو يفشل الحفظ: هذا الملف يتتبّع هذه الكائنات حتى لا تبقى في التخزين بلا استعمال.
//   - عند توقيع رابط الرفع: يُسجَّل المفتاح (recordPendingUploads).
//   - عند نجاح أي حفظ يستعمله: يُزال من السجل (claimPendingUploads، تلقائياً عبر lib/upload-claims.ts).
//   - عند إلغاء المدير للنموذج: يُحذف الكائن وسجله (discardPendingUploads).
//   - التنظيف اليومي (purgePendingUploads): ما بقي في السجل أكثر من يوم ولا يشير إليه أي صف يُحذف.

/**
 * كل الأعمدة التي تحفظ مفتاح كائن في الحاوية العامة. التنظيف يتحقق منها قبل حذف أي كائن، فلا يُحذف أبداً
 * ملف يشير إليه صف حي حتى لو فات تسجيل المطالبة به. يحرسها اختبار يقارن القائمة بمخطط قاعدة البيانات (tests/pending-uploads.test.ts):
 * عموداً جديداً يحمل مفتاح صورة يجب أن يُضاف هنا.
 */
export const OBJECT_KEY_COLUMNS: { name: string; column: PgColumn }[] = [
  { name: "categories.image_key", column: categories.imageKey },
  { name: "brands.image_key", column: brands.imageKey },
  { name: "products.main_image_key", column: products.mainImageKey },
  { name: "product_images.image_key", column: productImages.imageKey },
  { name: "ads.image_key", column: ads.imageKey },
  { name: "ads.video_key", column: ads.videoKey },
  { name: "slides.image_key", column: slides.imageKey },
  { name: "reviews.avatar_key", column: reviews.avatarKey },
  { name: "payment_accounts.image_key", column: paymentAccounts.imageKey },
  { name: "site_settings.logo_key", column: siteSettings.logoKey },
  { name: "notifications.image_key", column: notifications.imageKey },
  { name: "couriers.image_key", column: couriers.imageKey },
]

/**
 * يسجّل مفاتيح روابط رفع وُقّعت للتو. فشل التسجيل لا يمنع الرفع (أسوأ نتيجة كائن لا يُنظَّف تلقائياً)،
 * لكنه يُسجَّل في سجل الخادم حتى لا يمرّ بصمت.
 */
export async function recordPendingUploads(keys: string[], user: string): Promise<void> {
  if (keys.length === 0) return
  try {
    await db.insert(pendingUploads).values(keys.map((objectKey) => ({ objectKey, createdBy: user }))).onConflictDoNothing()
  } catch (error) {
    console.error("pending upload record failed:", error instanceof Error ? error.message : error)
  }
}

/** حفظ ناجح استعمل هذه المفاتيح: تُزال من السجل. مفتاح سجّله مدير آخر لا يُزال (يتولاه فحص المراجع في التنظيف). */
export async function claimPendingUploads(keys: string[], user: string): Promise<number> {
  if (keys.length === 0) return 0
  const claimed = await db
    .delete(pendingUploads)
    .where(and(inArray(pendingUploads.objectKey, keys), eq(pendingUploads.createdBy, user)))
    .returning({ key: pendingUploads.objectKey })
  return claimed.length
}

/**
 * إلغاء المدير للنموذج: يزيل من السجل مفاتيحه التي لم يُطالَب بها ويعيدها ليُحذف كائنها.
 * ما طُولب به (استعمله حفظ ناجح) أو سجّله غيره لا يُمَس، فلا يمكن حذف صورة حيّة من هنا.
 */
export async function discardPendingUploads(keys: string[], user: string): Promise<string[]> {
  if (keys.length === 0) return []
  const removed = await db
    .delete(pendingUploads)
    .where(and(inArray(pendingUploads.objectKey, keys), eq(pendingUploads.createdBy, user)))
    .returning({ key: pendingUploads.objectKey })
  return removed.map((r) => r.key)
}

/** المفاتيح (من المعطاة) التي يشير إليها صف حي في أي عمود مفاتيح. */
export async function referencedObjectKeys(keys: string[]): Promise<Set<string>> {
  if (keys.length === 0) return new Set()
  const found = await Promise.all(
    OBJECT_KEY_COLUMNS.map(async ({ column }) => {
      const rows = await db.select({ key: column }).from(column.table as PgTable).where(inArray(column, keys))
      return rows.map((r) => r.key as string)
    }),
  )
  return new Set(found.flat())
}

export const PENDING_UPLOAD_MAX_AGE_HOURS = 24
const PURGE_BATCH = 200

/**
 * التنظيف اليومي: كائنات سُجّلت قبل أكثر من 24 ساعة ولم يُطالَب بها. يُحذف من R2 ما لا يشير إليه أي صف حي،
 * ثم تُحذف سجلاتها؛ وما أشار إليه صف حي يُحذف سجله فقط (لا يُمَس الكائن). فشل حذف كائن يُبقي سجله لمحاولة الغد.
 */
export async function purgePendingUploads(
  now = new Date(),
  remove: (key: string) => Promise<void> = deleteImageObject,
): Promise<{ checked: number; deleted: number; referenced: number; failed: number }> {
  const cutoff = new Date(now.getTime() - PENDING_UPLOAD_MAX_AGE_HOURS * 3_600_000)
  const rows = await db.select().from(pendingUploads).where(lt(pendingUploads.createdAt, cutoff)).orderBy(pendingUploads.createdAt).limit(PURGE_BATCH)
  if (rows.length === 0) return { checked: 0, deleted: 0, referenced: 0, failed: 0 }

  const keys = rows.map((r) => r.objectKey)
  const referenced = await referencedObjectKeys(keys)
  const orphans = keys.filter((k) => !referenced.has(k))
  const results = await Promise.allSettled(orphans.map((k) => remove(k)))
  const deleted = orphans.filter((_, i) => results[i].status === "fulfilled")
  const failed = orphans.length - deleted.length
  const forget = [...referenced, ...deleted]
  if (forget.length) await db.delete(pendingUploads).where(inArray(pendingUploads.objectKey, forget))
  return { checked: keys.length, deleted: deleted.length, referenced: referenced.size, failed }
}
