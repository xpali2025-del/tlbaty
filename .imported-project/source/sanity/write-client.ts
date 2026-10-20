import "server-only"

import { createClient, type SanityClient } from "next-sanity"
import { apiVersion, dataset, projectId } from "./env"

// ============================================
// عميل Sanity للكتابة — يُستخدم فقط داخل الخادم (Server Actions)
// يعتمد على توكن بصلاحية Editor أو أعلى: SANITY_API_TOKEN
// لا تستورد هذا الملف أبداً في كود العميل (server-only يمنع ذلك).
//
// كل عمليات الإضافة/التعديل/الحذف من لوحة /manage تمر عبر هذا العميل،
// فتُكتب مباشرة في Sanity Content Lake تماماً كما لو أُضيفت من Sanity Studio،
// ويعرضها المتجر فوراً بعد إبطال الكاش.
// ============================================

const token = process.env.SANITY_API_TOKEN

/** هل توكن الكتابة متوفر؟ لوحة الإدارة تحتاجه، أما المتجر فلا. */
export const canWriteToSanity = Boolean(projectId && token)

export const writeClient: SanityClient | null = canWriteToSanity
  ? createClient({
      projectId,
      dataset,
      apiVersion,
      token,
      useCdn: false,
      // نكتب في المحتوى المنشور مباشرة (بدون مسودات) ليظهر في المتجر فوراً.
      perspective: "published",
    })
  : null

/** يعيد عميل الكتابة أو يرمي خطأً واضحاً عند غياب الإعدادات. */
export function requireWriteClient(): SanityClient {
  if (!writeClient) {
    throw new Error(
      "لوحة الإدارة غير مهيأة: تأكد من ضبط NEXT_PUBLIC_SANITY_PROJECT_ID و SANITY_API_TOKEN.",
    )
  }
  return writeClient
}
