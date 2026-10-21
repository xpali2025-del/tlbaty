import { defineArrayMember, defineField, defineType } from "sanity"

// ============================================
// مخطط المندوب — يُعرض في استوديو الطلبات (/studio-orders)
//
// المندوب لا يملك حساب دخول ولا تطبيقاً خاصاً. كل الإدارة تتم من /manage.
// لا يُحذف المندوب المرتبط بطلبات سابقة — يُوقف فقط (status = suspended).
// ============================================

export const courierType = defineType({
  name: "courier",
  title: "المناديب",
  type: "document",
  fields: [
    defineField({
      name: "name",
      title: "اسم المندوب",
      type: "string",
      validation: (Rule) => Rule.required().min(2).max(100),
    }),
    defineField({
      name: "phone",
      title: "رقم الهاتف",
      type: "string",
      description: "يُستخدم لزر الاتصال في تفاصيل الطلب.",
      validation: (Rule) => Rule.max(30),
    }),
    defineField({
      name: "image",
      title: "صورة المندوب (اختياري)",
      type: "image",
      options: { hotspot: true },
    }),
    defineField({
      name: "cities",
      title: "المدن التي يعمل فيها",
      type: "array",
      description: "تُستخدم لترتيب المناديب حسب مدينة الطلب عند التعيين.",
      of: [defineArrayMember({ type: "string" })],
      options: { layout: "tags" },
    }),
    defineField({
      name: "status",
      title: "حالة المندوب",
      type: "string",
      initialValue: "active",
      options: {
        list: [
          { title: "نشط", value: "active" },
          { title: "موقوف", value: "suspended" },
        ],
        layout: "radio",
      },
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: "adminNote",
      title: "ملاحظات إدارية",
      type: "text",
      rows: 3,
    }),
    defineField({
      name: "createdAt",
      title: "تاريخ الإضافة",
      type: "datetime",
      readOnly: true,
    }),
  ],
  orderings: [
    {
      title: "الأحدث أولاً",
      name: "createdAtDesc",
      by: [{ field: "createdAt", direction: "desc" }],
    },
    {
      title: "الاسم أبجدياً",
      name: "nameAsc",
      by: [{ field: "name", direction: "asc" }],
    },
  ],
  preview: {
    select: { title: "name", phone: "phone", status: "status", media: "image" },
    prepare: ({ title, phone, status, media }) => ({
      title: (title as string) ?? "مندوب",
      subtitle: `${status === "suspended" ? "موقوف" : "نشط"} • ${phone ?? "بلا هاتف"}`,
      media,
    }),
  },
})
