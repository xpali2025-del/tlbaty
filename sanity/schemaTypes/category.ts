import { defineArrayMember, defineField, defineType } from "sanity"
import { AutoSlugInput } from "@/sanity/components/AutoSlugInput"

export const categoryType = defineType({
  name: "category",
  title: "الأقسام",
  type: "document",
  groups: [
    { name: "content", title: "بيانات القسم", default: true },
    { name: "subcategories", title: "الأقسام الفرعية" },
    { name: "seo", title: "SEO (اختياري)" },
  ],
  fields: [
    defineField({
      name: "name",
      title: "اسم القسم",
      type: "string",
      description: "مثال: العطور، الملابس، الأحذية.",
      validation: (rule) => rule.required().min(2),
      group: "content",
    }),
    defineField({
      name: "slug",
      title: "رابط القسم — تلقائي",
      type: "slug",
      description: "يُنشأ تلقائياً من اسم القسم.",
      options: { source: "name", maxLength: 96 },
      components: { input: AutoSlugInput },
      validation: (rule) => rule.required(),
      group: "content",
    }),
    defineField({
      name: "image",
      title: "صورة القسم",
      type: "image",
      description: "الصورة التي تظهر للعميل في قائمة الأقسام.",
      options: { hotspot: true },
      group: "content",
    }),
    defineField({
      name: "description",
      title: "وصف القسم",
      type: "text",
      rows: 3,
      description: "وصف قصير يوضح المنتجات الموجودة داخل القسم.",
      group: "content",
    }),
    defineField({
      name: "sortOrder",
      title: "ترتيب ظهور القسم",
      type: "number",
      description: "الأرقام الأصغر تظهر أولاً. اتركه صفر للترتيب العادي.",
      initialValue: 0,
      validation: (rule) => rule.min(0),
      group: "content",
    }),
    defineField({
      name: "subcategories",
      title: "الأقسام الفرعية التابعة لهذا القسم",
      type: "array",
      description: "أضف الأقسام الفرعية هنا، وستظهر تلقائياً عند إدخال المنتجات.",
      of: [
        defineArrayMember({
          type: "object",
          name: "subcategory",
          title: "قسم فرعي",
          fields: [
            defineField({
              name: "name",
              title: "اسم القسم الفرعي",
              type: "string",
              description: "مثال: عطور شرقية.",
              validation: (rule) => rule.required(),
            }),
            defineField({
              name: "slug",
              title: "الرابط — تلقائي",
              type: "slug",
              description: "يُنشأ تلقائياً من الاسم.",
              options: { source: "name", maxLength: 96 },
              components: { input: AutoSlugInput },
              validation: (rule) => rule.required(),
            }),
            defineField({
              name: "description",
              title: "الوصف (اختياري)",
              type: "text",
              rows: 2,
            }),
          ],
          preview: {
            select: { title: "name", subtitle: "slug.current" },
            prepare({ title, subtitle }) {
              return { title: title || "قسم فرعي جديد", subtitle: subtitle || "الرابط يُنشأ تلقائياً" }
            },
          },
        }),
      ],
      group: "subcategories",
    }),
    defineField({
      name: "metaTitle",
      title: "عنوان صفحة البحث (اختياري)",
      type: "string",
      description: "اتركه فارغاً لاستخدام اسم القسم تلقائياً.",
      validation: (rule) => rule.max(70).warning("يفضل ألا يتجاوز العنوان 70 حرفاً"),
      group: "seo",
    }),
    defineField({
      name: "metaDescription",
      title: "وصف صفحة البحث (اختياري)",
      type: "text",
      rows: 3,
      description: "اتركه فارغاً لاستخدام وصف القسم تلقائياً.",
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
        title: title || "قسم بدون اسم",
        subtitle: subtitle || "الرابط يُنشأ تلقائياً",
        media,
      }
    },
  },
})
