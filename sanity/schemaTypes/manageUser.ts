import { defineField, defineType } from "sanity"

// مستخدمو لوحة الإدارة — حسابات تسجيل الدخول للوحة /manage.
// كلمة المرور تُخزَّن مُجزّأة (hash) ولا تُعرض أبداً.
export const manageUserType = defineType({
  name: "manageUser",
  title: "مستخدمو اللوحة",
  type: "document",
  fields: [
    defineField({
      name: "username",
      title: "اسم المستخدم",
      type: "string",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "name",
      title: "الاسم المعروض",
      type: "string",
    }),
    defineField({
      name: "passwordHash",
      title: "كلمة المرور (مُجزّأة)",
      type: "string",
      hidden: true,
      readOnly: true,
    }),
    defineField({
      name: "role",
      title: "الصلاحية",
      type: "string",
      options: {
        list: [
          { title: "مدير", value: "admin" },
          { title: "محرّر", value: "editor" },
        ],
        layout: "radio",
      },
      initialValue: "editor",
    }),
    defineField({
      name: "active",
      title: "مفعّل",
      type: "boolean",
      initialValue: true,
    }),
  ],
  preview: {
    select: { title: "username", subtitle: "role" },
  },
})
