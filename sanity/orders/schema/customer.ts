import { defineField, defineType } from "sanity"

// ============================================
// مخطط العميل — لا يُنشأ إلا بعد نجاح التحقق بـ OTP.
//
// customerId معرّف داخلي عشوائي ثابت (CUS_XXXXXXXXXXXX) لا يعتمد على الهاتف،
// فيبقى نفسه مدى حياة الحساب حتى لو غيّر العميل رقمه. تُربط به كل الطلبات.
// ============================================

export const customerType = defineType({
  name: "customer",
  title: "العملاء",
  type: "document",
  fields: [
    defineField({
      name: "customerId",
      title: "معرّف العميل",
      type: "string",
      readOnly: true,
      description: "معرّف داخلي عشوائي ثابت CUS_XXXX. لا يعتمد على رقم الهاتف.",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "phone",
      title: "رقم الهاتف المحلي",
      type: "string",
      description: "الرقم المحلي الموحّد (9 أرقام). قابل للتغيير مع بقاء نفس معرّف العميل.",
    }),
    defineField({
      name: "verified",
      title: "موثّق",
      type: "boolean",
      initialValue: true,
    }),
    defineField({
      name: "status",
      title: "الحالة",
      type: "string",
      initialValue: "active",
      options: {
        list: [
          { title: "نشط", value: "active" },
          { title: "محظور", value: "blocked" },
        ],
      },
    }),
    defineField({ name: "createdAt", title: "تاريخ الإنشاء", type: "datetime", readOnly: true }),
    defineField({ name: "lastLogin", title: "آخر تسجيل دخول", type: "datetime", readOnly: true }),
    defineField({
      name: "phoneHistory",
      title: "سجل أرقام الهاتف",
      type: "array",
      readOnly: true,
      of: [
        {
          type: "object",
          name: "phoneChange",
          fields: [
            defineField({ name: "from", title: "من", type: "string" }),
            defineField({ name: "to", title: "إلى", type: "string" }),
            defineField({ name: "changedAt", title: "وقت التغيير", type: "datetime" }),
          ],
        },
      ],
    }),
  ],
  orderings: [
    { title: "الأحدث أولاً", name: "createdAtDesc", by: [{ field: "createdAt", direction: "desc" }] },
  ],
  preview: {
    select: { customerId: "customerId", phone: "phone", status: "status" },
    prepare: ({ customerId, phone, status }) => ({
      title: customerId ?? "عميل",
      subtitle: `${phone ?? "-"} • ${status === "blocked" ? "محظور" : "نشط"}`,
    }),
  },
})
