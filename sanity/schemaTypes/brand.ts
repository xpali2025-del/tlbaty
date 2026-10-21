import { defineArrayMember, defineField, defineType } from "sanity"
import { AutoSlugInput } from "@/sanity/components/AutoSlugInput"

export const brandType = defineType({
  name: "brand",
  title: "البراندات",
  type: "document",
  groups: [
    { name: "content", title: "بيانات البراند", default: true },
    { name: "seo", title: "SEO (اختياري)" },
  ],
  fields: [
    defineField({
      name: "name",
      title: "اسم البراند",
      type: "string",
      description: "اكتب الاسم الرسمي كما سيظهر للعميل.",
      validation: (rule) => rule.required().min(2),
      group: "content",
    }),
    defineField({
      name: "slug",
      title: "رابط البراند — تلقائي",
      type: "slug",
      description: "يُنشأ تلقائياً من اسم البراند.",
      options: { source: "name", maxLength: 96 },
      components: { input: AutoSlugInput },
      validation: (rule) => rule.required(),
      group: "content",
    }),
    defineField({
      name: "image",
      title: "شعار أو صورة البراند",
      type: "image",
      options: { hotspot: true },
      group: "content",
    }),
    defineField({
      name: "description",
      title: "وصف البراند (اختياري)",
      type: "text",
      rows: 3,
      group: "content",
    }),
    defineField({
      name: "featured",
      title: "إظهار ضمن البراندات المميزة",
      type: "boolean",
      initialValue: false,
      group: "content",
    }),
    defineField({
      name: "sortOrder",
      title: "ترتيب الظهور",
      type: "number",
      description: "الأرقام الأصغر تظهر أولاً.",
      initialValue: 0,
      validation: (rule) => rule.min(0),
      group: "content",
    }),
    defineField({
      name: "metaTitle",
      title: "عنوان صفحة البحث (اختياري)",
      type: "string",
      description: "اتركه فارغاً لاستخدام اسم البراند تلقائياً.",
      validation: (rule) => rule.max(70).warning("يفضل ألا يتجاوز العنوان 70 حرفاً"),
      group: "seo",
    }),
    defineField({
      name: "metaDescription",
      title: "وصف صفحة البحث (اختياري)",
      type: "text",
      rows: 3,
      description: "اتركه فارغاً لاستخدام وصف البراند تلقائياً.",
      validation: (rule) => rule.max(170).warning("يفضل ألا يتجاوز الوصف 170 حرفاً"),
      group: "seo",
    }),
    defineField({
      name: "keywords",
      title: "الكلمات المفتاحية (اختياري)",
      type: "array",
      of: [defineArrayMember({ type: "string" })],
      options: { layout: "tags" },
      group: "seo",
    }),
  ],
  preview: {
    select: { title: "name", subtitle: "slug.current", media: "image" },
    prepare({ title, subtitle, media }) {
      return {
        title: title || "براند بدون اسم",
        subtitle: subtitle || "الرابط يُنشأ تلقائياً",
        media,
      }
    },
  },
})
