import { defineArrayMember, defineField, defineType } from "sanity"

export const adType = defineType({
  name: "ad",
  title: "الإعلانات",
  type: "document",
  groups: [
    { name: "content", title: "بيانات الإعلان", default: true },
    { name: "targeting", title: "مكان الظهور (اختياري)" },
    { name: "advanced", title: "إعدادات إضافية" },
  ],
  fields: [
    defineField({
      name: "title",
      title: "اسم الإعلان",
      type: "string",
      description: "اسم واضح داخل لوحة التحكم، ويُستخدم أيضاً كنص بديل للصورة.",
      validation: (rule) => rule.required().min(2),
      group: "content",
    }),
    defineField({
      name: "image",
      title: "صورة الإعلان",
      type: "image",
      description: "ارفع الصورة التي تريد عرضها بين المنتجات.",
      options: { hotspot: true },
      validation: (rule) => rule.required(),
      group: "content",
    }),
    defineField({
      name: "href",
      title: "الرابط عند الضغط (اختياري)",
      type: "string",
      description: "مثال: /category/perfumes — اتركه فارغاً إذا كانت الصورة بلا رابط.",
      group: "content",
    }),
    defineField({
      name: "active",
      title: "الإعلان مفعّل",
      type: "boolean",
      description: "أوقفه لإخفائه مؤقتاً دون حذفه.",
      initialValue: true,
      group: "content",
    }),
    defineField({
      name: "categories",
      title: "الأقسام التي يظهر فيها الإعلان",
      type: "array",
      description: "اختياري — اتركه فارغاً ليظهر الإعلان في جميع الأقسام.",
      of: [defineArrayMember({ type: "reference", to: [{ type: "category" }] })],
      group: "targeting",
    }),
    defineField({
      name: "frequency",
      title: "يظهر بعد كل كم منتج؟",
      type: "number",
      description: "القيمة الجاهزة 6 مناسبة غالباً، ولا تحتاج إلى تغييرها.",
      initialValue: 6,
      validation: (rule) => rule.min(1),
      group: "advanced",
    }),
    defineField({
      name: "sortOrder",
      title: "ترتيب الإعلان",
      type: "number",
      description: "الأرقام الأصغر تظهر أولاً عند وجود عدة إعلانات.",
      initialValue: 0,
      validation: (rule) => rule.min(0),
      group: "advanced",
    }),
  ],
  preview: {
    select: { title: "title", active: "active", media: "image" },
    prepare({ title, active, media }) {
      return {
        title: title || "إعلان بدون اسم",
        subtitle: active === false ? "متوقف" : "مفعّل",
        media,
      }
    },
  },
})
