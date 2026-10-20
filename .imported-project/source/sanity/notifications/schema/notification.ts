import { defineField, defineType } from "sanity"
import { isValidInternalLink } from "../internal-link"
import { NOTIFICATION_LIMITS, NOTIFICATION_STATUS_LABELS } from "../types"

// ============================================
// مخطط الإشعار الداخلي (notification) — مشروع الإشعارات المستقل وحده
//
// لا يوجد هذا النوع في مشروع المحتوى ولا في مشروع الطلبات.
// المسودة والمؤرشف لا يظهران للعملاء إطلاقاً (يُفلتران في الاستعلام).
// ============================================

export const notificationType = defineType({
  name: "notification",
  title: "الإشعارات",
  type: "document",
  fields: [
    defineField({
      name: "title",
      title: "عنوان الإشعار",
      type: "string",
      description: "نص عادي فقط — لا يُسمح بأي وسوم HTML.",
      validation: (rule) =>
        rule
          .required()
          .min(NOTIFICATION_LIMITS.titleMin)
          .max(NOTIFICATION_LIMITS.titleMax)
          .error(
            `العنوان مطلوب ويجب أن يكون بين ${NOTIFICATION_LIMITS.titleMin} و ${NOTIFICATION_LIMITS.titleMax} حرفاً`,
          ),
    }),
    defineField({
      name: "body",
      title: "نص الإشعار",
      type: "text",
      rows: 4,
      description: "نص عادي فقط — يُعرض للعميل كنص آمن بلا HTML.",
      validation: (rule) =>
        rule
          .required()
          .min(NOTIFICATION_LIMITS.bodyMin)
          .max(NOTIFICATION_LIMITS.bodyMax)
          .error(
            `النص مطلوب ويجب أن يكون بين ${NOTIFICATION_LIMITS.bodyMin} و ${NOTIFICATION_LIMITS.bodyMax} حرفاً`,
          ),
    }),
    defineField({
      name: "image",
      title: "صورة الإشعار (اختيارية)",
      type: "image",
      description: "تُرفع إلى أصول مشروع الإشعارات فقط، ولا تُرفع لمشروع المنتجات أو الطلبات.",
      options: { hotspot: true },
    }),
    defineField({
      name: "link",
      title: "رابط داخلي (اختياري)",
      type: "string",
      description: "مسار داخلي يبدأ بـ / مثل /offers أو /product/product-slug. الروابط الخارجية مرفوضة.",
      validation: (rule) =>
        rule.custom((value) => {
          if (value === undefined || value === null || value === "") return true
          if (!isValidInternalLink(value)) {
            return "الرابط يجب أن يكون مساراً داخلياً يبدأ بـ / ولا يحتوي بروتوكولاً غير آمن"
          }
          return true
        }),
    }),
    defineField({
      name: "status",
      title: "حالة الإشعار",
      type: "string",
      initialValue: "draft",
      options: {
        list: [
          { title: NOTIFICATION_STATUS_LABELS.draft, value: "draft" },
          { title: NOTIFICATION_STATUS_LABELS.published, value: "published" },
          { title: NOTIFICATION_STATUS_LABELS.archived, value: "archived" },
        ],
        layout: "radio",
      },
      validation: (rule) => rule.required().error("حالة الإشعار مطلوبة"),
    }),
    defineField({
      name: "priority",
      title: "الأولوية",
      type: "string",
      initialValue: "normal",
      options: {
        list: [
          { title: "عادي", value: "normal" },
          { title: "مهم", value: "important" },
        ],
        layout: "radio",
      },
      validation: (rule) => rule.required().error("الأولوية مطلوبة"),
    }),
    defineField({
      name: "publishedAt",
      title: "وقت النشر",
      type: "datetime",
      description: "لا يظهر الإشعار للعملاء قبل هذا الوقت.",
    }),
    defineField({
      name: "expiresAt",
      title: "وقت الانتهاء (اختياري)",
      type: "datetime",
      description: "بعد هذا الوقت يختفي الإشعار عن العملاء تلقائياً.",
      validation: (rule) =>
        rule.custom((value, context) => {
          if (!value) return true
          const parent = context.parent as { publishedAt?: string } | undefined
          const publishedAt = parent?.publishedAt
          if (!publishedAt) return true
          if (new Date(value).getTime() <= new Date(publishedAt).getTime()) {
            return "تاريخ الانتهاء يجب أن يكون بعد تاريخ النشر"
          }
          return true
        }),
    }),
    defineField({
      name: "createdBy",
      title: "أنشئ بواسطة",
      type: "string",
      description: "قيمة إدارية اختيارية (اسم مستخدم اللوحة).",
      validation: (rule) => rule.max(NOTIFICATION_LIMITS.createdByMax),
    }),
    defineField({ name: "createdAt", title: "تاريخ الإنشاء", type: "datetime", readOnly: true }),
    defineField({ name: "updatedAt", title: "آخر تعديل", type: "datetime", readOnly: true }),
  ],
  orderings: [
    {
      title: "الأحدث نشراً",
      name: "publishedAtDesc",
      by: [{ field: "publishedAt", direction: "desc" }],
    },
    {
      title: "الأقدم نشراً",
      name: "publishedAtAsc",
      by: [{ field: "publishedAt", direction: "asc" }],
    },
  ],
  preview: {
    select: {
      title: "title",
      status: "status",
      publishedAt: "publishedAt",
      media: "image",
    },
    prepare: ({
      title,
      status,
      publishedAt,
      media,
    }: {
      title?: string
      status?: keyof typeof NOTIFICATION_STATUS_LABELS
      publishedAt?: string
      media?: unknown
    }) => ({
      title: title ?? "إشعار بلا عنوان",
      subtitle: `${status ? NOTIFICATION_STATUS_LABELS[status] : "—"}${
        publishedAt ? ` • ${new Date(publishedAt).toLocaleString("ar")}` : ""
      }`,
      media: media as never,
    }),
  },
})
